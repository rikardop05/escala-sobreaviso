import { teamScopeCovers } from '../src/lib/teams.js';

// ─── ALLOWLIST DE ACESSO ──────────────────────────────────────────────────────
//
// Edite este arquivo para adicionar/remover membros e definir quem administra o quê.
//
// Regras (Fase 1 da spec de múltiplas equipes — docs/specs/multi-equipe.md §3):
//   - memberId DEVE bater exatamente com uma chave de MEMBERS em src/lib/teams.js
//     (exceção: admin que NÃO faz parte de nenhuma escala usa memberId: null e
//      teamId: null — não tem painel de CH próprio, mas pode ver/editar o de
//      qualquer membro das equipes que administra, via dropdown)
//   - teamId: a equipe a que a pessoa pertence (null se memberId for null)
//   - adminOf: array de teamIds que a pessoa administra (escala + substituições +
//     CH de qualquer pessoa da equipe + fechamento de mês + relatório consolidado),
//     ou '*' para administrar todas as equipes. [] = não administra nenhuma.
//   - scheduleEditOf: array de teamIds cuja ESCALA a pessoa pode editar por completo
//     (mesmo modo de edição do admin — qualquer turno, qualquer pessoa do roster,
//     "Adicionar turno", "Dividir turno", rótulo do dia), SEM ganhar nada do que
//     adminOf dá: não vê CH de outras pessoas, não fecha/reabre mês, não vê o
//     relatório consolidado. Pensado para "todos editam a própria escala, mas só
//     quem administra mexe em dinheiro de outra pessoa". Omitir = []. Quem já tem a
//     equipe em adminOf não precisa repetir aqui — adminOf já cobre edição de escala.
//   - `role` NÃO é mais um campo — é derivado por resolveAccess() a partir de
//     adminOf/memberId (ver abaixo); scheduleEditOf NÃO afeta role (continua
//     'member') nem canAccessCH — só desbloqueia o modo de edição da Escala.
//   - E-mails não listados aqui recebem role: 'viewer' e sem acesso ao CH
//   - Comparação de e-mail é case-insensitive
//
// ⚠ MANTENHA O REPOSITÓRIO PRIVADO — este arquivo contém e-mails da equipe.

export const ALLOWLIST = {
  // ─── Sustentação ────────────────────────────────────────────────────────────
  'alice.santos@mtpagamentos.com.br':      { memberId: 'Alice',        teamId: 'sustentacao', adminOf: [] },
  'emanoel.barros@mtpagamentos.com.br':    { memberId: 'Emanoel',      teamId: 'sustentacao', adminOf: [] },
  'raul.vitti@mtpagamentos.com.br':        { memberId: 'Raul',         teamId: 'sustentacao', adminOf: [] },
  'marcus.silva@mtpagamentos.com.br':      { memberId: 'Marcus Túlio', teamId: 'sustentacao', adminOf: [] },
  'ricardo.correa@mtpagamentos.com.br':    { memberId: 'Ricardo',      teamId: 'sustentacao', adminOf: '*' }, // ⚠ admin de TODAS as equipes — para testes da migração multi-equipe; reduzir para ['sustentacao'] quando terminarem
  'carlos.beda@mtpagamentos.com.br':       { memberId: 'Carlos',       teamId: 'sustentacao', adminOf: ['sustentacao'] },
  'cbeda.de@gmail.com':                    { memberId: 'Carlos',       teamId: 'sustentacao', adminOf: [] }, // segundo e-mail do Carlos — sem admin aqui (mantido do formato anterior)
  'alessandra.lisboa@mtpagamentos.com.br': { memberId: null,          teamId: null,           adminOf: ['sustentacao'] }, // administra só a sustentação; fora de qualquer escala (sem CH próprio)

  // ─── Infraestrutura ─────────────────────────────────────────────────────────
  'alberth.teixeira@mtpagamentos.com.br':  { memberId: 'Alberth', teamId: 'infra', adminOf: ['infra'] }, // administra E faz plantão
  'gabriel.pavanelli@mtpagamentos.com.br': { memberId: 'Gabriel', teamId: 'infra', adminOf: [] },
  'antonio.santos@mtpagamentos.com.br':    { memberId: 'Antonio', teamId: 'infra', adminOf: [] },
  'diogo.ferrolho@mtpagamentos.com.br':    { memberId: 'Diogo',   teamId: 'infra', adminOf: [] },
  'caio.rodrigues@mtpagamentos.com.br':    { memberId: 'Caio',    teamId: 'infra', adminOf: [] },

  // ─── Desenvolvimento ────────────────────────────────────────────────────────
  // Todos os 9 têm scheduleEditOf: ['desenvolvimento'] — editam a escala completa
  // da própria equipe (qualquer turno, qualquer pessoa do roster), mas sem CH de
  // outra pessoa, sem fechar/reabrir mês e sem relatório consolidado (isso continua
  // exclusivo de adminOf). Anselmo e Leonardo Menegon já têm adminOf cobrindo a
  // equipe, então já tinham (e continuam tendo) esse acesso — scheduleEditOf seria
  // redundante para os dois.
  'anselmo.barreto@mtpagamentos.com.br':    { memberId: null,               teamId: null,              adminOf: ['desenvolvimento'] }, // admin puro, não faz plantão (ver docs/specs/multi-equipe.md §Fatos pendentes)
  'leonardo.rodrigues@mtpagamentos.com.br': { memberId: 'Leonardo Menegon', teamId: 'desenvolvimento', adminOf: ['desenvolvimento'] }, // ⚠ admin TEMPORÁRIO para testes — remover de adminOf quando terminarem
  'luis.cunha@mtpagamentos.com.br':         { memberId: 'Luis',             teamId: 'desenvolvimento', adminOf: [], scheduleEditOf: ['desenvolvimento'] },
  'adalberto.teshima@mtpagamentos.com.br':  { memberId: 'Adalberto',        teamId: 'desenvolvimento', adminOf: [], scheduleEditOf: ['desenvolvimento'] },
  'pedro.soares@mtpagamentos.com.br':       { memberId: 'Pedro',            teamId: 'desenvolvimento', adminOf: [], scheduleEditOf: ['desenvolvimento'] },
  'dante.escame@mtpagamentos.com.br':       { memberId: 'Dante',            teamId: 'desenvolvimento', adminOf: [], scheduleEditOf: ['desenvolvimento'] },
  'leonardo.santos@mtpagamentos.com.br':    { memberId: 'Leonardo Matheus', teamId: 'desenvolvimento', adminOf: [], scheduleEditOf: ['desenvolvimento'] },
  'jonata.gomes@mtpagamentos.com.br':       { memberId: 'Jonata',           teamId: 'desenvolvimento', adminOf: [], scheduleEditOf: ['desenvolvimento'] },
  'icaro.motta@mtpagamentos.com.br':        { memberId: 'Ícaro',            teamId: 'desenvolvimento', adminOf: [], scheduleEditOf: ['desenvolvimento'] },
};

const emptyAccess = { memberId: null, teamId: null, adminOf: [], scheduleEditOf: [], role: 'viewer' };

/**
 * Resolve o acesso de um usuário a partir do e-mail verificado.
 * Retorna { memberId, teamId, adminOf, scheduleEditOf, role }. `role` é derivado só de
 * adminOf/memberId — scheduleEditOf nunca eleva a admin (ver comentário no topo do arquivo):
 *   - 'admin'  se adminOf === '*' ou é um array não-vazio
 *   - 'member' se há memberId (e não é admin)
 *   - 'viewer' caso contrário (inclusive e-mail não listado)
 */
export function resolveAccess(email) {
  if (!email) return emptyAccess;
  const entry = ALLOWLIST[email.toLowerCase()];
  if (!entry) return emptyAccess;
  const { memberId = null, teamId = null, adminOf = [], scheduleEditOf = [] } = entry;
  const isAdmin = adminOf === '*' || (Array.isArray(adminOf) && adminOf.length > 0);
  const role = isAdmin ? 'admin' : memberId ? 'member' : 'viewer';
  return { memberId, teamId, adminOf, scheduleEditOf, role };
}

/** true se `adminOf` cobre `teamId` (admin daquela equipe específica, ou de todas). */
export function adminCovers(adminOf, teamId) {
  return teamScopeCovers(adminOf, teamId);
}

/**
 * true se `adminOf` OU `scheduleEditOf` cobrem `teamId` — usado só pela autorização
 * de escrita da ESCALA (api/schedule.js). Admin completo de uma equipe já cobre isso;
 * scheduleEditOf existe para dar esse mesmo direito de edição a quem NÃO deve ganhar
 * o resto de adminOf (CH de outra pessoa, fechamento de mês, relatório consolidado —
 * ver comentário no topo do arquivo). Nunca usar para nada além de schedule.js.
 */
export function scheduleCovers(adminOf, scheduleEditOf, teamId) {
  return teamScopeCovers(adminOf, teamId) || teamScopeCovers(scheduleEditOf, teamId);
}
