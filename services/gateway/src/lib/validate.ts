import { z } from 'zod';
import type { AnalysisRequest, CreateDeviceRequest, FeedbackRequest, RuleHint } from '@safechat/contracts';
import type { ChatMessage, ScamStage } from '@safechat/core/types';
import type { GatewayConfig } from './config';
import { badRequest } from './errors';

const CLIENT = z.enum(['extension', 'android', 'web']);
const RISK = z.enum(['low', 'attention', 'high', 'critical']);
const TIER = z.enum(['small', 'large']);
const STAGE = z.enum(['S0', 'S1', 'S2', 'S3', 'S4']);
const SENDER = z.enum(['self', 'other', 'unknown']);
const VERDICT = z.enum(['correct', 'false_alarm', 'missed']);
/** Mã kỹ thuật: không cho khoảng trắng/ký tự Unicode để tránh lọt nội dung vào prompt/log. */
const CODE = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/);
const TYPE_CODE = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/);

export const createDeviceSchema = z.object({
  client: CLIENT,
  clientVersion: z.string().min(1).max(64),
});

export const feedbackSchema = z.object({
  client: CLIENT,
  level: RISK,
  signalTypes: z.array(TYPE_CODE).max(20),
  verdict: VERDICT,
});

function analysisSchema(cfg: GatewayConfig) {
  return z.object({
    client: CLIENT,
    clientVersion: z.string().min(1).max(64),
    messages: z
      .array(
        z.object({
          id: CODE,
          sender: SENDER,
          text: z.string().max(cfg.maxMessageChars),
          seq: z.number().int().nonnegative(),
          timestamp: z.string().optional(),
        }),
      )
      .min(1)
      .max(500),
    lastAiSeq: z.number().int().nonnegative(),
    summary: z.string(),
    ruleHints: z
      .array(
        z.object({
          type: TYPE_CODE,
          title: z.string().max(500),
          evidenceMessageIds: z.array(CODE).max(20).optional(),
        }),
      )
      .max(100)
      .default([]),
    currentLevel: RISK,
    stage: STAGE.optional(),
    tier: TIER,
  });
}

function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Yêu cầu không hợp lệ';
  const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${path}${issue.message}`;
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest(issueMessage(r.error));
  return r.data;
}

function isTimestamp(v: string | undefined): v is string {
  if (!v) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

export function validateAnalysisRequest(input: unknown, cfg: GatewayConfig): AnalysisRequest {
  const data = parseWith(analysisSchema(cfg), input);
  const messages: ChatMessage[] = [];
  const ids = new Set<string>();
  let previousSeq = -1;
  let totalChars = 0;

  for (const m of data.messages) {
    if (ids.has(m.id)) throw badRequest('Trường messages: id bị trùng');
    if (m.seq <= previousSeq) throw badRequest('Trường messages: seq phải tăng dần');
    ids.add(m.id);
    previousSeq = m.seq;
    totalChars += m.text.length;
    messages.push({
      id: m.id,
      sender: m.sender,
      text: m.text,
      seq: m.seq,
      // Timestamp sai định dạng bị bỏ, không dùng để quyết định.
      ...(isTimestamp(m.timestamp) ? { timestamp: m.timestamp } : {}),
    });
  }

  const maxSeq = previousSeq;
  if (data.lastAiSeq > maxSeq) throw badRequest('Trường lastAiSeq lớn hơn seq lớn nhất');
  if (totalChars > cfg.maxTotalChars) throw badRequest('Tổng văn bản vượt giới hạn; hãy giảm batch');

  // ruleHints quá nhiều: giữ phần đầu, không từ chối cả request.
  const ruleHints: RuleHint[] = data.ruleHints.slice(0, cfg.ruleHintsMax).map((h) => ({
    type: h.type,
    title: h.title,
    ...(h.evidenceMessageIds ? { evidenceMessageIds: h.evidenceMessageIds } : {}),
  }));

  return {
    client: data.client,
    clientVersion: data.clientVersion,
    messages,
    lastAiSeq: data.lastAiSeq,
    summary: data.summary,
    ruleHints,
    currentLevel: data.currentLevel,
    ...(data.stage ? { stage: data.stage as ScamStage } : {}),
    tier: data.tier,
  };
}

export function validateCreateDevice(input: unknown): CreateDeviceRequest {
  return parseWith(createDeviceSchema, input);
}

export function validateFeedback(input: unknown): FeedbackRequest {
  return parseWith(feedbackSchema, input);
}
