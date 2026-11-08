// Truy cập DynamoDB: chỉ bộ đếm, không bao giờ lưu transcript/summary/signal.
// Không dùng Scan. Có fallback in-memory khi chạy local/test (không có TABLE_NAME).

export interface IncrUnderResult {
  allowed: boolean;
  value?: number;
}

export interface CounterStore {
  get(pk: string, sk: string): Promise<Record<string, unknown> | undefined>;
  query(pk: string): Promise<Record<string, unknown>[]>;
  incr(pk: string, sk: string, fields: Record<string, number>, ttlSec?: number): Promise<void>;
  incrUnder(pk: string, sk: string, field: string, max: number, ttlSec?: number): Promise<IncrUnderResult>;
  incrManyUnder(
    pk: string,
    sk: string,
    fields: Record<string, number>,
    maxes: Record<string, number>,
    ttlSec?: number,
  ): Promise<boolean>;
}

const THROTTLE_NAMES = new Set([
  'ProvisionedThroughputExceededException',
  'ThrottlingException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const name = (e as { name?: string }).name ?? '';
      if (!THROTTLE_NAMES.has(name) || attempt === 2) throw e;
      await sleep(80 + Math.floor(Math.random() * 170));
    }
  }
  throw last;
}

function isConditionFailure(e: unknown): boolean {
  return (e as { name?: string }).name === 'ConditionalCheckFailedException';
}

export class MemoryStore implements CounterStore {
  private readonly tables = new Map<string, Map<string, Record<string, unknown>>>();

  private table(pk: string): Map<string, Record<string, unknown>> {
    let t = this.tables.get(pk);
    if (!t) {
      t = new Map();
      this.tables.set(pk, t);
    }
    return t;
  }

  async get(pk: string, sk: string): Promise<Record<string, unknown> | undefined> {
    const item = this.table(pk).get(sk);
    return item ? { ...item } : undefined;
  }

  async query(pk: string): Promise<Record<string, unknown>[]> {
    return [...this.table(pk).values()].map((v) => ({ ...v }));
  }

  async incr(pk: string, sk: string, fields: Record<string, number>, ttlSec?: number): Promise<void> {
    const t = this.table(pk);
    const item: Record<string, unknown> = { ...(t.get(sk) ?? {}), PK: pk, SK: sk };
    for (const [k, v] of Object.entries(fields)) item[k] = Number(item[k] ?? 0) + v;
    if (ttlSec !== undefined) item.ttl = ttlSec;
    t.set(sk, item);
  }

  async incrUnder(pk: string, sk: string, field: string, max: number, ttlSec?: number): Promise<IncrUnderResult> {
    const t = this.table(pk);
    const item: Record<string, unknown> = { ...(t.get(sk) ?? {}), PK: pk, SK: sk };
    const current = Number(item[field] ?? 0);
    if (current >= max) return { allowed: false, value: current };
    item[field] = current + 1;
    if (ttlSec !== undefined) item.ttl = ttlSec;
    t.set(sk, item);
    return { allowed: true, value: current + 1 };
  }

  async incrManyUnder(
    pk: string,
    sk: string,
    fields: Record<string, number>,
    maxes: Record<string, number>,
    ttlSec?: number,
  ): Promise<boolean> {
    const t = this.table(pk);
    const item: Record<string, unknown> = { ...(t.get(sk) ?? {}), PK: pk, SK: sk };
    for (const [k, delta] of Object.entries(fields)) {
      const next = Number(item[k] ?? 0) + delta;
      if (maxes[k] !== undefined && next > maxes[k]!) return false;
      item[k] = next;
    }
    if (ttlSec !== undefined) item.ttl = ttlSec;
    t.set(sk, item);
    return true;
  }
}

export class DynamoStore implements CounterStore {
  private client: import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient | undefined;

  constructor(
    private readonly tableName: string,
    private readonly region: string,
  ) {}

  private async db(): Promise<import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient> {
    if (!this.client) {
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
      this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: this.region }), {
        marshallOptions: { removeUndefinedValues: true },
      });
    }
    return this.client;
  }

  async get(pk: string, sk: string): Promise<Record<string, unknown> | undefined> {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const out = await withRetry(() =>
      this.db().then((db) => db.send(new GetCommand({ TableName: this.tableName, Key: { PK: pk, SK: sk } }))),
    );
    return out.Item as Record<string, unknown> | undefined;
  }

  async query(pk: string): Promise<Record<string, unknown>[]> {
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    const out = await withRetry(() =>
      this.db().then((db) =>
        db.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': pk },
            Limit: 200,
          }),
        ),
      ),
    );
    return (out.Items ?? []) as Record<string, unknown>[];
  }

  async incr(pk: string, sk: string, fields: Record<string, number>, ttlSec?: number): Promise<void> {
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const names: Record<string, string> = {};
    const values: Record<string, number> = {};
    const adds: string[] = [];
    let i = 0;
    for (const [k, v] of Object.entries(fields)) {
      const nk = `#f${i}`;
      const vk = `:v${i}`;
      names[nk] = k;
      values[vk] = v;
      adds.push(`${nk} ${vk}`);
      i++;
    }
    let expr = '';
    if (ttlSec !== undefined) {
      names['#ttl'] = 'ttl';
      values[':ttl'] = ttlSec;
      expr += 'SET #ttl = if_not_exists(#ttl, :ttl) ';
    }
    expr += `ADD ${adds.join(', ')}`;
    await withRetry(() =>
      this.db().then((db) =>
        db.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: pk, SK: sk },
            UpdateExpression: expr,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          }),
        ),
      ),
    );
  }

  async incrUnder(pk: string, sk: string, field: string, max: number, ttlSec?: number): Promise<IncrUnderResult> {
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const names: Record<string, string> = { '#f': field, '#ttl': 'ttl' };
    const values: Record<string, number> = { ':one': 1, ':max': max };
    let expr = '';
    if (ttlSec !== undefined) {
      values[':ttl'] = ttlSec;
      expr += 'SET #ttl = if_not_exists(#ttl, :ttl) ';
    }
    expr += 'ADD #f :one';
    try {
      const out = await withRetry(() =>
        this.db().then((db) =>
          db.send(
            new UpdateCommand({
              TableName: this.tableName,
              Key: { PK: pk, SK: sk },
              UpdateExpression: expr,
              ConditionExpression: 'attribute_not_exists(#f) OR #f < :max',
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
              ReturnValues: 'UPDATED_NEW',
            }),
          ),
        ),
      );
      return { allowed: true, value: Number(out.Attributes?.[field] ?? 1) };
    } catch (e) {
      if (isConditionFailure(e)) return { allowed: false };
      throw e;
    }
  }

  async incrManyUnder(
    pk: string,
    sk: string,
    fields: Record<string, number>,
    maxes: Record<string, number>,
    ttlSec?: number,
  ): Promise<boolean> {
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const names: Record<string, string> = { '#ttl': 'ttl' };
    const values: Record<string, number> = {};
    const adds: string[] = [];
    const conds: string[] = [];
    let i = 0;
    for (const [k, v] of Object.entries(fields)) {
      const nk = `#f${i}`;
      const vk = `:v${i}`;
      names[nk] = k;
      values[vk] = v;
      adds.push(`${nk} ${vk}`);
      const max = maxes[k];
      if (max !== undefined) {
        const limit = max - v;
        // Lượng tăng của chính request cũng phải nằm trong trần, không chỉ giá trị hiện tại.
        if (limit < 0) return false;
        const mk = `:lim${i}`;
        values[mk] = limit;
        conds.push(`(attribute_not_exists(${nk}) OR ${nk} <= ${mk})`);
      }
      i++;
    }
    let expr = '';
    if (ttlSec !== undefined) {
      values[':ttl'] = ttlSec;
      expr += 'SET #ttl = if_not_exists(#ttl, :ttl) ';
    }
    expr += `ADD ${adds.join(', ')}`;
    try {
      await withRetry(() =>
        this.db().then((db) =>
          db.send(
            new UpdateCommand({
              TableName: this.tableName,
              Key: { PK: pk, SK: sk },
              UpdateExpression: expr,
              ...(conds.length ? { ConditionExpression: conds.join(' AND ') } : {}),
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            }),
          ),
        ),
      );
      return true;
    } catch (e) {
      if (isConditionFailure(e)) return false;
      throw e;
    }
  }
}

export function createStore(cfg: { tableName?: string; awsRegion: string }): CounterStore {
  return cfg.tableName ? new DynamoStore(cfg.tableName, cfg.awsRegion) : new MemoryStore();
}


