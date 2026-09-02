import React, { useState } from 'react';
import MeuResumoFinanceiro from './components/MeuResumoFinanceiro';
import { custoPessoal, currentMonthKey, monthKeysForRange } from './lib/custoConsolidado';
import { buildSchedule, durationHours } from './lib/schedule';
import { scheduleEntriesFor } from './lib/chCalc';
import { TEAMS } from './lib/teams';
import { getTheme } from './lib/theme';
import { Button, Icon } from './components/ui';

// ─── FIXTURE DE DEMONSTRAÇÃO (somente desenvolvimento) ─────────────────────────
// Rota `#meu-resumo-demo`. Dados 100% SINÉTICOS, claramente separados da
// produção (sem nenhum dado real): servem apenas para validar a interface
// (layout, estados, remuneração oculta, lançamentos, impressão). A rota
// protegida `#meu-resumo-financeiro` continua usando dados reais do backend.
const memberId = 'Marcus Túlio';
const teamId = 'sustentacao';
const open = currentMonthKey();
const range = monthKeysForRange(open, 12);
const MES = (offset) => {
  const [cy, cm] = open.split('-').map(Number);
  const d = new Date(cy, cm - 1 - offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const pad = (s) => String(s).padStart(2, '0');
const dia = (m, d) => `${m}-${pad(d)}`;

// Remuneração sintética (somente para a demo).
const remuneracao = 12500;
const m0 = MES(0); // mês aberto (atual)
const m1 = MES(1); // fechado (snapshot)
const m2 = MES(2); // estimado

const sources = {
  schedule: { [teamId]: { overrides: {}, subs: [] } },
  pessoas: {
    [memberId]: {
      entries: [
        { id: `${memberId}-a1`, person: memberId, tipo: 'Hora Extra', data: dia(m0, 2), inicio: '23:00', fim: '01:00', projeto: 'CorpX', atividade: 'Deploy', status: 'aprovado' },
        { id: `${memberId}-a2`, person: memberId, tipo: 'Hora Extra', data: dia(m0, 3), inicio: '02:00', fim: '03:30', projeto: 'AICE', atividade: 'Incidente', status: 'pendente' },
        { id: `${memberId}-c`, person: memberId, tipo: 'Compensação', data: dia(m0, 4), inicio: '14:00', fim: '15:00', projeto: '', atividade: 'Banco de horas', status: 'aprovado' },
        { id: `${memberId}-b1`, person: memberId, tipo: 'Hora Extra', data: dia(m1, 5), inicio: '22:00', fim: '00:30', projeto: 'CorpX', atividade: 'Rota', status: 'aprovado' },
        { id: `${memberId}-b2`, person: memberId, tipo: 'Hora Extra', data: dia(m1, 6), inicio: '02:00', fim: '03:00', projeto: 'AICE', atividade: 'Incidente', status: 'rejeitado' },
      ],
      params: { [memberId]: { remuneracao, jornada: 168 } },
      closed: {
        [m1]: {
          closedAt: new Date().toISOString(), closedBy: 'demo@sintetico',
          params: { remuneracao, jornada: 168 },
          totals: { sobreaviso: 24, valorSobreaviso: 571.43, extra: 6, valorExtra: 642.86, comp: 0, valorComp: 0, valorHora: remuneracao / 168 },
        },
      },
    },
  },
};

// Resumo no MESMO shape do backend (custoPessoal — Ledger). Pedimos inclusão de
// remuneração para que o front consiga mascarar/revelar client-side.
const resumo = custoPessoal({
  sources, teamId, memberId, range, openMonthKey: open,
  metric: 'custo', situacao: 'realizado', includeRemuneracao: true,
});

// Lançamentos por competência (SA da escala + manuais) — somente leitura.
const schedule = buildSchedule(TEAMS[teamId], {});
const subs = [];
resumo.competencias = resumo.competencias.map((c) => {
  const [y, m] = c.monthKey.split('-').map(Number);
  const sa = scheduleEntriesFor(schedule, subs, memberId, m - 1, y)
    .map((e) => ({ data: e.data, tipo: 'Sobreaviso', inicio: e.inicio, fim: e.fim, duracaoHoras: durationHours(e.inicio, e.fim), status: null, origem: 'Escala' }));
  const man = (sources.pessoas[memberId].entries || [])
    .filter((e) => e.person === memberId && String(e.data).slice(0, 7) === c.monthKey)
    .map((e) => ({ data: e.data, tipo: e.tipo, inicio: e.inicio, fim: e.fim, duracaoHoras: durationHours(e.inicio, e.fim), status: e.status || 'aprovado', origem: 'Manual' }));
  const todos = [...sa, ...man].sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio));
  return {
    ...c,
    equipes: c.equipes.map((e) => ({
      ...e,
      pessoas: e.pessoas.map((p) => ({ ...p, lançamentos: todos })),
    })),
  };
});

export default function DevMeuResumoDemo() {
  const [dark, setDark] = useState(true);
  const T = getTheme(dark);
  return (
    <div style={{ minHeight: '100vh', background: T.pageBg }}>
      <div style={{ padding: '0.6rem 0.9rem', display: 'flex', justifyContent: 'flex-end', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', color: T.textMuted }}>
          <Icon name="info" size={13} /> Demo sintética · nenhum dado real
        </div>
        <Button T={T} size="sm" variant="quiet" onClick={() => setDark((d) => !d)}
          aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}>
          <Icon name={dark ? 'sun' : 'moon'} size={14} />
        </Button>
      </div>
      <div className="mx-auto px-3 sm:px-4 py-4" style={{ maxWidth: '1200px' }}>
        <MeuResumoFinanceiro
          dark={dark}
          profile={{ role: 'member', memberId, adminOf: [], teamId }}
          dados={resumo}
        />
      </div>
    </div>
  );
}
