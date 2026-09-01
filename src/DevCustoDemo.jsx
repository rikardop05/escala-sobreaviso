import React, { useState } from 'react';
import RelatorioCusto from './components/RelatorioCusto';
import { getTheme } from './lib/theme';
import { Button, Icon } from './components/ui';

// Harness de desenvolvimento (`#custo-demo`) — renderiza a visão de custo com
// `sources` injetados, sem Clerk/backend, para validar layout, interação e estados.
// NUNCA é importada no build de produção: só via import dinâmico sob import.meta.env.DEV.

const personData = (name, remuneracao, extra) => ({
  entries: extra ? [
    { id: `${name}-he1`, person: name, tipo: 'Hora Extra', data: `${extra}`,
      inicio: '23:00', fim: '01:00', projeto: 'CorpX', atividade: 'Deploy', status: 'aprovado' },
    { id: `${name}-he2`, person: name, tipo: 'Hora Extra', data: `${extra}`,
      inicio: '02:00', fim: '03:30', projeto: 'AICE', atividade: 'Incidente', status: 'pendente' },
    { id: `${name}-comp`, person: name, tipo: 'Compensação', data: `${extra}`,
      inicio: '14:00', fim: '15:00', projeto: '', atividade: 'Banco de horas', status: 'aprovado' },
  ] : [],
  // params é o mapa POR PESSOA que o /api/ch devolve (mesma forma do painel
  // individual); snapshots usam params flat, por isso closedAug fica como está.
  params: { [name]: { remuneracao, jornada: 168 } },
  closed: {},
});

// 2026-08 é fechado (snapshot) para uma parte das pessoas; meses anteriores à
// vigência das equipes aparecem como "sem dados" (2026-06/07 para Desenvolvimento).
const closedAug = {
  '2026-08': {
    closedAt: '2026-09-01T10:00:00.000Z', closedBy: 'admin@mtfintech.com',
    params: { remuneracao: 12000, jornada: 168 },
    totals: { sobreaviso: 24, valorSobreaviso: 571.43, extra: 6, valorExtra: 642.86, comp: 0, valorComp: 0 },
  },
};

export const DEV_SOURCES = {
  escopo: [
    { teamId: 'sustentacao', nome: 'Sustentação' },
    { teamId: 'desenvolvimento', nome: 'Desenvolvimento' },
  ],
  schedule: {
    sustentacao: { overrides: {}, subs: [] },
    desenvolvimento: { overrides: {}, subs: [] },
  },
  pessoas: {
    'Marcus Túlio': { ...personData('Marcus Túlio', 12000, '2026-09-02'), closed: closedAug },
    Raul: { ...personData('Raul', 11000, '2026-09-03'), closed: closedAug },
    Ricardo: { ...personData('Ricardo', 12500, '2026-09-04'), closed: {} },
    Alice: { ...personData('Alice', 9800, '2026-09-01'), closed: {} },
    Emanoel: { ...personData('Emanoel', 13000, '2026-09-05'), closed: {} },
    // Chave do roster real da Lib (ver MEMBERS em src/lib/teams.js) — "Luis" tem
    // fullName "Luis Gustavo". A fixture precisa usar o identificador real para a
    // lib consultar `sources.pessoas['Luis']`, senão a pessoa ficaria sem dados.
    Luis: { ...personData('Luis', 11500, '2026-09-02'), closed: {} },
    Pedro: { ...personData('Pedro', 10000, '2026-09-03'), closed: {} },
  },
};

export default function DevCustoDemo() {
  const [dark, setDark] = useState(true);
  const T = getTheme(dark);
  return (
    <div style={{ minHeight: '100vh', background: T.pageBg }}>
      <div style={{ padding: '0.6rem 0.9rem', display: 'flex', justifyContent: 'flex-end', borderBottom: `1px solid ${T.border}` }}>
        <Button T={T} size="sm" variant="quiet" onClick={() => setDark(d => !d)}
          aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}>
          <Icon name={dark ? 'sun' : 'moon'} size={14} />
        </Button>
      </div>
      <div className="mx-auto px-3 sm:px-4 py-4" style={{ maxWidth: '1440px' }}>
        <RelatorioCusto
          dark={dark}
          profile={{ role: 'admin', adminOf: ['sustentacao', 'desenvolvimento'] }}
          sources={DEV_SOURCES}
        />
      </div>
    </div>
  );
}
