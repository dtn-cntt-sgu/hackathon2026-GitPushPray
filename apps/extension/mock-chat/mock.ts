// Trang chat giả lập: "phát" từng tin của một kịch bản trong fixtures/scenarios.json.
// Phần tử [data-safechat-mock-thread] là nơi content script (mockAdapter) đọc tin nhắn.
import scenarios from '../../../fixtures/scenarios.json';

type Msg = { sender: 'self' | 'other'; text: string };
type Scenario = { id: string; title: string; messages: Msg[] };

const list = scenarios as Scenario[];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>('scenario');
const thread = $<HTMLDivElement>('thread');
const title = $<HTMLHeadingElement>('title');
const autoBtn = $<HTMLButtonElement>('auto');

let current: Scenario = list[0]!;
let shown: Msg[] = [];
let autoTimer: ReturnType<typeof setInterval> | undefined;

for (const s of list) select.append(new Option(`${s.id} — ${s.title}`, s.id));

function bubble(m: Msg): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bubble';
  el.dataset.msg = '';
  el.dataset.sender = m.sender;
  const t = document.createElement('span');
  t.className = 'text';
  t.textContent = m.text;
  el.append(t);
  return el;
}

function renderAll() {
  thread.replaceChildren(...shown.map(bubble));
}

function load(id: string) {
  stopAuto();
  current = list.find((s) => s.id === id) ?? list[0]!;
  shown = [];
  title.textContent = `Giả lập: ${current.title}`;
  thread.dataset.safechatMockThread = current.id;
  thread.dataset.threadLabel = current.title;
  history.replaceState(null, '', `#/t/${current.id}`);
  renderAll();
}

function next(): boolean {
  const m = current.messages[shown.length];
  if (!m) return false;
  shown.push(m);
  thread.append(bubble(m));
  return true;
}

function stopAuto() {
  clearInterval(autoTimer);
  autoTimer = undefined;
  autoBtn.textContent = 'Tự phát';
}

select.addEventListener('change', () => load(select.value));
$('next').addEventListener('click', () => next());
$('rerender').addEventListener('click', renderAll);
autoBtn.addEventListener('click', () => {
  if (autoTimer) return stopAuto();
  autoBtn.textContent = 'Dừng tự phát';
  autoTimer = setInterval(() => {
    if (!next()) stopAuto();
  }, 1800);
});
$('compose').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('text');
  const text = input.value.trim();
  if (!text) return;
  const m: Msg = { sender: $<HTMLSelectElement>('sender').value as Msg['sender'], text };
  shown.push(m);
  thread.append(bubble(m));
  input.value = '';
});

const fromHash = /#\/t\/([\w-]+)/.exec(location.hash)?.[1];
if (fromHash) select.value = fromHash;
load(select.value);
