import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';
import { adminCovers } from './_allowlist.js';
import { validate, ChApprovePostSchema } from './_validate.js';
import { MEMBERS, TEAMS } from '../src/lib/teams.js';

// Aprovação do excedente de Hora Extra (a parte fora do sobreaviso — ver
// src/lib/chCalc.js, splitHoraExtra). Ação exclusiva de quem administra a
// EQUIPE da pessoa-alvo (adminCovers) — igual a fechamento e relatório
// consolidado. Não existe admin geral permanente hoje ('*' é temporário e está
// marcado como tal em api/_allowlist.js); nada aqui depende disso existir.
//
//   GET  — pendências das equipes em adminOf do requisitante (mesmo admin pode
//          aprovar o próprio excedente).
//   POST — { person, entryId, acao: 'aprovar'|'rejeitar', motivo? }
//
// NÃO existe índice de fila. A pendência é derivada dos próprios lançamentos,
// varrendo os membros da equipe. Um índice compartilhado (team:{id}:ch_pending)
// existiu e foi removido: ele exigia read-modify-write da MESMA chave por N
// pessoas, então duas gravações simultâneas apagavam pendências uma da outra em
// silêncio — e a leitura só sabia remover itens obsoletos, nunca redescobrir os
// perdidos. O resultado seria uma pendência invisível para o admin, que só
// apareceria ao tentar fechar o mês (api/ch-close.js lê os lançamentos, não a
// fila). Equipes têm 5 a 8 pessoas: varrer custa uma leitura por membro e não
// tem como divergir da verdade.

const isPrivileged = (adminOf) => adminOf === '*' || (Array.isArray(adminOf) && adminOf.length > 0);

async function pendenciasDaEquipe(teamId) {
  const membros = Object.keys(MEMBERS).filter(id => MEMBERS[id].teamId === teamId);
  const porMembro = await Promise.all(membros.map(async (memberId) => {
    const entries = (await kvGet(`member:${memberId}:ch_entries`)) ?? [];
    return entries
      .filter(e => e.tipo === 'Hora Extra' && e.status === 'pendente')
      .map(e => ({ person: memberId, teamId, entryId: e.id, data: e.data, inicio: e.inicio, fim: e.fim }));
  }));
  return porMembro.flat();
}

export default async function handler(req, res) {
  let adminOf, memberId, email;
  try {
    ({ adminOf, memberId, email } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }
  if (!isPrivileged(adminOf)) return res.status(403).json({ error: 'Forbidden' });

  try {
    if (req.method === 'GET') {
      const teamIds = adminOf === '*' ? Object.keys(TEAMS) : adminOf.filter(id => TEAMS[id]);
      const perTeam = await Promise.all(teamIds.map(pendenciasDaEquipe));
      const pendencias = perTeam.flat().sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio));
      return res.status(200).json(pendencias);
    }

    if (req.method === 'POST') {
      const { ok, data: body } = validate(ChApprovePostSchema, req.body);
      if (!ok) return res.status(400).json({ error: 'Bad request' });
      const { person, entryId, acao, motivo } = body;

      const teamId = MEMBERS[person]?.teamId;
      if (!teamId || !adminCovers(adminOf, teamId)) return res.status(403).json({ error: 'Forbidden' });

      const entriesKey = `member:${person}:ch_entries`;
      const entries = (await kvGet(entriesKey)) ?? [];
      const idx = entries.findIndex(e => e.id === entryId);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      if (entries[idx].status !== 'pendente') return res.status(409).json({ error: 'Not pending' });

      const updated = {
        ...entries[idx],
        status: acao === 'aprovar' ? 'aprovado' : 'rejeitado',
        decididoPor: email,
        decididoEm: new Date().toISOString(),
      };
      if (motivo) updated.motivo = motivo.trim();
      entries[idx] = updated;

      // Gravar o lançamento é a única escrita: a pendência deixa de existir no
      // momento em que `status` muda, porque a fila é derivada dele.
      await kvSet(entriesKey, entries);

      return res.status(200).json({ ok: true, entry: updated });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[ch-approve] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
