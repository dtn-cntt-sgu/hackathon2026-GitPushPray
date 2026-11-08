import { ERROR_STATUS, type ApiError, type ApiErrorCode } from '@safechat/contracts';

export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfterSec?: number,
    readonly detail?: string,
  ) {
    super(message);
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toBody(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.retryAfterSec !== undefined ? { retryAfterSec: this.retryAfterSec } : {}),
      },
    };
  }
}

export const badRequest = (message = 'Yêu cầu không hợp lệ', detail?: string) => new AppError('BAD_REQUEST', message, undefined, detail);
export const unauthorized = (message = 'Không được phép', detail?: string) => new AppError('UNAUTHORIZED', message, undefined, detail);
export const quotaExceeded = (message = 'Đã hết lượt phân tích AI hôm nay.', retryAfterSec?: number) =>
  new AppError('QUOTA_EXCEEDED', message, retryAfterSec);
export const budgetExceeded = (message = 'Ngân sách AI dùng chung đã hết.', retryAfterSec?: number) =>
  new AppError('BUDGET_EXCEEDED', message, retryAfterSec);
export const modelUnavailable = (message = 'Dịch vụ AI tạm thời không khả dụng; giữ kết quả luật.', detail?: string) =>
  new AppError('MODEL_UNAVAILABLE', message, undefined, detail);
export const timeout = (message = 'Dịch vụ AI quá thời gian chờ; giữ kết quả luật.', detail?: string) =>
  new AppError('TIMEOUT', message, undefined, detail);
export const internal = (message = 'Lỗi hệ thống', detail?: string) => new AppError('INTERNAL', message, undefined, detail);

/** Lỗi nội bộ từ provider. Không bao giờ trả detail cho client. */
export class ProviderError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfterSec?: number,
    readonly providerStatus?: number,
    /** Groq từ chối JSON vì model reasoning dùng hết max_tokens; có thể retry với ngân sách lớn hơn. */
    readonly jsonValidationFailed = false,
  ) {
    super(message);
  }

  toAppError(): AppError {
    if (this.code === 'TIMEOUT') return timeout(undefined, this.message);
    if (this.code === 'QUOTA_EXCEEDED') return quotaExceeded(undefined, this.retryAfterSec);
    if (this.code === 'BUDGET_EXCEEDED') return budgetExceeded(undefined, this.retryAfterSec);
    return modelUnavailable(undefined, this.message);
  }
}

export function toApiError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ProviderError) return e.toAppError();
  return internal();
}
