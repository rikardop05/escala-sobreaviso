import { randomUUID } from 'crypto';
import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';
import { adminCovers } from './_allowlist.js';
import { validate, checkBodySize, ChPostSchema } from './_validate.js';
import { readTeamOverrides, readTeamSubs } from './_scheduleData.js';
import { MEMBERS, TEAMS } from '../src/lib/teams.js';
import { buildSchedule } from '../src/lib/schedule.js';
import { splitHoraExtra } from '../src/lib/chCalc.js';

// Keys use memberId (not userId) so the admin can read/write any member's data.
// ⚠ Migration note: previous keys were 'user:{clerkId}:ch_*'.
//   Existing CH data must be manually re-entered after this change.
//
// Fase 1 da spec de múltiplas equipes (docs/specs/multi-equipe.md §3): acesso ao CH
// de uma pessoa é dela mesma, ou de quem administra a EQUIPE dela (adminOf cobre
// MEMBERS[target].teamId) — não mais "qualquer admin, de qualquer equipe".
//
// Aprovação de excedente (Hora Extra): a divisão aprovado/pendente é feita AQUI, no
// servidor, nunca confiando no que o cliente manda — ver reclassifyEntries() abaixo.
// O cliente pode mostrar uma prévia com a mesma splitHoraExtra() (src/lib/chCalc.js),
// mas a classificação gravada é sempre a que o servidor recalcula nesta requisição.

const isPrivileged = (adminOf) => adminOf === '*' || (Array.isArray(adminOf) && adminOf.length > 0);

function canAccessMember(requester, target) {
  if (requester.memberId && requester.memberId === target) return true;
  const targetTeam = MEMBERS[target]?.teamId;
  if (!targetTeam) return false; // pessoa desconhecida — nega
  return adminCovers(requester.adminOf, targetTeam);
}

// Reclassifica os lançamentos de Hora Extra do array recebido, comparando com o
// que já está gravado (`storedEntries`):
//   - não é Hora Extra → passa direto, mas nunca com campos de decisão vindos do
//     cliente (defensivo — esses campos só existem para HE).
//   - id já existia E data/inicio/fim/tipo não mudaram → "não mudou": mantém a
//     classificação GRAVADA (status/origemId/decididoPor/decididoEm/motivo do
//     servidor, nunca do que o cliente mandou — é isto que torna um POST forjado
//     inócuo). projeto/atividade podem vir atualizados sem disparar reclassificação.
//   - novo, OU o intervalo mudou (edição) → reclassifica do zero via
//     splitHoraExtra, descartando qualquer status/origemId que o cliente tenha
//     enviado. Pode gerar 1..N lançamentos com um origemId novo em comum.
function reclassifyEntries(incomingEntries, storedEntries, schedule, subs, team, target) {
  const storedById = new Map(storedEntries.map(e => [e.id, e]));
  const result = [];
  for (const e of incomingEntries) {
    if (e.tipo !== 'Hora Extra') {
      const { status, origemId, decididoPor, decididoEm, motivo, ...clean } = e;
      result.push(clean);
      continue;
    }
    const stored = storedById.get(e.id);
    const unchanged = stored && stored.data === e.data && stored.inicio === e.inicio
      && stored.fim === e.fim && stored.tipo === e.tipo;
    if (unchanged) {
      result.push({
        ...e,
        status: stored.status,
        origemId: stored.origemId,
        decididoPor: stored.decididoPor,
        decididoEm: stored.decididoEm,
        motivo: stored.motivo,
      });
      continue;
    }
    const parts = splitHoraExtra(schedule, subs, team.dayStart, target, e.data, e.inicio, e.fim);
    const origemId = randomUUID();
    for (const p of parts) {
      result.push({
        id: randomUUID(),
        person: target,
        tipo: 'Hora Extra',
        data: p.data,
        inicio: p.inicio,
        fim: p.fim,
        projeto: e.projeto,
        atividade: e.atividade,
        status: p.aprovado ? 'aprovado' : 'pendente',
        origemId,
      });
    }
  }
  return result;
}

// Reescreve o índice da fila (team:{teamId}:ch_pending) para `target`: remove
// tudo que já estava lá para essa pessoa e insere de novo a partir do array
// FINAL de entries — não importa se um item pendente era novo, editado ou
// deixou de existir (deletado): o resultado final é sempre a verdade.
async function syncPendingQueue(teamId, target, finalEntries) {
  const queueKey = `team:${teamId}:ch_pending`;
  const queue = (await kvGet(queueKey)) ?? [];
  const others = queue.filter(item => item.memberId !== target);
  const mine = finalEntries
    .filter(e => e.tipo === 'Hora Extra' && e.status === 'pendente')
    .map(e => ({ memberId: target, entryId: e.id }));
  await kvSet(queueKey, [...others, ...mine]);
}

export default async function handler(req, res) {
  let memberId, adminOf;
  try {
    ({ memberId, adminOf } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  // CH exige identidade de membro — EXCETO admin fora da escala (memberId null),
  // que sempre opera sobre um membro-alvo via ?person (GET) ou body.person (POST).
  if (!memberId && !isPrivileged(adminOf)) return res.status(403).json({ error: 'Forbidden' });

  try {
    if (req.method === 'GET') {
      const requestedPerson = typeof req.query.person === 'string' ? req.query.person : null;
      const target = (isPrivileged(adminOf) && requestedPerson) ? requestedPerson : memberId;
      if (!target) return res.status(400).json({ error: 'Bad request' });
      if (isPrivileged(adminOf) && requestedPerson && !canAccessMember({ memberId, adminOf }, target)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const [entries, params] = await Promise.all([
        kvGet(`member:${target}:ch_entries`),
        kvGet(`member:${target}:ch_params`),
      ]);
      return res.status(200).json({ entries: entries ?? [], params: params ?? {} });
    }

    if (req.method === 'POST') {
      if (!checkBodySize(req.body)) return res.status(400).json({ error: 'Bad request' });
      const { ok, data: body } = validate(ChPostSchema, req.body);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const { entries, params, person: bodyPerson } = body;
      const target = (isPrivileged(adminOf) && bodyPerson) ? bodyPerson : memberId;
      // Admin fora da escala precisa indicar o membro-alvo — nunca grava em member:null:*
      if (!target) return res.status(400).json({ error: 'Bad request' });
      if (isPrivileged(adminOf) && bodyPerson && !canAccessMember({ memberId, adminOf }, target)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const response = { ok: true };
      if (entries !== undefined) {
        const teamId = MEMBERS[target].teamId;
        const team = TEAMS[teamId];
        const [storedEntries, overrides, subs] = await Promise.all([
          kvGet(`member:${target}:ch_entries`).then(v => v ?? []),
          readTeamOverrides(teamId),
          readTeamSubs(teamId),
        ]);
        const schedule = buildSchedule(team, overrides);
        const finalEntries = reclassifyEntries(entries, storedEntries, schedule, subs, team, target);
        // Entrada primeiro, índice da fila depois (sem transação — ver comentário
        // de syncPendingQueue): se o índice falhar, o pior caso é uma pendência
        // fantasma que o GET de api/ch-approve.js já descarta ao ler.
        await kvSet(`member:${target}:ch_entries`, finalEntries);
        await syncPendingQueue(teamId, target, finalEntries);
        // Devolve a versão reclassificada: o cliente enviou uma Hora Extra sem
        // saber se ela cai dentro/fora do sobreaviso (pode até virar N partes) —
        // sem isto, a tela ficava mostrando o lançamento otimista (sem `status`,
        // portanto tratado como aprovado pela regra de compatibilidade) até a
        // próxima recarga da página.
        response.entries = finalEntries;
      }
      if (params !== undefined) await kvSet(`member:${target}:ch_params`, params);

      return res.status(200).json(response);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[ch] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
