// ─── ALLOWLIST DE ACESSO ──────────────────────────────────────────────────────
//
// Edite este arquivo para adicionar/remover membros e definir quem é admin.
//
// Regras:
//   - memberId DEVE bater exatamente com uma chave de PEOPLE em src/lib/schedule.js
//   - role: 'admin' | 'member'
//   - E-mails não listados aqui recebem role: 'viewer' e sem acesso ao CH
//   - Comparação de e-mail é case-insensitive
//
// ⚠ MANTENHA O REPOSITÓRIO PRIVADO — este arquivo contém e-mails da equipe.

export const ALLOWLIST = {
  'alice.santos@mtpagamentos.com.br':   { memberId: 'Alice',         role: 'member' },
  'emanoel.barros@mtpagamentos.com.br': { memberId: 'Emanoel',       role: 'member' },
  'raul.vitti@mtpagamentos.com.br':     { memberId: 'Raul',          role: 'member' },
  'marcus.silva@mtpagamentos.com.br':   { memberId: 'Marcus Túlio',  role: 'member' },
  'ricardo.correa@mtpagamentos.com.br': { memberId: 'Ricardo',       role: 'member' },
  'carlos.beda@mtpagamentos.com.br':    { memberId: 'Carlos',        role: 'admin'  },
};

/**
 * Resolve o acesso de um usuário a partir do e-mail verificado.
 * Retorna { memberId, role } ou { memberId: null, role: 'viewer' } se não listado.
 */
export function resolveAccess(email) {
  if (!email) return { memberId: null, role: 'viewer' };
  const entry = ALLOWLIST[email.toLowerCase()];
  return entry ?? { memberId: null, role: 'viewer' };
}
