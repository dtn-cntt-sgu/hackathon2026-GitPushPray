import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ApiError } from '@safechat/contracts';
import type { AppEnv, Deps } from './lib/deps';
import { AppError, badRequest, toApiError } from './lib/errors';
import { logEvent } from './lib/log';
import { analysesRoute } from './routes/analyses';
import { devicesRoute } from './routes/devices';
import { feedbackRoute } from './routes/feedback';
import { metricsRoute } from './routes/metrics';

const KNOWN_PATHS = new Set([
  '/healthz',
  '/readyz',
  '/v1/devices',
  '/v1/analyses',
  '/v1/feedback',
  '/v1/metrics/summary',
]);

function errorResponse(code: 'BAD_REQUEST' | 'INTERNAL', message: string): ApiError {
  return { error: { code, message } };
}

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cfg = deps.cfg;

  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    const started = Date.now();
    c.set('deps', deps);
    c.set('requestId', requestId);
    c.set('route', c.req.path);
    c.set('logExtra', {});

    const origin = c.req.header('origin');
    const originAllowed = Boolean(origin && cfg.allowedOrigins.includes(origin));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Cache-Control', 'no-store');
    if (originAllowed && origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }

    if (c.req.method === 'OPTIONS') {
      if (!origin || originAllowed) {
        c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        c.header('Access-Control-Max-Age', '86400');
      }
      return c.body(null, 204);
    }

    if (c.req.method === 'POST' && !/^application\/json\b/i.test(c.req.header('content-type') ?? '')) {
      return c.json(errorResponse('BAD_REQUEST', 'Content-Type phải là application/json'), 400);
    }

    try {
      await next();
    } finally {
      logEvent({
        requestId,
        route: c.req.path,
        status: c.res.status,
        latencyMs: Date.now() - started,
        ...c.get('logExtra'),
      });
    }
  });

  app.use(
    '*',
    bodyLimit({
      maxSize: cfg.maxBodyBytes,
      onError: (c) => c.json(errorResponse('BAD_REQUEST', 'Body vượt giới hạn kích thước'), 400),
    }),
  );

  app.get('/healthz', (c) =>
    c.json({ status: 'ok' as const, version: '0.5.0', provider: cfg.provider, promptVersion: cfg.promptVersion }, 200),
  );

  // Sẵn sàng = config hợp lệ + đọc được store + có khóa model khi bật AI.
  app.get('/readyz', async (c) => {
    const checks = { store: false, ai: cfg.provider === 'none' || Boolean(cfg.groqApiKey) };
    try {
      await deps.store.get('__readyz__', 'probe');
      checks.store = true;
    } catch {
      // Không đưa chi tiết lỗi ra ngoài; log đã có errorCode.
    }
    const ready = checks.store && checks.ai;
    return c.json(
      {
        status: ready ? ('ready' as const) : ('not_ready' as const),
        checks,
        provider: cfg.provider,
        models: { small: cfg.groqModelSmall, large: cfg.groqModelLarge },
      },
      ready ? 200 : 503,
    );
  });

  app.route('/v1/devices', devicesRoute);
  app.route('/v1/analyses', analysesRoute);
  app.route('/v1/feedback', feedbackRoute);
  app.route('/v1/metrics', metricsRoute);

  app.notFound((c) => {
    const status = KNOWN_PATHS.has(c.req.path) ? 405 : 404;
    const message = status === 405 ? 'Phương thức không được hỗ trợ' : 'Không tìm thấy endpoint';
    return c.json(errorResponse('BAD_REQUEST', message), status);
  });

  app.onError((err, c) => {
    const e = toApiError(err);
    if (!(err instanceof AppError)) {
      // Lỗi ngoài dự kiến: chỉ giữ thông điệp kỹ thuật trong log nội bộ, không trả cho client.
      console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), error: (err as Error)?.name ?? 'Error' }));
    }
    // Không ghi e.detail: lỗi parse/model có thể chứa nguyên văn tin nhắn.
    c.set('logExtra', { ...c.get('logExtra'), errorCode: e.code });
    return c.json(e.toBody(), e.status as 400);
  });

  return app;
}

export { badRequest };
