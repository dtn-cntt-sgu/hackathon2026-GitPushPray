import { Hono } from 'hono';
import { bearerToken, verifyDeviceToken } from '../lib/auth';
import type { AppEnv } from '../lib/deps';
import { hashDevice } from '../lib/log';
import { readJson } from '../lib/request';
import { dateKey } from '../lib/limits';
import { validateFeedback } from '../lib/validate';

export const feedbackRoute = new Hono<AppEnv>();

feedbackRoute.post('/', async (c) => {
  const deps = c.get('deps');
  const body = await readJson(c);
  const data = validateFeedback(body);
  const claims = verifyDeviceToken(bearerToken(c.req.header('authorization')), data.client, deps.cfg, deps.now());

  await deps.metrics.recordFeedback(dateKey(deps.now()), data.verdict, data.signalTypes, deps.now()).catch(() => undefined);
  c.set('logExtra', {
    ...c.get('logExtra'),
    client: data.client,
    deviceHash: hashDevice(claims.d, deps.cfg.tokenSecret),
    signals: data.signalTypes.length,
  });
  return c.json({ ok: true }, 200);
});
