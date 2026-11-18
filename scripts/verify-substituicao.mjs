#!/usr/bin/env node
// Verifica a substituição por turno (CLAUDE.md — Substituições; shiftSub em
// src/lib/schedule.js): troca Dia↔Noite no FDS, inclusive entre quem JÁ é substituto
// (caso de produção: sáb 28/11/2026, Raul→Ricardo e Marcus Túlio→Emanoel, trocar os dois).
// Node puro, sem Redis. Uso: node scripts/verify-substituicao.mjs — sai 0 se passar.

import { buildSchedule, dayKey, resolveShiftPeople, currentOnCall, adjacentOnCall, effectiveWeekendFolga } from '../src/lib/schedule.js';
import { TEAMS } from '../src/lib/teams.js';
import { subPostSchemaFor } from '../api/_validate.js';

let failures = 0;
function check(label, pass, detail) {
  if (pass) console.log(`OK   ${label}`);
  else { failures++; console.error(`FAIL ${label}${detail !== undefined ? ' — ' + detail : ''}`); }
}

const team = TEAMS.sustentacao;
const DK = '2026-11-28';
const sched = buildSchedule(team, {}, {});
const day = sched.find(d => dayKey(d.date) === DK);
const [dia, noite] = day.shifts;
const names = (subs) => day.shifts.map(s => resolveShiftPeople(s, DK, subs).map(r => r.person).join('+')).join('|');
const sub = (id, titular, substituto, turnos) => ({ id: String(id), titular, substituto, from: DK, until: DK, ...(turnos ? { turnos } : {}) });

check('base: Dia=Raul, Noite=Marcus Túlio', names([]) === 'Raul|Marcus Túlio', names([]));

// Legado (sem turnos) — inalterado
const legacy = [sub(1, 'Raul', 'Ricardo'), sub(2, 'Marcus Túlio', 'Emanoel')];
check('legado: Raul→Ricardo e Marcus→Emanoel', names(legacy) === 'Ricardo|Emanoel', names(legacy));
const swapBase = [sub(1, 'Raul', 'Marcus Túlio'), sub(2, 'Marcus Túlio', 'Raul')];
check('legado: troca direta entre os titulares', names(swapBase) === 'Marcus Túlio|Raul', names(swapBase));

// O caso reportado: quem já é substituto, trocados entre si SEM escopo de turno → nada muda (limite do modelo antigo)
const swapNoScope = [...legacy, sub(3, 'Ricardo', 'Emanoel'), sub(4, 'Emanoel', 'Ricardo')];
check('sem turno: trocar substitutos não faz nada (comportamento antigo)', names(swapNoScope) === 'Ricardo|Emanoel', names(swapNoScope));

// Com turno: a troca vale
const swapScoped = [...legacy, sub(3, 'Ricardo', 'Emanoel', ['Dia']), sub(4, 'Emanoel', 'Ricardo', ['Noite'])];
check('com turno: Ricardo(Dia)↔Emanoel(Noite) troca', names(swapScoped) === 'Emanoel|Ricardo', names(swapScoped));
const r = resolveShiftPeople(dia, DK, swapScoped)[0];
check('com turno: Emanoel no Dia cobre Ricardo', r.person === 'Emanoel' && r.coveringFor === 'Ricardo' && r.titular === 'Raul', JSON.stringify(r));

// Substituição com turno só mexe naquele turno
const onlyDia = [sub(1, 'Raul', 'Ricardo', ['Dia'])];
check('turno Dia: só o Dia muda', names(onlyDia) === 'Ricardo|Marcus Túlio', names(onlyDia));
const wrongTurno = [sub(1, 'Raul', 'Ricardo', ['Noite'])];
check('turno Noite para titular do Dia: nada muda', names(wrongTurno) === 'Raul|Marcus Túlio', names(wrongTurno));

// Ordem de criação decide encadeamento (id)
const reordered = [sub(4, 'Emanoel', 'Ricardo', ['Noite']), sub(3, 'Ricardo', 'Emanoel', ['Dia']), ...legacy];
check('ordem do array não importa, vale a ordem de criação', names(reordered) === 'Emanoel|Ricardo', names(reordered));

// Turno editado à mão (override de pessoas) segue a mesma regra
{
  const ov = { [DK]: { '0': { persons: ['Ricardo'], editedAt: new Date(1).toISOString() }, '1': { persons: ['Emanoel'], editedAt: new Date(1).toISOString() } } };
  const d2 = buildSchedule(team, ov, {}).find(d => dayKey(d.date) === DK);
  const n2 = (subs) => d2.shifts.map(s => resolveShiftPeople(s, DK, subs).map(x => x.person).join('+')).join('|');
  const sw = [sub(3, 'Ricardo', 'Emanoel', ['Dia']), sub(4, 'Emanoel', 'Ricardo', ['Noite'])];
  check('turnos editados: troca por turno vale', n2(sw) === 'Emanoel|Ricardo', n2(sw));
}

// Widget "Agora"/CH usam a mesma regra
{
  const at = new Date(2026, 10, 28, 15, 0, 0); // sáb 15:00 → Noite
  const now = currentOnCall(at, sched, swapScoped, team.dayStart);
  check('Agora (sáb 15:00): Ricardo na Noite, cobrindo Emanoel', now?.people?.[0]?.person === 'Ricardo' && now.people[0].coveringFor === 'Emanoel', JSON.stringify(now?.people));
  const adj = adjacentOnCall(at, sched, swapScoped, team.dayStart);
  check('Handoff: anterior (Dia) = Emanoel', adj?.anterior?.people?.[0] === 'Emanoel', JSON.stringify(adj?.anterior));
  const folga = effectiveWeekendFolga(team, sched, swapScoped).get(DK);
  check('Folga FDS reflete a troca (Raul e Marcus folgam; Ricardo e Emanoel não)', folga.includes('Raul') && folga.includes('Marcus Túlio') && !folga.includes('Ricardo') && !folga.includes('Emanoel'), JSON.stringify(folga));
}

// Validação do POST
{
  const S = subPostSchemaFor('sustentacao');
  const base = { team: 'sustentacao', titular: 'Ricardo', substituto: 'Emanoel', from: DK, until: DK };
  check('POST: sem turnos válido', S.safeParse(base).success);
  check('POST: com turnos válido', S.safeParse({ ...base, turnos: ['Dia'] }).success);
  check('POST: turnos vazio rejeitado', !S.safeParse({ ...base, turnos: [] }).success);
  check('POST: turnos com item vazio rejeitado', !S.safeParse({ ...base, turnos: [''] }).success);
}

if (failures) { console.error(`\n${failures} verificação(ões) falharam.`); process.exit(1); }
console.log('\nTodas as verificações passaram.');
