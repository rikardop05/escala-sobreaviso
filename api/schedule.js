import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';
import { validate, checkBodySize, SchedulePostSchema } from './_validate.js';

// Persiste overrides do admin sobre a escala base determinística + rótulos de dia.
//
// Chaves Redis (compartilhadas — afetam a visão de todos):
//   schedule_overrides → { [dayKey]: { [idx]: { person?|persons?, period, time, dur, editedAt } | null } }
//       idx '0','1','2',… — índices além dos base viram turnos NOVOS (feriados/dias custom).
//       null = reverter o slot base (ou remover turno extra).
//   schedule_labels    → { [dayKey]: string }  — rótulo do dia (ex.: "Feriado").
//
// GET (público) devolve { overrides, labels }. POST (admin) aceita { overrides, labels }
// (ou um patch cru, compat. com o cliente antigo) e carimba editedAt em cada override.

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [overrides, labels] = await Promise.all([
        kvGet('schedule_overrides'),
        kvGet('schedule_labels'),
      ]);
      return res.status(200).json({ overrides: overrides ?? {}, labels: labels ?? {} });
    }

    if (req.method === 'POST') {
      let role;
      try {
        ({ role } = await requireUser(req));
      } catch (e) {
        return res.status(e.status || 401).json({ error: 'Unauthorized' });
      }
      if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

      if (!checkBodySize(req.body)) return res.status(400).json({ error: 'Bad request' });

      // Aceita o shape novo { overrides, labels } ou um patch cru (cliente antigo).
      const wrapped = req.body && (('overrides' in req.body) || ('labels' in req.body));
      const raw = wrapped ? req.body : { overrides: req.body };
      const { ok, data } = validate(SchedulePostSchema, raw);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const patch = data.overrides || {};
      const labelPatch = data.labels || {};

      const current = await kvGet('schedule_overrides') ?? {};
      const editedAt = new Date().toISOString();
      for (const [day, shifts] of Object.entries(patch)) {
        if (!current[day]) current[day] = {};
        for (const [idx, override] of Object.entries(shifts)) {
          if (override === null) delete current[day][idx];
          else current[day][idx] = { ...override, editedAt };
        }
        if (Object.keys(current[day]).length === 0) delete current[day];
      }

      const labels = await kvGet('schedule_labels') ?? {};
      for (const [day, label] of Object.entries(labelPatch)) {
        if (label === null || label === '') delete labels[day];
        else labels[day] = label;
      }

      await Promise.all([
        kvSet('schedule_overrides', current),
        kvSet('schedule_labels', labels),
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
