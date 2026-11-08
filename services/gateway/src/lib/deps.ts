import type { AiRequest, AiTier } from '@safechat/core/ai';
import type { GatewayConfig } from './config';
import { createStore, type CounterStore } from './ddb';
import type { LogFields } from './log';
import { Limits } from './limits';
import { Metrics } from './metrics';
import { callGroq, type Completion } from './providers/groq';
import { callNone } from './providers/none';

export interface AiClient {
  complete(req: AiRequest, tier: AiTier): Promise<Completion>;
}

export function createAiClient(cfg: GatewayConfig): AiClient {
  return {
    complete(req, tier) {
      if (cfg.provider === 'none') return callNone(req);
      return callGroq(req, {
        apiKey: cfg.groqApiKey ?? '',
        model: tier === 'large' ? cfg.groqModelLarge : cfg.groqModelSmall,
        timeoutMs: tier === 'large' ? cfg.aiTimeoutLargeMs : cfg.aiTimeoutSmallMs,
        maxOutputTokens: tier === 'large' ? cfg.aiMaxOutputTokensLarge : cfg.aiMaxOutputTokensSmall,
        reasoningEffort: cfg.groqReasoningEffort,
      });
    },
  };
}

export interface Deps {
  cfg: GatewayConfig;
  store: CounterStore;
  limits: Limits;
  metrics: Metrics;
  ai: AiClient;
  now: () => number;
}

export function createDeps(cfg: GatewayConfig, overrides: Partial<Deps> = {}): Deps {
  const store = overrides.store ?? createStore(cfg);
  return {
    cfg,
    store,
    limits: overrides.limits ?? new Limits(store, cfg),
    metrics: overrides.metrics ?? new Metrics(store, cfg),
    ai: overrides.ai ?? createAiClient(cfg),
    now: overrides.now ?? (() => Date.now()),
  };
}

export interface AppVariables {
  deps: Deps;
  requestId: string;
  route: string;
  logExtra: Partial<LogFields>;
}

export type AppEnv = { Variables: AppVariables };
