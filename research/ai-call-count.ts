// npm run bench:ai-calls -- [--batch 5] [--idle 60]
// Đếm số lượt sản phẩm sẽ gọi AI trên tune theo chính sách decideAiRun. Dùng AI giả, không gọi mạng,
// không tốn hạn mức và không đo được chất lượng. In số tổng, không in nội dung chat.
import { arg, loadDataset } from './lib/io';
import { goldDangerTurn, replayCase } from './lib/replay';

const batchSize = Number(arg('batch', '5'));
const idleFlushSec = Number(arg('idle', '60'));
const fake = async () => JSON.stringify({ signals: [], summary: 'tóm tắt' });

const cases = loadDataset('set:v2', 'tune');
let calls = 0;
let otherMessages = 0;
let noCall = 0;
let leftover = 0;
let casesWithLeftover = 0;
let dangerCases = 0;
let dangerAfterLastCall = 0;
for (const c of cases) {
  const r = await replayCase(c, { callAi: fake, batchSize, idleFlushSec });
  calls += r.aiCalls;
  otherMessages += r.turns.length;
  if (r.aiCalls === 0) noCall++;
  const lastCalled = r.turns.reduce((last, t) => (t.aiCalled ? t.dpTurn : last), 0);
  const tail = r.turns.length - lastCalled;
  leftover += tail;
  if (tail > 0) casesWithLeftover++;
  // Tin đầu tiên nhãn lên từ Cao trở lên nhưng AI không còn lượt nào đọc tới
  const danger = goldDangerTurn(c);
  if (danger !== undefined) {
    dangerCases++;
    if (danger > lastCalled) dangerAfterLastCall++;
  }
}
console.log(
  JSON.stringify({
    dataset: 'set:v2/tune',
    cases: cases.length,
    batchSize,
    idleFlushSec,
    aiCalls: calls,
    callsPerCase: Number((calls / cases.length).toFixed(2)),
    otherMessages,
    casesWithNoCall: noCall,
    casesWithLeftover,
    leftoverMessages: leftover,
    dangerCases,
    dangerAfterLastCall,
  }),
);
