// Điểm vào gateway: AWS Lambda (API Gateway HTTP API v2) + server local.
// Không lưu nội dung chat ở bất kỳ đâu; chỉ giữ bộ đếm trong DynamoDB.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { handle, type LambdaEvent } from 'hono/aws-lambda';
import { createApp } from './app';
import { loadConfig } from './lib/config';
import { createDeps, type Deps } from './lib/deps';
import { logEvent } from './lib/log';

let depsPromise: Promise<Deps> | undefined;
let lambdaHandler: ReturnType<typeof handle> | undefined;

async function getDeps(): Promise<Deps> {
  depsPromise ??= loadConfig().then((cfg) => createDeps(cfg));
  try {
    return await depsPromise;
  } catch (e) {
    depsPromise = undefined;
    throw e;
  }
}

async function getLambda(): Promise<ReturnType<typeof handle>> {
  if (!lambdaHandler) lambdaHandler = handle(createApp(await getDeps()));
  return lambdaHandler;
}

export const handler = async (event: LambdaEvent) => {
  try {
    return await (await getLambda())(event);
  } catch (e) {
    logEvent({
      requestId: randomUUID(),
      route: (event as { rawPath?: string }).rawPath ?? (event as { path?: string }).path ?? 'unknown',
      status: 500,
      errorCode: 'INTERNAL',
      reason: (e as Error)?.name ?? 'Error',
    });
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Lỗi khởi tạo cấu hình gateway' } }),
      isBase64Encoded: false,
    };
  }
};

function readAll(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('BODY_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function toWebRequest(req: IncomingMessage, maxBytes: number): Promise<Request> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(',') : v);
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readAll(req, maxBytes);
  return new Request(url, { method, headers, body, duplex: 'half' } as RequestInit);
}

export async function start(): Promise<void> {
  const port = Number(process.env.PORT) || 3000;
  const deps = await getDeps();
  const app = createApp(deps);
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const request = await toWebRequest(req, deps.cfg.maxBodyBytes);
      const response = await app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      const tooLarge = (e as Error).message === 'BODY_TOO_LARGE';
      const status = tooLarge ? 400 : 500;
      const code = tooLarge ? 'BAD_REQUEST' : 'INTERNAL';
      const message = tooLarge ? 'Body vượt giới hạn kích thước' : 'Lỗi hệ thống';
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code, message } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(JSON.stringify({ level: 'info', message: `Gateway listening on :${port}` }));
}

export function stop(server: ReturnType<typeof createServer>): void {
  server.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Chỉ local: nạp .env nếu có (root hoặc services/gateway). Lambda dùng biến môi trường/Secrets Manager.
  const envFile = ['services/gateway/.env', '.env'].find((p) => existsSync(p));
  if (envFile) process.loadEnvFile(envFile);
  void start();
}
