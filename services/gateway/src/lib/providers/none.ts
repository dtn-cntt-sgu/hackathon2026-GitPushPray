import type { AiRequest } from '@safechat/core/ai';
import { ProviderError } from '../errors';
import type { Completion } from './groq';

/** Kill switch: AI_PROVIDER=none. Trả lỗi có kiểu để client giữ kết quả luật. */
export async function callNone(_req: AiRequest): Promise<Completion> {
  throw new ProviderError('MODEL_UNAVAILABLE', 'AI_PROVIDER=none');
}
