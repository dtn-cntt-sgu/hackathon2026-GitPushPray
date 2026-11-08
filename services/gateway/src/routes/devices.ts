import { Hono } from 'hono';
import { createDeviceToken } from '../lib/auth';
import type { AppEnv } from '../lib/deps';
import { quotaExceeded } from '../lib/errors';
import { hashDevice } from '../lib/log';
import { clientIp, readJson } from '../lib/request';
import { validateCreateDevice } from '../lib/validate';

export const devicesRoute = new Hono<AppEnv>();

devicesRoute.post('/', async (c) => {
  const deps = c.get('deps');
  const body = await readJson(c);
  const data = validateCreateDevice(body);

  const ipHash = hashDevice(clientIp(c), deps.cfg.tokenSecret);
  const limited = await deps.limits.deviceIssueRate(ipHash, deps.now());
  if (!limited.allowed) {
    throw quotaExceeded('Cấp token quá nhanh; thử lại sau.', limited.retryAfterSec);
  }

  const issued = createDeviceToken(data.client, deps.cfg, deps.now());
  c.set('logExtra', {
    ...c.get('logExtra'),
    client: data.client,
    deviceHash: hashDevice(issued.deviceId, deps.cfg.tokenSecret),
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ token: issued.token, expiresAt: issued.expiresAt }, 201);
});
