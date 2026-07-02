import { kvGet, kvSet } from './_redis.js';
import { requireUser } from './_auth.js';
import { validate, checkBodySize, ChClosePostSchema, ChCloseMonthQuery } from './_validate.js';

// Fechamento mensal do Controle de Horas.
// Chave: member:{memberId}:ch_closed → { 'YYYY-MM': snapshot }
// snapshot = { closedAt, closedBy, params, totals, entries[] } — imutável até reabertura.
//
// Regras:
//   GET    — member lê os próprios fechamentos; admin lê de qualquer membro (?person=)
//   POST   — só admin fecha um mês; recusa se já fechado (reabrir primeiro)
//   DELETE — só admin reabre (?person=&month=)
//
// Os totais são calculados no cliente (a lógica da escala vive em src/lib/schedule.js,
// que não é importável aqui — fronteira Vite/Node). O fechamento é ação exclusiva de
// admin autenticado e o snapshot é validado por schema; o valor congelado é o que o
// admin viu e aprovou na tela no momento do fechamento.

export default async function handler(req, res) {
  let memberId, role, email;
  try {
    ({ memberId, role, email } = await requireUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: 'Unauthorized' });
  }

  if (!memberId) return res.status(403).json({ error: 'Forbidden' });

  try {
    if (req.method === 'GET') {
      const target = (role === 'admin' && req.query.person) ? req.query.person : memberId;
      const closed = await kvGet(`member:${target}:ch_closed`);
      return res.status(200).json(closed ?? {});
    }

    if (req.method === 'POST') {
      if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
      if (!checkBodySize(req.body)) return res.status(400).json({ error: 'Bad request' });
      const { ok, data: body } = validate(ChClosePostSchema, req.body);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const target = body.person || memberId;
      const key = `member:${target}:ch_closed`;
      const closed = (await kvGet(key)) ?? {};
      if (closed[body.month]) return res.status(409).json({ error: 'Month already closed' });

      closed[body.month] = {
        ...body.snapshot,
        closedAt: new Date().toISOString(),
        closedBy: email || memberId,
      };
      await kvSet(key, closed);
      return res.status(200).json(closed);
    }

    if (req.method === 'DELETE') {
      if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
      const { person, month } = req.query;
      const { ok } = validate(ChCloseMonthQuery, month);
      if (!ok) return res.status(400).json({ error: 'Bad request' });

      const target = person || memberId;
      const key = `member:${target}:ch_closed`;
      const closed = (await kvGet(key)) ?? {};
      if (!closed[month]) return res.status(404).json({ error: 'Not found' });

      delete closed[month];
      await kvSet(key, closed);
      return res.status(200).json(closed);
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[ch-close] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
