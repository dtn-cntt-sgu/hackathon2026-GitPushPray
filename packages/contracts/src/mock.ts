// Phản hồi mẫu để làm client khi gateway chưa xong. Không gọi mạng và không tốn chi phí.
import type { AnalysisRequest, AnalysisResponse, ApiError, CreateDeviceResponse } from './index';

export const MOCK_DEVICE: CreateDeviceResponse = {
  token: 'mock-token',
  expiresAt: '2030-01-01T00:00:00.000Z',
};

/** Trích tin đối phương cuối cùng làm bằng chứng, giống hình dạng phản hồi thật. */
export function mockAnalysis(req: AnalysisRequest): AnalysisResponse {
  const last = [...req.messages].reverse().find((m) => m.sender !== 'self');
  return {
    signals: last
      ? [
          {
            type: 'ai_mock_signal',
            category: 'pressure',
            severity: 'medium',
            title: 'Tín hiệu mẫu từ AI',
            explanation: 'Dữ liệu mẫu để thử giao diện, không phải kết quả phân tích thật.',
            evidence_message_ids: [last.id],
            evidence_quotes: [last.text.slice(0, 80)],
            recommended_action: 'Xác minh độc lập trước khi quyết định.',
            source: 'ai',
            confidence: 0.5,
          },
        ]
      : [],
    summary: 'Tóm tắt mẫu.',
    uncertainties: ['Đây là dữ liệu mẫu.'],
    rejected: 0,
    usage: { model: 'mock', tier: req.tier, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 },
  };
}

export const MOCK_QUOTA_ERROR: ApiError = {
  error: { code: 'QUOTA_EXCEEDED', message: 'Đã hết lượt phân tích AI hôm nay.', retryAfterSec: 3600 },
};
