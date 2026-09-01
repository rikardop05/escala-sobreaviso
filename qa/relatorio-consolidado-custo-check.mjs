import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  buildSchedule,
  mergedHours,
} from '../src/lib/schedule.js';
import {
  isEntryCountable,
  monthTotals,
  scheduleEntriesFor,
  splitHoraExtra,
} from '../src/lib/chCalc.js';
import { MEMBERS, TEAMS, chGroupsFor, teamScopeCovers } from '../src/lib/teams.js';
import { adminCovers, resolveAccess } from '../api/_allowlist.js';
import { ChClosePostSchema } from '../api/_validate.js';

// A visão de custo da spec é o componente RelatorioCusto.jsx (UI) + a camada pura
// src/lib/custoConsolidado.js (agregação financeira e CSV via buildCustoCsv). A
// "Tabela de fechamento" legada fica em RelatorioConsolidado.jsx — não é o alvo.
const viewPath = resolve('src/components/RelatorioCusto.jsx');
const viewSource = await readFile(viewPath, 'utf8');

const custoPath = resolve('src/lib/custoConsolidado.js');
const custoSource = await readFile(custoPath, 'utf8');

const checks = [];
function check(id, category, fn) {
  try {
    fn();
    checks.push({ id, category, status: 'PASS' });
  } catch (error) {
    checks.push({ id, category, status: 'FAIL', detail: error.message });
  }
}

const entry = (tipo, data, inicio, fim, extra = {}) => ({
  id: `${tipo}-${data}-${inicio}-${fim}`,
  person: 'Alice',
  tipo,
  data,
  inicio,
  fim,
  ...extra,
});

// Financial rules and rounding inputs that are shared by the individual and
// consolidated reports.
check('calc-components-and-compensation', 'calculo', () => {
  const totals = monthTotals([
    entry('Sobreaviso', '2026-08-03', '09:00', '12:00'),
    entry('Hora Extra', '2026-08-03', '13:00', '15:00'),
    entry('Compensação', '2026-08-03', '16:00', '17:00'),
  ], 100);

  assert.equal(totals.sobreaviso, 3);
  assert.equal(totals.extra, 2);
  assert.equal(totals.comp, 1);
  assert.equal(totals.valorSobreaviso, 100);
  assert.equal(totals.valorExtra, 300);
  assert.equal(totals.valorComp, 100 / 3);
  assert.equal(totals.valorSobreaviso + totals.valorExtra - totals.valorComp, 400 - 100 / 3);
});

check('same-type-overlap-is-unioned', 'calculo', () => {
  const extraHours = mergedHours([
    entry('Hora Extra', '2026-08-03', '10:00', '12:00'),
    entry('Hora Extra', '2026-08-03', '11:00', '13:00'),
  ]);
  const compensationHours = mergedHours([
    entry('Compensação', '2026-08-03', '11:00', '13:00'),
  ]);
  assert.equal(extraHours, 3);
  assert.equal(compensationHours, 2);
});

check('pending-and-rejected-excluded-from-realized', 'he-status', () => {
  assert.equal(isEntryCountable(entry('Hora Extra', '2026-08-03', '10:00', '11:00')), true);
  assert.equal(isEntryCountable(entry('Hora Extra', '2026-08-03', '10:00', '11:00', { status: 'aprovado' })), true);
  assert.equal(isEntryCountable(entry('Hora Extra', '2026-08-03', '10:00', '11:00', { status: 'pendente' })), false);
  assert.equal(isEntryCountable(entry('Hora Extra', '2026-08-03', '10:00', '11:00', { status: 'rejeitado' })), false);
});

check('effective-substitution-is-used-by-sobreaviso', 'calculo', () => {
  const schedule = [{
    date: new Date(2026, 7, 3, 12),
    shifts: [{ period: 'Dia', time: '09:00 – 12:00', person: 'Alice' }],
  }];
  const rows = scheduleEntriesFor(schedule, [{
    titular: 'Alice', substituto: 'Emanoel', from: '2026-08-03', until: '2026-08-03',
  }], 'Emanoel', 7, 2026);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tipo, 'Sobreaviso');
});

check('hora-extra-split-creates-approved-and-pending-parts', 'he-status', () => {
  const schedule = [{
    date: new Date(2026, 7, 3, 12),
    shifts: [{ period: 'Dia', time: '09:00 – 12:00', person: 'Alice' }],
  }];
  const parts = splitHoraExtra(schedule, [], '00:00', 'Alice', '2026-08-03', '11:00', '13:00');
  assert.deepEqual(parts.map(p => [p.inicio, p.fim, p.aprovado]), [
    ['11:00', '12:00', true],
    ['12:00', '13:00', false],
  ]);
});

// adminOf is the financial boundary; scheduleEditOf must not elevate a user.
check('admin-scope-is-limited-to-adminOf', 'permissoes', () => {
  assert.deepEqual(chGroupsFor(['infra']).map(group => group.teamId), ['infra']);
  assert.deepEqual(chGroupsFor('*').map(group => group.teamId), Object.keys(TEAMS));
  assert.equal(teamScopeCovers(['infra'], 'sustentacao'), false);
  assert.equal(adminCovers(['infra'], 'sustentacao'), false);
  assert.equal(resolveAccess('luis.cunha@mtpagamentos.com.br').role, 'member');
  assert.equal(resolveAccess('luis.cunha@mtpagamentos.com.br').adminOf.length, 0);
  assert.equal(resolveAccess('alberth.teixeira@mtpagamentos.com.br').role, 'admin');
});

check('team-start-date-produces-no-historical-rows', 'meses-e-estados', () => {
  const infraSchedule = buildSchedule(TEAMS.infra);
  assert.equal(infraSchedule[0].date.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(infraSchedule.some(day => day.date.getMonth() === 6), false);
  assert.equal(MEMBERS.Alberth.teamId, 'infra');
});

check('snapshot-preserves-compensation-value', 'snapshots', () => {
  const parsed = ChClosePostSchema.safeParse({
    person: 'Alice',
    month: '2026-08',
    snapshot: {
      params: { remuneracao: 16800, jornada: 168 },
      totals: {
        sobreaviso: 3, extra: 2, comp: 1, totalHoras: 6, valorHora: 100,
        valorSobreaviso: 100, valorExtra: 300, valorComp: 33.33, valorTotal: 400,
      },
      entries: [],
    },
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.snapshot.totals.valorComp, 33.33);
});

// These checks are deliberately contract checks, not guesses about the future
// implementation. They fail while the current report still exposes the legacy
// monthly table, making missing acceptance criteria visible in CI or locally.
const requiredReportTokens = [
  ['metric-filter', /M[eé]trica/],
  ['status-filter', /Situa[cç][aã]o/],
  ['remuneration-filter', /remunera[cç][aã]o/i],
  ['people-filter', /Pessoas/],
  ['period-filter', /Per[ií]odo/],
  ['monthly-cost-label', /Custo Mensal/],
  ['variable-cost-label', /Custo Vari[aá]vel/],
  ['accessible-detail-team', /Equipe/],
  ['estimated-state', /Estimad/],
  ['pending-state', /pend[eê]n/],
  ['no-period-data-state', /Sem dados/],
  ['no-activity-state', /Sem atividade/],
  ['open-month-state', /recalculad|Em aberto/i],
];
for (const [id, pattern] of requiredReportTokens) {
  check(id, 'filtros-estados-detalhamento', () => {
    assert.ok(pattern.test(viewSource), `required contract token not found: ${pattern}`);
  });
}

check('loading-and-error-roles', 'estados', () => {
  assert.ok(/role="status"/.test(viewSource));
  assert.ok(/role="alert"/.test(viewSource));
});

check('snapshot-read-failure-is-not-silent', 'snapshots', () => {
  // A visão de custo delega a carga a loadCustoSources (lib), que aguarda
  // /api/ch-close SEM engolir a falha — a spec proíbe converter falha de fonte
  // em "mês aberto/ausência real". Nada de `.catch(() => ({}))` aqui.
  assert.ok(/loadCustoSources/.test(viewSource), 'cost view does not delegate the load to loadCustoSources');
  assert.ok(!/\.catch\(\(\) => \(\{\}\)\)/.test(custoSource),
    'custoConsolidado swallows a source failure (treated as open month)');
});

check('csv-has-spec-metadata', 'exportacao', () => {
  assert.ok(/buildCustoCsv/.test(viewSource), 'view does not export via buildCustoCsv');
  assert.ok(/const header = \[/.test(custoSource), 'CSV header not found in buildCustoCsv');
  for (const label of ['Período', 'Equipes', 'Pessoas', 'Métrica', 'Situação']) {
    assert.ok(custoSource.includes(label), `CSV metadata not found in buildCustoCsv: ${label}`);
  }
});

check('csv-excludes-local-adjustments', 'exportacao', () => {
  // Ajustes locais não persistidos nunca entram: a lib nem os recebe (a UI os
  // deixa fora de gráfico, indicadores, CSV e PDF — só a "Tabela de fechamento"
  // legada, que não é esta visão, os trata).
  assert.ok(!/adjustments/.test(custoSource), 'buildCustoCsv includes local adjustments');
  assert.ok(/buildCustoCsv/.test(viewSource), 'view does not export via buildCustoCsv');
});

check('pdf-or-print-export-exists', 'exportacao', () => {
  assert.ok(/PDF|window\.print/.test(viewSource), 'PDF or print export is not implemented');
});

const failed = checks.filter(checkResult => checkResult.status === 'FAIL');
for (const result of checks) {
  const suffix = result.detail ? ` - ${result.detail}` : '';
  console.log(`${result.status} [${result.category}] ${result.id}${suffix}`);
}
console.log(`\n${checks.length} checks: ${checks.length - failed.length} passed, ${failed.length} failed`);

if (failed.length) process.exitCode = 1;
