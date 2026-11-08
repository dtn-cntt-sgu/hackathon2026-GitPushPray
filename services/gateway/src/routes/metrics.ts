import { Hono } from 'hono';
import { bearerToken, verifyAdminToken } from '../lib/auth';
import type { AppEnv } from '../lib/deps';
import { badRequest } from '../lib/errors';
import { dateKey } from '../lib/limits';

export const metricsRoute = new Hono<AppEnv>();

metricsRoute.get('/summary', async (c) => {
  const deps = c.get('deps');
  verifyAdminToken(bearerToken(c.req.header('authorization')), deps.cfg);

  const requested = c.req.query('date');
  const date = requested ?? dateKey(deps.now());
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw badRequest('Tham số date không hợp lệ');
  }
  c.set('logExtra', { ...c.get('logExtra'), client: 'admin' });
  return c.json(await deps.metrics.summary(date), 200);
});
