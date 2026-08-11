import { kvGet, kvGetWithFallback } from './_redis.js';

// Leitura (só leitura) dos overrides e substituições de uma equipe — as MESMAS
// chaves Redis que api/schedule.js e api/substitutions.js usam. Duplicado aqui
// (não importado de lá) de propósito: aprovação de Hora Extra não é sobre
// escala, e não deve tocar nesses dois arquivos para conseguir ler os dados de
// que precisa. api/ch.js usa isto para saber o sobreaviso efetivo da pessoa ao
// classificar uma Hora Extra (ver src/lib/chCalc.js — splitHoraExtra).
const LEGACY_TEAM_ID = 'sustentacao'; // única equipe com chave global anterior à Fase 0

export async function readTeamOverrides(teamId) {
  const key = `team:${teamId}:schedule_overrides`;
  if (teamId === LEGACY_TEAM_ID) return (await kvGetWithFallback(key, 'schedule_overrides')) ?? {};
  return (await kvGet(key)) ?? {};
}

export async function readTeamSubs(teamId) {
  const key = `team:${teamId}:substitutions`;
  if (teamId === LEGACY_TEAM_ID) return (await kvGetWithFallback(key, 'substitutions')) ?? [];
  return (await kvGet(key)) ?? [];
}
