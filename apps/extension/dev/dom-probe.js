// Dò cấu trúc DOM khung chat popup của Facebook để viết adapter.
// Cách dùng: mở facebook.com với ĐÚNG 1 khung chat popup → F12 → Console → dán toàn bộ file → Enter.
// Kết quả tự chép vào clipboard. KHÔNG in nội dung tin nhắn: chữ chỉ ghi độ dài, chữ số trong link bị che.
(() => {
  const mask = (s) => (s || '').replace(/\d/g, '#');
  const short = (s) => (s == null ? null : s.length > 30 ? `<${s.length} ký tự>` : s);
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const attrs = (el) =>
    [...el.attributes]
      .map((a) => a.name)
      .filter((n) => n !== 'class' && n !== 'style')
      .join(',');
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    aria: short(el.getAttribute('aria-label')),
    attrs: attrs(el),
    ...rect(el),
  });

  const boxes = [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')];
  const out = {
    path: mask(location.pathname),
    textboxes: boxes.length,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    grids: document.querySelectorAll('[role="grid"]').length,
    popups: [],
  };

  for (const box of boxes) {
    const chain = [];
    let root = null;
    let el = box;
    for (let i = 0; el && i < 30; i++, el = el.parentElement) {
      chain.push({
        up: i,
        ...desc(el),
        rows: el.querySelectorAll('[role="row"]').length,
        dirAuto: el.querySelectorAll('div[dir="auto"]').length,
        grid: el.querySelectorAll('[role="grid"]').length,
        log: el.querySelectorAll('[role="log"]').length,
        links: el.querySelectorAll('a[href]').length,
      });
      if (!root && el.getBoundingClientRect().height > 300 && el.querySelectorAll('div[dir="auto"]').length > 3) root = el;
    }
    const p = { textbox: desc(box), chain };
    if (root) {
      const rr = root.getBoundingClientRect();
      p.links = [...root.querySelectorAll('a[href]')].slice(0, 15).map((a) => ({
        href: mask(new URL(a.href, location.href).pathname),
        aria: short(a.getAttribute('aria-label')),
        ...rect(a),
      }));
      p.headings = [...root.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].map((h) => ({ ...desc(h), textLen: h.textContent.length }));
      // 8 đoạn chữ cuối: đường đi role từ gốc, vị trí trái/phải, chỉ độ dài chữ
      p.samples = [...root.querySelectorAll('div[dir="auto"]')]
        .filter((d) => !d.parentElement?.closest('div[dir="auto"]') && !d.closest('[contenteditable]'))
        .slice(-8)
        .map((d) => {
          const path = [];
          for (let e = d; e && e !== root; e = e.parentElement) {
            const r = e.getAttribute('role');
            const al = e.getAttribute('aria-label');
            if (r || al || e.tagName === 'A' || [...e.attributes].some((a) => a.name.startsWith('data-')))
              path.push(`${e.tagName.toLowerCase()}${r ? `[role=${r}]` : ''}${al ? `[aria=${short(al)}]` : ''}${attrs(e).includes('data-') ? `{${attrs(e)}}` : ''}`);
          }
          const r = d.getBoundingClientRect();
          return { textLen: d.innerText.length, side: r.left + r.width / 2 > rr.left + rr.width / 2 ? 'phai' : 'trai', ...rect(d), path: path.reverse() };
        });
    }
    out.popups.push(p);
  }
  const json = JSON.stringify(out, null, 1);
  console.log(json);
  try {
    copy(json);
    console.log('Đã chép kết quả vào clipboard.');
  } catch {}
})();
