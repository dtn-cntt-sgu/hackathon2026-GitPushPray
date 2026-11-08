// npm run bench:models — liệt kê model ":free" đang có trên OpenRouter (lưu research/data/models.json).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, DATA_DIR, loadEnv } from './lib/io';
import { OpenRouterClient } from './providers/openrouter';

loadEnv();
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('Chưa có OPENROUTER_API_KEY (đặt trong research/.env hoặc biến môi trường).');
  process.exit(1);
}
const client = new OpenRouterClient({ apiKey, cacheDir: CACHE_DIR, dailyCap: 1000 });
const models = await client.listFreeModels();
mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(join(DATA_DIR, 'models.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), models }, null, 2));
console.log(`${models.length} model miễn phí (${new Date().toISOString().slice(0, 10)}):`);
for (const m of models.sort((a, b) => b.context - a.context))
  console.log(
    `  ${m.id.padEnd(60)} ctx ${String(m.context).padStart(7)}${m.paidPrice ? `  · bản trả phí $${(m.paidPrice.prompt * 1e6).toFixed(2)}/$${(m.paidPrice.completion * 1e6).toFixed(2)} mỗi 1M token` : ''}`,
  );
console.log(`\nĐã dùng hôm nay: ${client.usedToday()} lượt.`);
