import { kvGet, kvSet, kvGetWithFallback } from './_redis.js';
import { requireUser } from './_auth.js';
import { scheduleCovers } from './_allowlist.js';
import { validate, checkBodySize, TeamIdSchema, schedulePostSchemaFor } from './_validate.js';
import { TEAMS } from '../src/lib/teams.js';

// Persiste overrides do admin sobre a escala base determinística + rótulos de dia.
//
// Fase 1 da spec de múltiplas equipes (docs/specs/multi-equipe.md §3/§4): a equipe é
// explícita — GET aceita ?team= (default sustentacao, para não quebrar o cliente
// antes do seletor de equipe existir); POST exige `team` no body e checa
// scheduleCovers(adminOf, scheduleEditOf, team) — admin da equipe OU alguém com
// scheduleEditOf cobrindo ela (edição completa da escala sem virar admin de CH).
// A chave da sustentação migrou de nome na Fase 0; leitura cai para a chave global
// antiga quando a nova ainda não existe (ver kvGetWithFallback). Infra e
// desenvolvimento nunca tiveram chave antiga — leitura direta.
//
// Chaves Redis (compartilhadas — afetam a visão de todos):
//   team:{teamId}:schedule_overrides → { [dayKey]: { [idx]: { person?|persons?, period, time, dur, editedAt } | null } }
//       idx '0','1','2',… — índices além dos base viram turnos NOVOS (feriados/dias custom).
//       null = reverter o slot base (ou remover turno extra).
//   team:{teamId}:schedule_labels    → { [dayKey]: string }  — rótulo do dia (ex.: "Feriado").
//
// GET (público) devolve { overrides, labels }. POST (admin da equipe) aceita
// { team, overrides, labels } (ou um patch cru, compat. com o cliente antigo) e
// carimba editedAt em cada override.

const LEGACY_TEAM_ID = 'sustentacao'; // única equipe com chave global anterior à Fase 0
const keysFor = (teamId) => ({
  overrides: `team:${teamId}:schedule_overrides`,
  labels: `team:${teamId}:schedule_labels`,
});

async function readOverrides(teamId) {
  const { overrides, labels } = keysFor(teamId);
  if (teamId === LEGACY_TEAM_ID) {
    return Promise.all([
      kvGetWithFallback(overrides, 'schedule_overrides'),
      kvGetWithFallback(labels, 'schedule_labels'),
    ]);
  }
  return Promise.all([kvGet(overrides), kvGet(labels)]);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const teamId = typeof req.query.team === 'string' ? req.query.team : LEGACY_TEAM_ID;
      if (!TEAMS[teamId]) return res.status(400).json({ error: 'Bad request' });
      const [overrides, labels] = await readOverrides(teamId);
      return res.status(200).json({ overrides: overrides ?? {}, labels: labels ?? {} });
    }

    if (req.method === 'POST') {
      let adminOf, scheduleEditOf;
      try {
        ({ adminOf, scheduleEditOf } = await requireUser(req));
      } catch (e) {
        return res.status(e.status || 401).json({ error: 'Unauthorized' });
      }

      if (!checkBodySize(req.body)) return res.status(400).json({ error: 'Bad request' });

      const teamCheck = TeamIdSchema.safeParse(req.body?.team);
      if (!teamCheck.success) return res.status(400).json({ error: 'Bad request' });
      const teamId = teamCheck.data;

      // adminOf cobre edição de escala normalmente; scheduleEditOf dá esse mesmo
      // direito, só para a escala, a quem não deve ganhar o resto de adminOf (CH de
      // outra pessoa, fechamento, relatório consolidado) — ver api/_allowlist.js.
      if (!scheduleCovers(adminOf, scheduleEditOf, teamId)) return res.status(403).json({ error: 'Forbidden' });

      // Aceita o shape novo { overrides, labels } ou um patch cru (cliente antigo).
      const wrapped = req.body && (('overrides' in req.body) || ('labels' in req.body));
      const raw = wrapped ? { ...req.body, team: teamId } : { overrides: req.body, team: teamId };
      const { ok, data } = validate(schedulePostSchemaFor(teamId), raw);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const patch = data.overrides || {};
      const labelPatch = data.labels || {};
      const { overrides: overridesKey, labels: labelsKey } = keysFor(teamId);

      const current = (teamId === LEGACY_TEAM_ID
        ? await kvGetWithFallback(overridesKey, 'schedule_overrides')
        : await kvGet(overridesKey)) ?? {};
      const editedAt = new Date().toISOString();
      for (const [day, shifts] of Object.entries(patch)) {
        if (!current[day]) current[day] = {};
        for (const [idx, override] of Object.entries(shifts)) {
          if (override === null) delete current[day][idx];
          else current[day][idx] = { ...override, editedAt };
        }
        if (Object.keys(current[day]).length === 0) delete current[day];
      }

      const labels = (teamId === LEGACY_TEAM_ID
        ? await kvGetWithFallback(labelsKey, 'schedule_labels')
        : await kvGet(labelsKey)) ?? {};
      for (const [day, label] of Object.entries(labelPatch)) {
        if (label === null || label === '') delete labels[day];
        else labels[day] = label;
      }

      await Promise.all([
        kvSet(overridesKey, current),
        kvSet(labelsKey, labels),
      ]);
      return res.status(200).json({ overrides: current, labels });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[schedule] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
