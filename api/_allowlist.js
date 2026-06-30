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
  // 'email@dominio.com.br': { memberId: 'NomeExato', role: 'member' },
  // 'admin@dominio.com.br': { memberId: 'NomeExato', role: 'admin'  },
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
