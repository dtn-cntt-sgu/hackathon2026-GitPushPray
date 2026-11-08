// Đọc và kiểm tra biến môi trường. Fail fast ở cold start: thiếu secret hoặc giá trị sai
// thì không phục vụ request nào thay vì chạy với cấu hình nửa vời.

export type AiProviderName = 'groq' | 'none';

export interface GatewayConfig {
  provider: AiProviderName;
  groqApiKey?: string;
  groqModelSmall: string;
  groqModelLarge: string;
  groqReasoningEffort?: 'low' | 'medium' | 'high';
  aiTimeoutSmallMs: number;
  aiTimeoutLargeMs: number;
  aiContextMessages: number;
  aiMaxNewMessages: number;
  aiMaxInputChars: number;
  aiMaxInputTokens: number;
  aiMaxSignals: number;
  aiMaxOutputTokensSmall: number;
  aiMaxOutputTokensLarge: number;
  aiEscalation: boolean;
  deviceRpm: number;
  deviceDailyCalls: number;
  deviceIssueRpm: number;
  globalRpm: number;
  globalDailyCalls: number;
  globalDailyTokens: number;
  maxBodyBytes: number;
  maxMessageChars: number;
  maxTotalChars: number;
  summaryMaxChars: number;
  ruleHintsMax: number;
  tokenTtlHours: number;
  tokenSecret: string;
  tokenSecretPrevious?: string;
  allowedOrigins: string[];
  promptVersion: string;
  tableName?: string;
  awsRegion: string;
  metricsAdminToken?: string;
  costPer1kInputUsd: number;
  costPer1kOutputUsd: number;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`Thiếu biến môi trường ${name}`);
  return value;
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^-?\d+$/.test(raw)) throw new ConfigError(`${name} phải là số nguyên`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ConfigError(`${name} nằm ngoài khoảng ${min}..${max}`);
  return n;
}

function num(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new ConfigError(`${name} phải là số không âm`);
  return n;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'on', 'yes'].includes(raw)) return true;
  if (['0', 'false', 'off', 'no'].includes(raw)) return false;
  throw new ConfigError(`${name} phải là on/off`);
}

function list(env: Env, name: string): string[] {
  return (env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

let secretsClient: import('@aws-sdk/client-secrets-manager').SecretsManagerClient | undefined;

async function readSecret(arn: string, region: string): Promise<string> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  secretsClient ??= new SecretsManagerClient({ region });
  const out = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }));
  const raw = out.SecretString ?? (out.SecretBinary ? Buffer.from(out.SecretBinary).toString('utf8') : '');
  if (!raw) throw new ConfigError(`Secret ${arn} rỗng`);
  // Cho phép secret dạng chuỗi thuần hoặc JSON {apiKey|token|secret}.
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed.apiKey ?? parsed.token ?? parsed.secret ?? parsed.value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    // không phải JSON: dùng nguyên chuỗi
  }
  return raw.trim();
}

async function resolveSecret(env: Env, directName: string, arnName: string, region: string): Promise<string | undefined> {
  const direct = env[directName]?.trim();
  if (direct) return direct;
  const arn = env[arnName]?.trim();
  if (!arn) return undefined;
  try {
    return await readSecret(arn, region);
  } catch (e) {
    throw new ConfigError(`Không đọc được secret ${arnName}: ${(e as Error).message}`);
  }
}

function reasoningEffort(raw: string | undefined): GatewayConfig['groqReasoningEffort'] {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  throw new ConfigError('GROQ_REASONING_EFFORT chỉ nhận low, medium hoặc high');
}

export async function loadConfig(env: Env = process.env): Promise<GatewayConfig> {
  const awsRegion = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || 'ap-northeast-1';
  const providerRaw = (env.AI_PROVIDER?.trim().toLowerCase() || 'none') as AiProviderName;
  if (providerRaw !== 'groq' && providerRaw !== 'none') throw new ConfigError('AI_PROVIDER phải là groq hoặc none');

  const tokenSecret = await resolveSecret(env, 'TOKEN_SECRET', 'TOKEN_SECRET_ARN', awsRegion);
  if (!tokenSecret) throw new ConfigError('Thiếu TOKEN_SECRET hoặc TOKEN_SECRET_ARN');
  if (Buffer.byteLength(tokenSecret, 'utf8') < 32) throw new ConfigError('TOKEN_SECRET phải dài tối thiểu 32 byte');
  const tokenSecretPrevious = await resolveSecret(env, 'TOKEN_SECRET_PREVIOUS', 'TOKEN_SECRET_PREVIOUS_ARN', awsRegion);

  let groqApiKey: string | undefined;
  if (providerRaw === 'groq') {
    groqApiKey = await resolveSecret(env, 'GROQ_API_KEY', 'GROQ_SECRET_ARN', awsRegion);
    if (!groqApiKey) throw new ConfigError('AI_PROVIDER=groq nhưng thiếu GROQ_API_KEY hoặc GROQ_SECRET_ARN');
  }

  const metricsAdminToken = await resolveSecret(env, 'METRICS_ADMIN_TOKEN', 'ADMIN_TOKEN_SECRET_ARN', awsRegion);

  return {
    provider: providerRaw,
    groqApiKey,
    groqModelSmall: env.GROQ_MODEL_SMALL?.trim() || env.MODEL_SMALL?.trim() || 'openai/gpt-oss-120b',
    groqModelLarge: env.GROQ_MODEL_LARGE?.trim() || env.MODEL_LARGE?.trim() || 'openai/gpt-oss-120b',
    groqReasoningEffort: reasoningEffort(env.GROQ_REASONING_EFFORT),
    aiTimeoutSmallMs: int(env, 'AI_TIMEOUT_SMALL_MS', 8000, 1000, 60000),
    aiTimeoutLargeMs: int(env, 'AI_TIMEOUT_LARGE_MS', 10000, 1000, 60000),
    aiContextMessages: int(env, 'AI_CONTEXT_MESSAGES', 8, 0, 30),
    aiMaxNewMessages: int(env, 'AI_MAX_NEW_MESSAGES', 50, 1, 100),
    aiMaxInputChars: int(env, 'AI_MAX_INPUT_CHARS', 20000, 1000, 200000),
    aiMaxInputTokens: int(env, 'AI_MAX_INPUT_TOKENS', 7500, 256, 100000),
    aiMaxSignals: int(env, 'AI_MAX_SIGNALS', 8, 1, 20),
    aiMaxOutputTokensSmall: int(env, 'AI_MAX_OUTPUT_TOKENS_SMALL', 2048, 128, 8192),
    aiMaxOutputTokensLarge: int(env, 'AI_MAX_OUTPUT_TOKENS_LARGE', 4096, 128, 8192),
    aiEscalation: bool(env, 'AI_ESCALATION', true),
    deviceRpm: int(env, 'DEVICE_RPM', 4, 1, 120),
    deviceDailyCalls: int(env, 'DEVICE_DAILY_CALLS', 50, 1, 10000),
    deviceIssueRpm: int(env, 'DEVICE_ISSUE_RPM', 10, 1, 120),
    // Groq free tier giới hạn token/phút: thêm trần toàn cục theo phút để tránh 429 dây chuyền.
    globalRpm: int(env, 'GLOBAL_RPM', 20, 1, 600),
    globalDailyCalls: int(env, 'GLOBAL_DAILY_CALLS', 500, 1, 1000000),
    globalDailyTokens: int(env, 'GLOBAL_DAILY_TOKENS', 2_000_000, 1000, 1_000_000_000),
    maxBodyBytes: int(env, 'MAX_BODY_BYTES', 262144, 1024, 2_000_000),
    maxMessageChars: int(env, 'MAX_MESSAGE_CHARS', 2000, 100, 20000),
    maxTotalChars: int(env, 'MAX_TOTAL_CHARS', 20000, 1000, 200000),
    summaryMaxChars: int(env, 'SUMMARY_MAX_CHARS', 800, 100, 4000),
    ruleHintsMax: int(env, 'RULE_HINTS_MAX', 20, 1, 100),
    tokenTtlHours: int(env, 'TOKEN_TTL_HOURS', 24, 1, 720),
    tokenSecret,
    tokenSecretPrevious,
    allowedOrigins: list(env, 'ALLOWED_ORIGINS'),
    promptVersion: env.PROMPT_VERSION?.trim() || 'v2',
    tableName: env.TABLE_NAME?.trim() || undefined,
    awsRegion,
    metricsAdminToken,
    // Giá niêm yết Groq cho gpt-oss-120b (USD / 1K token); đổi bằng env nếu Groq cập nhật.
    costPer1kInputUsd: num(env, 'GROQ_COST_PER_1K_INPUT_USD', 0.00015),
    costPer1kOutputUsd: num(env, 'GROQ_COST_PER_1K_OUTPUT_USD', 0.00075),
  };
}
