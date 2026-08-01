// Registry de equipes — Fases 0 e 1 da spec de múltiplas equipes (docs/specs/multi-equipe.md).
// Contém as três equipes: Sustentação, Infraestrutura e Desenvolvimento.
// Vocabulário: CONTEXT.md. Decisão de manter a estrutura em código (não editável na UI): ADR-0001.
//
// Deriva de src/lib/schedule.js em vez de duplicar os dados: PEOPLE, WEEKDAY_SHIFTS,
// WEEKEND_ROSTER, WEEKEND_CYCLE, ANCHOR, WEEKEND_CHANGE e RANGE_START continuam sendo a
// fonte de verdade (consumida hoje por EscalaSobreaviso.jsx, ControleDeHoras.jsx e
// EstruturaEscala.jsx); este arquivo só empacota esses mesmos valores no formato que o
// motor genérico de buildSchedule()/buildOnCallSegments() espera. Infra e Desenvolvimento
// não têm equivalente em schedule.js (só existiam nesta spec) — seus dados nascem aqui.
import {
  PEOPLE, WEEKDAY_SHIFTS, WEEKEND_ROSTER, WEEKEND_CYCLE, ANCHOR, WEEKEND_CHANGE, RANGE_START,
  dayKey,
} from "./schedule.js";

// MEMBERS é a fonte única de pessoas prevista pela spec (§1 Modelo). A chave é o
// identificador — primeiro nome; primeiro + sobrenome só quando há colisão entre
// equipes (Leonardo Matheus / Leonardo Menegon) — e precisa ser única entre TODAS as
// equipes (ADR-0003). `PEOPLE`/`CH_NAMES` (schedule.js) continuam sendo o que a UI do
// Controle de Horas usa hoje (só sustentação) — MEMBERS ainda não os substitui.
const SUSTENTACAO_MEMBERS = Object.fromEntries(
  Object.entries(PEOPLE).map(([name, p]) => [
    name,
    { displayName: name, teamId: "sustentacao", color: p.color, bg: p.bg },
  ])
);

// Roster derivado da planilha operacional Sobreaviso(Jul-26).csv — ver docs/specs/multi-equipe.md §1.
const DESENVOLVIMENTO_MEMBERS = {
  "Luis":              { displayName: "Luis Gustavo",       teamId: "desenvolvimento", color: "#00695C", bg: "#E0F2F1" },
  "Adalberto":         { displayName: "Adalberto Teshima",  teamId: "desenvolvimento", color: "#0277BD", bg: "#E1F5FE" },
  "Pedro":             { displayName: "Pedro Wesley",       teamId: "desenvolvimento", color: "#283593", bg: "#E8EAF6" },
  "Dante":             { displayName: "Dante Escame",       teamId: "desenvolvimento", color: "#C62828", bg: "#FFEBEE" },
  "Leonardo Matheus":  { displayName: "Leonardo Matheus",   teamId: "desenvolvimento", color: "#4E342E", bg: "#EFEBE9" },
  "Leonardo Menegon":  { displayName: "Leonardo Menegon",   teamId: "desenvolvimento", color: "#558B2F", bg: "#F1F8E9" },
  "Jonata":            { displayName: "Jonata Crepaldi",    teamId: "desenvolvimento", color: "#827717", bg: "#F9FBE7" },
  "Ícaro":             { displayName: "Ícaro Gomes",        teamId: "desenvolvimento", color: "#00838F", bg: "#E0F7FA" },
};

const INFRA_MEMBERS = {
  "Alberth": { displayName: "Alberth Souza",     teamId: "infra", color: "#4527A0", bg: "#EDE7F6" },
  "Gabriel": { displayName: "Gabriel Pavanelli", teamId: "infra", color: "#BF360C", bg: "#FBE9E7" },
  "Antonio": { displayName: "Antonio Carlos",    teamId: "infra", color: "#424242", bg: "#F5F5F5" },
  "Diogo":   { displayName: "Diogo de Moraes",   teamId: "infra", color: "#880E4F", bg: "#FCE4EC" },
  "Caio":    { displayName: "Caio Ribeiro",      teamId: "infra", color: "#B71C1C", bg: "#FFEBEE" },
};

export const MEMBERS = { ...SUSTENTACAO_MEMBERS, ...DESENVOLVIMENTO_MEMBERS, ...INFRA_MEMBERS };

// Turnos sem dono fixo (infra e desenvolvimento, sem rotação — admin atribui à mão).
// `persons: []` é o slot vago (ver invariante nova de shiftPeople() no §1 da spec).
const vago = (period, time, dur) => ({ period, time, dur, persons: [] });

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
  desenvolvimento: {
    id: "desenvolvimento",
    nome: "Desenvolvimento",
    dayStart: "00:00",
    startsOn: "2026-07-01",
    endsOn: null,
    roster: Object.keys(DESENVOLVIMENTO_MEMBERS),
    // Sem rodízio — blocos nascem vagos (persons: []), admin atribui à mão.
    blocos: {
      1: [vago("Madrugada", "00:00 – 09:00", "9h"), vago("Noite", "18:00 – 00:00", "6h")],
      2: [vago("Madrugada", "00:00 – 09:00", "9h"), vago("Noite", "18:00 – 00:00", "6h")],
      3: [vago("Madrugada", "00:00 – 09:00", "9h"), vago("Noite", "18:00 – 00:00", "6h")],
      4: [vago("Madrugada", "00:00 – 09:00", "9h"), vago("Noite", "18:00 – 00:00", "6h")],
      5: [vago("Madrugada", "00:00 – 09:00", "9h"), vago("Noite", "18:00 – 00:00", "6h")],
      0: [vago("Madrugada", "00:00 – 09:00", "9h"), vago("Dia", "09:00 – 00:00", "15h")],
      6: [vago("Madrugada", "00:00 – 09:00", "9h"), vago("Dia", "09:00 – 00:00", "15h")],
    },
    rotacao: null,
  },
  infra: {
    id: "infra",
    nome: "Infraestrutura",
    dayStart: "00:00",
    startsOn: "2026-07-01",
    endsOn: null,
    roster: Object.keys(INFRA_MEMBERS),
    // Sem rodízio — blocos nascem vagos (persons: []), admin atribui à mão.
    // Sem cobertura 00:00–09:00 todos os dias e 09:00–18:00 nos dias úteis (expediente).
    blocos: {
      1: [vago("Noite", "18:00 – 00:00", "6h")],
      2: [vago("Noite", "18:00 – 00:00", "6h")],
      3: [vago("Noite", "18:00 – 00:00", "6h")],
      4: [vago("Noite", "18:00 – 00:00", "6h")],
      5: [vago("Noite", "18:00 – 00:00", "6h")],
      0: [vago("Dia", "09:00 – 17:00", "8h"), vago("Noite", "17:00 – 00:00", "7h")],
      6: [vago("Dia", "09:00 – 17:00", "8h"), vago("Noite", "17:00 – 00:00", "7h")],
    },
    rotacao: null,
  },
};
