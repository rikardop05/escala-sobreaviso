// Registry de equipes — Fase 0 da spec de múltiplas equipes (docs/specs/multi-equipe.md).
// Contém APENAS a Sustentação; Infraestrutura e Desenvolvimento entram na Fase 1.
// Vocabulário: CONTEXT.md. Decisão de manter a estrutura em código (não editável na UI): ADR-0001.
//
// Deriva de src/lib/schedule.js em vez de duplicar os dados: PEOPLE, WEEKDAY_SHIFTS,
// WEEKEND_ROSTER, WEEKEND_CYCLE, ANCHOR, WEEKEND_CHANGE e RANGE_START continuam sendo a
// fonte de verdade (consumida hoje por EscalaSobreaviso.jsx, ControleDeHoras.jsx e
// EstruturaEscala.jsx); este arquivo só empacota esses mesmos valores no formato que o
// motor genérico de buildSchedule()/buildOnCallSegments() espera.
import {
  PEOPLE, WEEKDAY_SHIFTS, WEEKEND_ROSTER, WEEKEND_CYCLE, ANCHOR, WEEKEND_CHANGE, RANGE_START,
  dayKey,
} from "./schedule.js";

// MEMBERS é a fonte única de pessoas prevista pela spec (§1 Modelo) — aqui contém só o
// roster da sustentação. `PEOPLE`/`CH_NAMES` (schedule.js) continuam sendo o que a UI
// atual usa; MEMBERS/TEAMS passam a existir em paralelo até a Fase 1 estender a UI.
export const MEMBERS = Object.fromEntries(
  Object.entries(PEOPLE).map(([name, p]) => [
    name,
    { displayName: name, teamId: "sustentacao", color: p.color, bg: p.bg },
  ])
);

export const TEAMS = {
  sustentacao: {
    id: "sustentacao",
    nome: "Sustentação",
    dayStart: "23:00",
    startsOn: dayKey(RANGE_START), // 2026-06-08 — idêntico ao RANGE_START global atual
    endsOn: null,
    roster: Object.keys(PEOPLE),
    // Turnos com dono fixo por dia da semana (seg–sex). Sáb/dom vêm de `rotacao`.
    blocos: WEEKDAY_SHIFTS,
    rotacao: {
      dows: [0, 6], // domingo, sábado
      tipo: "escada",
      roster: WEEKEND_ROSTER,
      change: WEEKEND_CHANGE,
      turnos: {
        dia:   { period: "Dia",   time: "23:00 – 11:00", dur: "12h" },
        noite: { period: "Noite", time: "11:00 – 23:00", dur: "12h" },
      },
      legado: { tipo: "ciclo", anchor: ANCHOR, ciclos: WEEKEND_CYCLE },
    },
  },
};
