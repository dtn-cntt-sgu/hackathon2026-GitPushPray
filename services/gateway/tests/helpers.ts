import type { GatewayConfig } from '../src/lib/config';
import { createDeps, type AiClient, type Deps } from '../src/lib/deps';
import { MemoryStore } from '../src/lib/ddb';

export function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    provider: 'none',
    groqApiKey: 'test-groq-key',
    groqModelSmall: 'openai/gpt-oss-120b',
    groqModelLarge: 'openai/gpt-oss-120b',
    aiTimeoutSmallMs: 8000,
    aiTimeoutLargeMs: 10000,
    aiContextMessages: 8,
    aiMaxNewMessages: 20,
    aiMaxInputChars: 20000,
    aiMaxInputTokens: 6000,
    aiMaxSignals: 8,
    aiMaxOutputTokensSmall: 2048,
    aiMaxOutputTokensLarge: 4096,
    aiEscalation: true,
    deviceRpm: 4,
    deviceDailyCalls: 50,
    deviceIssueRpm: 10,
    globalRpm: 20,
    globalDailyCalls: 500,
    globalDailyTokens: 2_000_000,
    maxBodyBytes: 262144,
    maxMessageChars: 2000,
    maxTotalChars: 20000,
    summaryMaxChars: 800,
    ruleHintsMax: 20,
    tokenTtlHours: 24,
    tokenSecret: 'test-token-secret-that-is-long-enough',
    allowedOrigins: ['http://localhost:5173'],
    promptVersion: 'test',
    awsRegion: 'ap-northeast-1',
    costPer1kInputUsd: 0,
    costPer1kOutputUsd: 0,
    ...overrides,
  };
}

export function makeDeps(cfg: GatewayConfig, overrides: Partial<Deps> = {}): Deps {
  return createDeps(cfg, { store: new MemoryStore(), ...overrides });
}

export const silentAi: AiClient = {
  async complete() {
    throw new Error('AI không được gọi trong test này');
  },
};

export function jsonResponse(content: unknown): { content: string; model: string; inputTokens: number; outputTokens: number } {
  return {
    content: JSON.stringify(content),
    model: 'fake-model',
    inputTokens: 100,
    outputTokens: 50,
  };
}
