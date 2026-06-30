import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';
import { validate, checkBodySize, SchedulePatchSchema } from './_validate.js';

// Persists admin-defined overrides on top of the deterministic base schedule.
//
// Redis key: 'schedule_overrides' (shared — affects all users' views)
//
// Override structure:
//   { [dayKey]: { [shiftIndex]: { person, period, time, dur } } }
//   dayKey format: 'YYYY-MM-DD'
//   shiftIndex: '0', '1', '2' (string keys in JSON)
//   A null value for a shift index means "revert to base schedule"

export default async function handler(req, res) {
  let role;
  try {
    ({ role } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const overrides = await kvGet('schedule_overrides') ?? {};
      return res.status(200).json(overrides);
    }

    if (req.method === 'POST') {
      if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

      if (!checkBodySize(req.body)) return res.status(400).json({ error: 'Bad request' });
      const { ok, data: patch } = validate(SchedulePatchSchema, req.body);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const current = await kvGet('schedule_overrides') ?? {};

      for (const [day, shifts] of Object.entries(patch)) {
        if (!current[day]) current[day] = {};
        for (const [idx, override] of Object.entries(shifts)) {
          if (override === null) {
            delete current[day][idx];
          } else {
            current[day][idx] = override;
          }
        }
        if (Object.keys(current[day]).length === 0) delete current[day];
      }

      await kvSet('schedule_overrides', current);
      return res.status(200).json(current);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[schedule] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
