#!/usr/bin/env node
// Verifica a classificação aprovado/pendente de Hora Extra excedente (ver CLAUDE.md
// "Aprovação de excedente" e CONTEXT.md — Excedente/Aprovação) contra os casos do
// aceite original. Node puro, sem dependências novas, sem Redis — só a lógica pura
// de src/lib/schedule.js e src/lib/chCalc.js, as mesmas que api/ch.js chama.
//
// Uso: node scripts/verify-aprovacao.mjs
// Sai com 0 se tudo passar; 1 e imprime o que divergiu, senão.

import { buildSchedule, durationHours, dayKey, RANGE_START } from '../src/lib/schedule.js';
import { TEAMS } from '../src/lib/teams.js';
import { splitHoraExtra, isEntryCountable } from '../src/lib/chCalc.js';

let failures = 0;
function check(label, pass, detail) {
  if (pass) {
    console.log(`OK   ${label}`);
  } else {
    failures++;
    console.error(`FAIL ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  }
}

function fmtParts(parts) {
  return parts.map(p => `${p.data} ${p.inicio}–${p.fim} (${p.aprovado ? 'aprovado' : 'pendente'})`).join(', ') || '(vazio)';
}

function sameParts(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const sustentacao = TEAMS.sustentacao;
// Uma única escala real da sustentação (sem overrides) — os mesmos dados que
// api/ch.js reconstrói via buildSchedule(team, overrides) a partir do Redis.
const schedule = buildSchedule(sustentacao, {}, {});

// ─── (a) Ricardo, 2026-09-01 (terça), HE 02:00–04:30 ──────────────────────────
// Madrugada de terça (23:00–04:00) é de Ricardo e, por ser pernoite (ADR-0002),
// começa 23:00 de segunda — cobre até as 04:00 de terça. 02:00–04:00 cai dentro;
// 04:00–04:30 sobra.
{
  const parts = splitHoraExtra(schedule, [], sustentacao.dayStart, 'Ricardo', '2026-09-01', '02:00', '04:30');
  const expected = [
    { data: '2026-09-01', inicio: '02:00', fim: '04:00', aprovado: true },
    { data: '2026-09-01', inicio: '04:00', fim: '04:30', aprovado: false },
  ];
  check('(a) Ricardo, 01/09 (terça), HE 02:00–04:30 → 2h aprovadas + 30min pendentes', sameParts(parts, expected), fmtParts(parts));
}

// ─── (b) Alice, mesma data, sem plantão nenhum, HE 14:00–16:00 ────────────────
{
  const parts = splitHoraExtra(schedule, [], sustentacao.dayStart, 'Alice', '2026-09-01', '14:00', '16:00');
  const expected = [{ data: '2026-09-01', inicio: '14:00', fim: '16:00', aprovado: false }];
  check('(b) Alice sem plantão em 01/09, HE 14:00–16:00 → 2h pendentes', sameParts(parts, expected), fmtParts(parts));
}

// ─── (c) Escala sintética — Manhã 04:00–09:00 + Noite 18:00–23:00, mesma pessoa,
//         HE 08:00–19:00 → 1h aprovada + 9h pendente + 1h aprovada ─────────────
{
  const data = '2026-09-01';
  const day = {
    date: new Date(`${data}T12:00:00`),
    dow: new Date(`${data}T12:00:00`).getDay(),
    shifts: [
      { idx: 0, period: 'Manhã', time: '04:00 – 09:00', person: 'Teste' },
      { idx: 1, period: 'Noite', time: '18:00 – 23:00', person: 'Teste' },
    ],
    folga: [], cycleWeek: null, label: null,
  };
  const parts = splitHoraExtra([day], [], '00:00', 'Teste', data, '08:00', '19:00');
  const expected = [
    { data, inicio: '08:00', fim: '09:00', aprovado: true },
    { data, inicio: '09:00', fim: '18:00', aprovado: false },
    { data, inicio: '18:00', fim: '19:00', aprovado: true },
  ];
  check('(c) sintético Manhã+Noite, HE 08:00–19:00 → 1h + 9h + 1h', sameParts(parts, expected), fmtParts(parts));
}

// ─── (d) PERNOITE — 2026-09-07 (segunda), Ricardo, HE 23:00–01:00 ─────────────
// A Madrugada de terça (08/09) começa 23:00 de segunda (07/09) — o lançamento
// inteiro cai dentro, mesmo cruzando a meia-noite. Este é o caso que prova que a
// janela é ancorada em minutos relativos à DATA DO LANÇAMENTO, não aos turnos
// declarados sob aquele dia do calendário.
{
  const parts = splitHoraExtra(schedule, [], sustentacao.dayStart, 'Ricardo', '2026-09-07', '23:00', '01:00');
  const expected = [{ data: '2026-09-07', inicio: '23:00', fim: '01:00', aprovado: true }];
  check('(d) pernoite — Ricardo, 07/09 (segunda), HE 23:00–01:00 → 2h aprovadas', sameParts(parts, expected), fmtParts(parts));
}

// ─── (e) INVARIANTE — 500 intervalos determinísticos: soma das partes = duração
//         original; partes contíguas (fim de uma = início da seguinte) ────────
{
  // LCG simples, seed fixa — determinístico entre execuções (nunca Math.random).
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const fmtMin = (min) => {
    const m = ((min % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

  const roster = sustentacao.roster;
  let invariantOk = true;
  let firstBad = null;

  for (let i = 0; i < 500; i++) {
    const person = roster[Math.floor(rand() * roster.length)];
    const dayOffset = Math.floor(rand() * 90); // 90 dias a partir de RANGE_START — dentro da escala gerada
    const data = dayKey(new Date(RANGE_START.getTime() + dayOffset * 86400000));
    const startMin = Math.floor(rand() * 1440);
    const durMin = 1 + Math.floor(rand() * 600); // 1min a 10h — nunca gira mais de uma volta
    const inicio = fmtMin(startMin);
    const fim = fmtMin(startMin + durMin);

    const parts = splitHoraExtra(schedule, [], sustentacao.dayStart, person, data, inicio, fim);
    const originalDur = durationHours(inicio, fim) * 60;

    // Converte cada parte para minutos absolutos relativos a `data`, tratando
    // offset de dia (addDays) e a mesma convenção fim<=início soma 24h.
    let cursor = null;
    let sumMin = 0;
    let contiguous = true;
    for (const p of parts) {
      const offset = daysBetween(data, p.data) * 1440;
      let s = toMin(p.inicio) + offset;
      let e = toMin(p.fim) + offset;
      if (e <= s) e += 1440;
      if (cursor !== null && s !== cursor) contiguous = false;
      cursor = e;
      sumMin += (e - s);
    }
    const firstStart = parts.length ? toMin(parts[0].inicio) + daysBetween(data, parts[0].data) * 1440 : null;
    const startsRight = parts.length === 0 ? durMin === 0 : firstStart === startMin;
    const sumRight = sumMin === durMin;

    if (!contiguous || !startsRight || !sumRight) {
      invariantOk = false;
      firstBad = { i, person, data, inicio, fim, parts, sumMin, durMin, contiguous, startsRight };
      break;
    }
  }
  check(
    '(e) invariante — 500 intervalos: soma == duração original, partes contíguas',
    invariantOk,
    firstBad ? JSON.stringify(firstBad) : undefined
  );
}

// ─── (f) Substituição Ricardo→Alice em 2026-09-01 ─────────────────────────────
// A Madrugada de terça é declarada sob 2026-09-01 (dow=2) — a substituição precisa
// cobrir essa data (não a data em que o segmento pernoite fisicamente começa).
{
  const subs = [{ id: 'sub-1', titular: 'Ricardo', substituto: 'Alice', from: '2026-09-01', until: '2026-09-01' }];
  const partsAlice = splitHoraExtra(schedule, subs, sustentacao.dayStart, 'Alice', '2026-09-01', '02:00', '04:30');
  const partsRicardo = splitHoraExtra(schedule, subs, sustentacao.dayStart, 'Ricardo', '2026-09-01', '02:00', '04:30');
  const expectedAlice = [
    { data: '2026-09-01', inicio: '02:00', fim: '04:00', aprovado: true },
    { data: '2026-09-01', inicio: '04:00', fim: '04:30', aprovado: false },
  ];
  const expectedRicardo = [{ data: '2026-09-01', inicio: '02:00', fim: '04:30', aprovado: false }];
  check('(f) substituição Ricardo→Alice — Alice ganha o sobreaviso', sameParts(partsAlice, expectedAlice), fmtParts(partsAlice));
  check('(f) substituição Ricardo→Alice — Ricardo fica sem SA nesse turno', sameParts(partsRicardo, expectedRicardo), fmtParts(partsRicardo));
}

// ─── (g) isEntryCountable ──────────────────────────────────────────────────────
{
  check('(g) sem status → conta', isEntryCountable({ tipo: 'Hora Extra' }) === true);
  check("(g) status 'aprovado' → conta", isEntryCountable({ tipo: 'Hora Extra', status: 'aprovado' }) === true);
  check("(g) status 'pendente' → não conta", isEntryCountable({ tipo: 'Hora Extra', status: 'pendente' }) === false);
  check("(g) status 'rejeitado' → não conta", isEntryCountable({ tipo: 'Hora Extra', status: 'rejeitado' }) === false);
}

console.log('');
if (failures > 0) {
  console.error(`${failures} verificação(ões) falharam.`);
  process.exit(1);
} else {
  console.log('Todas as verificações passaram.');
  process.exit(0);
}
