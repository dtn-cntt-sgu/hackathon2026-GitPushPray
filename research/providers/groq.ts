// Groq có API tương thích OpenAI nên dùng lại client của OpenRouter, chỉ đổi URL và thư mục cache.
// Cache tách riêng vì cùng một tên model trên hai nhà cung cấp vẫn là hai lần đo khác nhau.
export const GROQ_URL = process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1';
export const GROQ_LABEL = 'Groq';
