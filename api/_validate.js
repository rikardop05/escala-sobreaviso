import { z } from 'zod';

// Team member names — must stay in sync with PEOPLE keys in src/lib/schedule.js.
// Defined inline here to avoid cross-boundary import (api/ is Node.js; src/ is Vite).
const TEAM_MEMBERS = /** @type {[string, ...string[]]} */ (
  ['Emanoel', 'Marcus Túlio', 'Ricardo', 'Carlos', 'Raul', 'Alice']
);

const DateStr    = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const TeamMember = z.enum(TEAM_MEMBERS);

// ─── SCHEDULE ────────────────────────────────────────────────────────────────

// Override parcial: o admin pode mudar só um subconjunto (ex.: só o horário,
// mantendo a pessoa original). buildSchedule() mescla o override sobre a base,
// então todos os campos são opcionais — exige-se apenas ≥1 campo (override vazio
// deve ser enviado como null = reverter para o padrão).
const OverrideObj = z.object({
  person: TeamMember.optional(),
  period: z.string().min(1).max(30).optional(),
  time:   z.string().min(1).max(25).optional(),
  dur:    z.string().min(1).max(10).optional(),
}).refine(o => Object.keys(o).length > 0, 'override não pode ser vazio (use null para reverter)');

// { 'YYYY-MM-DD': { '0'|'1'|'2': OverrideObj | null } }
// Note: inner key uses z.string() — z.enum() as record key in Zod v4 requires ALL
// enum values to be present, which would reject partial patches.
export const SchedulePatchSchema = z.record(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.record(z.string(), z.union([OverrideObj, z.null()]))
).refine(obj => Object.keys(obj).length <= 366, 'Patch exceeds maximum day count');

// ─── SUBSTITUTIONS ───────────────────────────────────────────────────────────

export const SubPostSchema = z.object({
  titular:    TeamMember,
  substituto: TeamMember,
  from:  DateStr,
  until: DateStr,
})
  .refine(d => d.until >= d.from,           'until must be >= from')
  .refine(d => d.titular !== d.substituto,  'titular and substituto must differ');

// ─── CONTROLE DE HORAS ───────────────────────────────────────────────────────

const EntrySchema = z.object({
  id:        z.string().min(1),
  person:    TeamMember,
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
  person: TeamMember.optional(),
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
