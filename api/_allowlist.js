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
//   - adminOf: array de teamIds que a pessoa administra (escala + CH), ou '*'
//     para administrar todas as equipes. [] = não administra nenhuma.
//   - `role` NÃO é mais um campo — é derivado por resolveAccess() a partir de
//     adminOf/memberId (ver abaixo)
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
  'ricardo.correa@mtpagamentos.com.br':    { memberId: 'Ricardo',      teamId: 'sustentacao', adminOf: ['sustentacao'] },
  'carlos.beda@mtpagamentos.com.br':       { memberId: 'Carlos',       teamId: 'sustentacao', adminOf: ['sustentacao'] },
  'cbeda.de@gmail.com':                    { memberId: 'Carlos',       teamId: 'sustentacao', adminOf: [] }, // segundo e-mail do Carlos — sem admin aqui (mantido do formato anterior)
  'alessandra.lisboa@mtpagamentos.com.br': { memberId: null,          teamId: null,           adminOf: '*' }, // admin de todas as equipes, fora de qualquer escala

  // ─── Infraestrutura ─────────────────────────────────────────────────────────
  'alberth.teixeira@mtpagamentos.com.br':  { memberId: 'Alberth', teamId: 'infra', adminOf: ['infra'] }, // administra E faz plantão
  'gabriel.pavanelli@mtpagamentos.com.br': { memberId: 'Gabriel', teamId: 'infra', adminOf: [] },
  'antonio.santos@mtpagamentos.com.br':    { memberId: 'Antonio', teamId: 'infra', adminOf: [] },
  'diogo.ferrolho@mtpagamentos.com.br':    { memberId: 'Diogo',   teamId: 'infra', adminOf: [] },
  'caio.rodrigues@mtpagamentos.com.br':    { memberId: 'Caio',    teamId: 'infra', adminOf: [] },

  // ─── Desenvolvimento ────────────────────────────────────────────────────────
  'anselmo.barreto@mtpagamentos.com.br':    { memberId: null,               teamId: null,              adminOf: ['desenvolvimento'] }, // admin puro, não faz plantão (ver docs/specs/multi-equipe.md §Fatos pendentes)
  'leonardo.rodrigues@mtpagamentos.com.br': { memberId: 'Leonardo Menegon', teamId: 'desenvolvimento', adminOf: ['desenvolvimento'] }, // ⚠ admin TEMPORÁRIO para testes — remover de adminOf quando terminarem
  'luis.cunha@mtpagamentos.com.br':         { memberId: 'Luis',             teamId: 'desenvolvimento', adminOf: [] },
  'adalberto.teshima@mtpagamentos.com.br':  { memberId: 'Adalberto',        teamId: 'desenvolvimento', adminOf: [] },
  'pedro.soares@mtpagamentos.com.br':       { memberId: 'Pedro',            teamId: 'desenvolvimento', adminOf: [] },
  'dante.escame@mtpagamentos.com.br':       { memberId: 'Dante',            teamId: 'desenvolvimento', adminOf: [] },
  'leonardo.santos@mtpagamentos.com.br':    { memberId: 'Leonardo Matheus', teamId: 'desenvolvimento', adminOf: [] },
  'jonata.gomes@mtpagamentos.com.br':       { memberId: 'Jonata',           teamId: 'desenvolvimento', adminOf: [] },
  'icaro.motta@mtpagamentos.com.br':        { memberId: 'Ícaro',            teamId: 'desenvolvimento', adminOf: [] },
};

const emptyAccess = { memberId: null, teamId: null, adminOf: [], role: 'viewer' };

/**
 * Resolve o acesso de um usuário a partir do e-mail verificado.
 * Retorna { memberId, teamId, adminOf, role }. `role` é derivado:
 *   - 'admin'  se adminOf === '*' ou é um array não-vazio
 *   - 'member' se há memberId (e não é admin)
 *   - 'viewer' caso contrário (inclusive e-mail não listado)
 */
export function resolveAccess(email) {
  if (!email) return emptyAccess;
  const entry = ALLOWLIST[email.toLowerCase()];
  if (!entry) return emptyAccess;
  const { memberId = null, teamId = null, adminOf = [] } = entry;
  const isAdmin = adminOf === '*' || (Array.isArray(adminOf) && adminOf.length > 0);
  const role = isAdmin ? 'admin' : memberId ? 'member' : 'viewer';
  return { memberId, teamId, adminOf, role };
}

/** true se `adminOf` cobre `teamId` (admin daquela equipe específica, ou de todas). */
export function adminCovers(adminOf, teamId) {
  return adminOf === '*' || (Array.isArray(adminOf) && adminOf.includes(teamId));
}
