// npm run bench:rules-dev -- [--list]
// Đo bộ luật trên các file phát triển luật ngoài repo (research/dataset/nguoiviet_*.csv). Không gọi mạng.
// Các file này đã được đọc khi viết luật nên KHÔNG phải số độc lập. In mã câu, mức và tên tín hiệu, không in nội dung.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '@safechat/core/analyzer';
import { RISK_LEVEL_ORDER as O, type ChatMessage, type RiskLevel } from '@safechat/core/types';
import { parseCsv } from './lib/csv';
import { RESEARCH_DIR } from './lib/io';

const MAP: Record<string, RiskLevel> = { thap: 'low', can_chu_y: 'attention', cao: 'high', nghiem_trong: 'critical' };
const list = process.argv.includes('--list');
const hi = (l: RiskLevel) => O[l] >= O.high;
const dir = join(RESEARCH_DIR, 'dataset');
const read = (name: string) => parseCsv(readFileSync(join(dir, name), 'utf8')).rows;
const single = (text: string): ChatMessage[] => [{ id: 'msg-001', seq: 1, sender: 'other', text }];

interface Item { id: string; gold: RiskLevel; danger: boolean; messages: ChatMessage[] }
const report = (name: string, items: Item[]) => {
  let ok = 0, under = 0, over = 0, miss = 0, danger = 0, fa = 0, benign = 0, crit = 0, critHit = 0;
  for (const it of items) {
    const r = analyze(it.messages);
    const l = r.risk_level;
    if (l === it.gold) ok++;
    else if (O[l] < O[it.gold]) under++;
    else over++;
    if (it.danger) {
      danger++;
      if (!hi(l)) miss++;
    } else {
      benign++;
      if (hi(l)) fa++;
    }
    if (it.gold === 'critical') {
      crit++;
      if (l === 'critical') critHit++;
    }
    if (list) console.log(`  ${it.id} nhan=${it.gold} luat=${l} [${r.signals.filter((s) => !s.mitigation).map((s) => s.type).join(',')}]`);
  }
  console.log(`${name}: dung ${ok}/${items.length}, thap hon ${under}, cao hon ${over}, nguy hiem duoi Cao ${miss}/${danger}, binh thuong Cao+ ${fa}/${benign}, Nghiem trong ${critHit}/${crit}`);
};

if (existsSync(join(dir, 'nguoiviet_de_doa.csv'))) {
  report('de_doa', read('nguoiviet_de_doa.csv').map((r, i) => ({ id: i < 10 ? `A${String(i + 1).padStart(2, '0')}` : `B${String(i - 9).padStart(2, '0')}`, gold: MAP[r.values.nhan!.trim()]!, danger: i < 10, messages: single(r.values.tin_nhan!) })));
}
if (existsSync(join(dir, 'nguoiviet_kich_ban_nang_cao.csv'))) {
  report('nang_cao', read('nguoiviet_kich_ban_nang_cao.csv').map((r) => {
    const noise = r.values.loai_kich_ban!.startsWith('Nhiễu');
    return { id: `N${r.values.stt!.padStart(2, '0')}`, gold: MAP[r.values.nhan_kiem_thu!.trim()]!, danger: !noise, messages: single(r.values.tin_nhan!) };
  }));
}
for (const [name, file] of [['multiturn', 'nguoiviet_multiturn_fixtures.csv'], ['multiturn_noise', 'nguoiviet_multiturn_noise_fixtures.csv']] as const) {
  if (!existsSync(join(dir, file))) continue;
  const rows = read(file);
  const msgs: ChatMessage[] = rows.map((r, i) => ({ id: `msg-${String(i + 1).padStart(3, '0')}`, seq: i + 1, sender: r.values.sender === 'A' ? 'other' : 'self', text: r.values.message! }));
  const items: Item[] = rows.flatMap((r, i) => {
    if (r.values.sender !== 'A') return [];
    const gold = MAP[r.values.nhan_kiem_thu!.trim()]!;
    return [{ id: `T${String(i + 1).padStart(2, '0')}`, gold, danger: hi(gold), messages: msgs.slice(0, i + 1) }];
  });
  report(name, items);
}
