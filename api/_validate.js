import { z } from 'zod';
import { TEAMS, MEMBERS } from '../src/lib/teams.js';

// TEAMS/MEMBERS vivem em src/lib/teams.js (plain JS, sem JSX/Vite) — importáveis
// direto no runtime Node do Vercel, igual a qualquer outro módulo ESM. Substituem o
// enum fixo TEAM_MEMBERS (Fase 0-only, sustentação): validação agora é contra o
// roster real da equipe em questão (docs/specs/multi-equipe.md §4).

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// Ids de equipe válidos — hoje sustentacao/desenvolvimento/infra (src/lib/teams.js).
export const TeamIdSchema = z.enum(Object.keys(TEAMS));

// Qualquer pessoa de qualquer equipe (usado pelo Controle de Horas, que não é
// escopado por equipe única — cada chave Redis já isola por memberId).
const AnyMember = z.enum(Object.keys(MEMBERS));

// Pessoas do roster de UMA equipe — usado por schedule/substitutions, que são
// escopados por equipe (o titular/substituto/persons de um turno só pode vir do
// roster da equipe do próprio turno).
function rosterMember(teamId) {
  const roster = TEAMS[teamId]?.roster ?? [];
  return z.enum(roster.length ? roster : ['__equipe_sem_roster__']);
}

// ─── SCHEDULE ────────────────────────────────────────────────────────────────

// Override parcial: o admin pode mudar só um subconjunto (ex.: só o horário,
// mantendo a pessoa original). buildSchedule() mescla o override sobre a base,
// então todos os campos são opcionais — exige-se apenas ≥1 campo (override vazio
// deve ser enviado como null = reverter para o padrão).
function overrideSchemaFor(teamId) {
  const Member = rosterMember(teamId);
  return z.object({
    person:  Member.optional(),                             // legado (1 pessoa)
    persons: z.array(Member).min(1).max(10).optional(),      // multi-pessoa (feriados/slots)
    period:  z.string().min(1).max(30).optional(),
    time:    z.string().min(1).max(25).optional(),
    dur:     z.string().min(1).max(10).optional(),
  }).refine(o => Object.keys(o).length > 0, 'override não pode ser vazio (use null para reverter)');
}

// { 'YYYY-MM-DD': { idx: OverrideObj | null } } — idx é '0','1','2',... (string).
// Índices além dos turnos base viram turnos NOVOS (dias custom/feriado). null reverte.
function schedulePatchSchemaFor(teamId) {
  return z.record(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.record(z.string(), z.union([overrideSchemaFor(teamId), z.null()]))
  ).refine(obj => Object.keys(obj).length <= 366, 'Patch exceeds maximum day count');
}

// { 'YYYY-MM-DD': string | null } — rótulo do dia (ex.: "Feriado"); null/'' remove.
export const LabelPatchSchema = z.record(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.union([z.string().max(60), z.null()])
).refine(obj => Object.keys(obj).length <= 366, 'Label patch exceeds maximum day count');

// Corpo do POST /api/schedule: team obrigatório + overrides e/ou labels (opcionais).
// A equipe precisa ser conhecida ANTES de montar o schema (o roster de overrides
// depende dela) — por isso é uma função, não uma constante; o handler valida
// `team` isoladamente primeiro (ver TeamIdSchema) e só então monta este schema.
export function schedulePostSchemaFor(teamId) {
  return z.object({
    team: TeamIdSchema,
    overrides: schedulePatchSchemaFor(teamId).optional(),
    labels:    LabelPatchSchema.optional(),
  }).refine(o => o.overrides || o.labels, 'nada para atualizar');
}

// ─── SUBSTITUTIONS ───────────────────────────────────────────────────────────

// titular/substituto precisam ser do roster da MESMA equipe (a do body.team).
export function subPostSchemaFor(teamId) {
  const Member = rosterMember(teamId);
  return z.object({
    team:       TeamIdSchema,
    titular:    Member,
    substituto: Member,
    from:  DateStr,
    until: DateStr,
  })
    .refine(d => d.until >= d.from,           'until must be >= from')
    .refine(d => d.titular !== d.substituto,  'titular and substituto must differ');
}

// ─── CONTROLE DE HORAS ───────────────────────────────────────────────────────

const EntrySchema = z.object({
  id:        z.string().min(1),
  person:    AnyMember,
  tipo:      z.enum(['Sobreaviso', 'Hora Extra', 'Compensação']),
  data:      DateStr,
  inicio:    z.string().max(10),
  fim:       z.string().max(10),
  projeto:   z.string().max(200).optional(),
  atividade: z.string().max(500).optional(),
});

const ParamsValueSchema = z.object({
  // remuneracao may arrive as a number or a numeric string from form inputs
  remuneracao: z.union([z.number().nonnegative(), z.string().min(1).max(20)]),
  jornada:     z.number().positive(),
});

export const ChPostSchema = z.object({
  entries: z.array(EntrySchema).max(500).optional(),
  params:  z.record(z.string(), ParamsValueSchema).optional(),
  person:  z.string().max(60).optional(),
});

// ─── FECHAMENTO MENSAL (CH) ──────────────────────────────────────────────────

const MonthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

// Line items congelados no snapshot — inclui os SA gerados pela escala
// (ids 'sched-*'), por isso é mais permissivo que EntrySchema.
const ClosedEntrySchema = z.object({
  id:        z.string().min(1).max(80),
  tipo:      z.enum(['Sobreaviso', 'Hora Extra', 'Compensação']),
  data:      DateStr,
  inicio:    z.string().max(10),
  fim:       z.string().max(10),
  projeto:   z.string().max(200).optional(),
  atividade: z.string().max(500).optional(),
  origem:    z.enum(['Escala', 'Manual']),
});

const ClosedTotalsSchema = z.object({
  sobreaviso:      z.number().nonnegative(),
  extra:           z.number().nonnegative(),
  comp:            z.number().nonnegative(),
  totalHoras:      z.number().nonnegative(),
  valorHora:       z.number().nonnegative(),
  valorSobreaviso: z.number().nonnegative(),
  valorExtra:      z.number().nonnegative(),
  valorTotal:      z.number().nonnegative(),
});

export const ChClosePostSchema = z.object({
  person: AnyMember.optional(),
  month:  MonthStr,
  snapshot: z.object({
    params: z.object({
      remuneracao: z.union([z.number().nonnegative(), z.string().max(20)]),
      jornada:     z.number().positive(),
    }),
    totals:  ClosedTotalsSchema,
    entries: z.array(ClosedEntrySchema).max(200),
  }),
});

export const ChCloseMonthQuery = MonthStr; // reuso na validação do DELETE

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 50_000; // 50 KB — guards against absurdly large payloads

/**
 * Runs safeParse. On failure, logs issues server-side and returns { ok: false }.
 * The caller responds with a generic 400 — no schema details leak to the client.
 */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Truncate to first 5 issues to avoid flooding logs
    console.error('[validate]', JSON.stringify(result.error.issues.slice(0, 5)));
    return { ok: false };
  }
  return { ok: true, data: result.data };
}

/** Rejects payloads whose serialized size exceeds MAX_BODY_BYTES. */
export function checkBodySize(body) {
  try {
    return JSON.stringify(body).length <= MAX_BODY_BYTES;
  } catch {
    return false;
  }
}
