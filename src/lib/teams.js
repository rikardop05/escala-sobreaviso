// Registry de equipes — Fases 0, 1 e 2 da spec de múltiplas equipes (docs/specs/multi-equipe.md).
// Contém as três equipes: Sustentação, Infraestrutura e Desenvolvimento.
// Vocabulário: CONTEXT.md. Decisão de manter a estrutura em código (não editável na UI): ADR-0001.
//
// Deriva de src/lib/schedule.js em vez de duplicar os dados: PEOPLE, WEEKDAY_SHIFTS,
// WEEKEND_ROSTER, WEEKEND_CYCLE, ANCHOR, WEEKEND_CHANGE e RANGE_START continuam sendo a
// fonte de verdade (consumida hoje por EscalaSobreaviso.jsx e EstruturaEscala.jsx); este
// arquivo só empacota esses mesmos valores no formato que o motor genérico de
// buildSchedule()/buildOnCallSegments() espera. Infra e Desenvolvimento não têm
// equivalente em schedule.js (só existiam nesta spec) — seus dados nascem aqui.
import {
  PEOPLE, WEEKDAY_SHIFTS, WEEKEND_ROSTER, WEEKEND_CYCLE, ANCHOR, WEEKEND_CHANGE, RANGE_START,
  dayKey,
} from "./schedule.js";

// MEMBERS é a fonte única de pessoas prevista pela spec (§1 Modelo) — desde a Fase 2,
// é o que TODA a UI usa (ControleDeHoras.jsx incluído). A chave é o identificador —
// primeiro nome; primeiro + sobrenome só quando há colisão entre equipes (Leonardo
// Matheus / Leonardo Menegon) — e precisa ser única entre TODAS as equipes (ADR-0003).
// `fullName` é o nome completo — usado só pelo relatório consolidado do CH (o resto do
// app continua mostrando o identificador curto, mais estável e mais curto na tela).
const SUSTENTACAO_FULL_NAMES = {
  Emanoel: "Emanoel Rosa",
  "Marcus Túlio": "Marcus Túlio",
  Ricardo: "Ricardo Corrêa",
  Carlos: "Carlos Beda",
  Raul: "Raul Vitti",
  Alice: "Alice Santos",
};
const SUSTENTACAO_MEMBERS = Object.fromEntries(
  Object.entries(PEOPLE).map(([name, p]) => [
    name,
    { fullName: SUSTENTACAO_FULL_NAMES[name] || name, teamId: "sustentacao", color: p.color, bg: p.bg },
  ])
);

// Roster derivado da planilha operacional Sobreaviso(Jul-26).csv — ver docs/specs/multi-equipe.md §1.
const DESENVOLVIMENTO_MEMBERS = {
  "Luis":              { fullName: "Luis Gustavo",       teamId: "desenvolvimento", color: "#00695C", bg: "#E0F2F1" },
  "Adalberto":         { fullName: "Adalberto Teshima",  teamId: "desenvolvimento", color: "#0277BD", bg: "#E1F5FE" },
  "Pedro":             { fullName: "Pedro Wesley",       teamId: "desenvolvimento", color: "#283593", bg: "#E8EAF6" },
  "Dante":             { fullName: "Dante Escame",       teamId: "desenvolvimento", color: "#C62828", bg: "#FFEBEE" },
  "Leonardo Matheus":  { fullName: "Leonardo Matheus",   teamId: "desenvolvimento", color: "#4E342E", bg: "#EFEBE9" },
  "Leonardo Menegon":  { fullName: "Leonardo Menegon",   teamId: "desenvolvimento", color: "#558B2F", bg: "#F1F8E9" },
  "Jonata":            { fullName: "Jonata Crepaldi",    teamId: "desenvolvimento", color: "#827717", bg: "#F9FBE7" },
  "Ícaro":             { fullName: "Ícaro Gomes",        teamId: "desenvolvimento", color: "#00838F", bg: "#E0F7FA" },
};

const INFRA_MEMBERS = {
  "Alberth": { fullName: "Alberth Souza",     teamId: "infra", color: "#4527A0", bg: "#EDE7F6" },
  "Gabriel": { fullName: "Gabriel Pavanelli", teamId: "infra", color: "#BF360C", bg: "#FBE9E7" },
  "Antonio": { fullName: "Antonio Carlos",    teamId: "infra", color: "#424242", bg: "#F5F5F5" },
  "Diogo":   { fullName: "Diogo de Moraes",   teamId: "infra", color: "#880E4F", bg: "#FCE4EC" },
  "Caio":    { fullName: "Caio Ribeiro",      teamId: "infra", color: "#B71C1C", bg: "#FFEBEE" },
};

export const MEMBERS = { ...SUSTENTACAO_MEMBERS, ...DESENVOLVIMENTO_MEMBERS, ...INFRA_MEMBERS };

// Turnos sem dono fixo (infra e desenvolvimento, sem rotação — admin atribui à mão).
// `persons: []` é o slot vago (ver invariante nova de shiftPeople() no §1 da spec).
// Sem `dur` — duração é sempre derivada de `time` via shiftDuration() (defeito §7.6).
const vago = (period, time) => ({ period, time, persons: [] });

// Infra e desenvolvimento começam em 2026-08-01, não 2026-07-01 (decisão da Fase 2):
// julho de 2026 já fechou sem ninguém atribuído aos slots vagos — se startsOn ficasse
// em julho, o Controle de Horas mostraria o mês inteiro como "sem plantonista", uma
// afirmação falsa (o app simplesmente não existia para essas equipes ainda). Mover o
// início para o mês em que o app de fato passa a ser usado evita inventar um passado
// que não foi operado por aqui, sem exigir importar a planilha de julho.
const EQUIPES_NOVAS_STARTS_ON = "2026-08-01";

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
        dia:   { period: "Dia",   time: "23:00 – 11:00" },
        noite: { period: "Noite", time: "11:00 – 23:00" },
      },
      legado: { tipo: "ciclo", anchor: ANCHOR, ciclos: WEEKEND_CYCLE },
    },
  },
  desenvolvimento: {
    id: "desenvolvimento",
    nome: "Desenvolvimento",
    dayStart: "00:00",
    startsOn: EQUIPES_NOVAS_STARTS_ON,
    endsOn: null,
    roster: Object.keys(DESENVOLVIMENTO_MEMBERS),
    // Sem rodízio — blocos nascem vagos (persons: []), admin atribui à mão.
    blocos: {
      1: [vago("Madrugada", "00:00 – 09:00"), vago("Noite", "18:00 – 00:00")],
      2: [vago("Madrugada", "00:00 – 09:00"), vago("Noite", "18:00 – 00:00")],
      3: [vago("Madrugada", "00:00 – 09:00"), vago("Noite", "18:00 – 00:00")],
      4: [vago("Madrugada", "00:00 – 09:00"), vago("Noite", "18:00 – 00:00")],
      5: [vago("Madrugada", "00:00 – 09:00"), vago("Noite", "18:00 – 00:00")],
      0: [vago("Madrugada", "00:00 – 09:00"), vago("Dia", "09:00 – 00:00")],
      6: [vago("Madrugada", "00:00 – 09:00"), vago("Dia", "09:00 – 00:00")],
    },
    rotacao: null,
  },
  infra: {
    id: "infra",
    nome: "Infraestrutura",
    dayStart: "00:00",
    startsOn: EQUIPES_NOVAS_STARTS_ON,
    endsOn: null,
    roster: Object.keys(INFRA_MEMBERS),
    // Sem rodízio — blocos nascem vagos (persons: []), admin atribui à mão.
    // Sem cobertura 00:00–09:00 todos os dias e 09:00–18:00 nos dias úteis (expediente).
    blocos: {
      1: [vago("Noite", "18:00 – 00:00")],
      2: [vago("Noite", "18:00 – 00:00")],
      3: [vago("Noite", "18:00 – 00:00")],
      4: [vago("Noite", "18:00 – 00:00")],
      5: [vago("Noite", "18:00 – 00:00")],
      0: [vago("Dia", "09:00 – 17:00"), vago("Noite", "17:00 – 00:00")],
      6: [vago("Dia", "09:00 – 17:00"), vago("Noite", "17:00 – 00:00")],
    },
    rotacao: null,
  },
};

// Equipes que uma pessoa com este `adminOf` pode ver/editar no Controle de Horas,
// cada uma com seu roster (docs/specs/multi-equipe.md §5 — Fase 2). `'*'` vê as três;
// um array vê só as equipes ali; member (sem adminOf) não usa isto, fica travado no
// próprio painel. Fonte única para o dropdown "Responsável" (ControleDeHoras.jsx) e
// para o relatório consolidado (RelatorioConsolidado.jsx) — um admin de uma equipe
// nunca pode ver valores de outra em nenhum dos dois porque nenhum dos dois pede.
export function chGroupsFor(adminOf) {
  const teamIds = adminOf === '*' ? Object.keys(TEAMS)
    : Array.isArray(adminOf) ? adminOf.filter(id => TEAMS[id])
    : [];
  return teamIds.map(teamId => ({ teamId, nome: TEAMS[teamId].nome, people: TEAMS[teamId].roster }));
}

// true se `scope` (array de teamIds, ou '*') cobre `teamId`. Fonte única do teste de
// escopo por equipe — reusada por api/_allowlist.js (adminCovers/scheduleCovers, para
// autorização de escrita) e pelo frontend (EscalaSobreaviso.jsx, para decidir se
// mostra "Editar Escala" na equipe atualmente selecionada). Nunca reimplementar este
// teste num terceiro lugar — os dois runtimes precisam concordar sempre.
export function teamScopeCovers(scope, teamId) {
  return scope === '*' || (Array.isArray(scope) && scope.includes(teamId));
}
