// npm run bench:long-eval
// Đo chỉ bằng luật trên hội thoại dài ghép từ tune: đoạn gốc nằm ở cuối hoặc ở đầu, 30 và 50 tin.
// Không gọi mạng, không dùng check. In số tổng, không in nội dung chat. Không phải số độc lập.
import { analyze } from '@safechat/core/analyzer';
import { RISK_LEVEL_ORDER as O, type RiskLevel } from '@safechat/core/types';
import type { BenchCase } from './lib/dataset';
import { loadDataset } from './lib/io';
import { padCases } from './lib/long-cases';

const tune = loadDataset('set:v2', 'tune');
const hi = (l: RiskLevel) => O[l] >= O.high;
const sets: [string, BenchCase[]][] = [
  ['original', tune],
  ['end30', padCases(tune, 30)],
  ['end50', padCases(tune, 50)],
  ['start30', padCases(tune, 30, 'after')],
  ['start50', padCases(tune, 50, 'after')],
];
const out: Record<string, { accuracy: string; dangerMiss: string; falseAlarmHigh: string; criticalHit: string; changedFromOriginal: number }> = {};
for (const [name, cases] of sets) {
  let ok = 0, miss = 0, danger = 0, fa = 0, benign = 0, crit = 0, critHit = 0, changed = 0;
  cases.forEach((c, i) => {
    const level = analyze(c.messages).risk_level;
    if (level === c.gold) ok++;
    if (hi(c.gold)) {
      danger++;
      if (!hi(level)) miss++;
    }
    if (c.gold === 'critical') {
      crit++;
      if (level === 'critical') critHit++;
    }
    if (c.kind !== 'scam') {
      benign++;
      if (hi(level)) fa++;
    }
    if (level !== analyze(tune[i]!.messages).risk_level) changed++;
  });
  out[name] = { accuracy: `${ok}/${cases.length}`, dangerMiss: `${miss}/${danger}`, falseAlarmHigh: `${fa}/${benign}`, criticalHit: `${critHit}/${crit}`, changedFromOriginal: changed };
}
console.log(JSON.stringify(out, null, 1));
