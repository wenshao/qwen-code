// Shared HTML card shell. card({ title, sub, blocks: [{ h, svg | table | pre | note }] }) → html string
export function esc(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
export function table(head, rows) {
  const cell = (v) => {
    const s = String(v);
    const cls = /^(✔|PASS|KILLED|completed|yes)/.test(s) ? 'ok' : /^(✖|FAIL|SURVIVED|failed)/.test(s) ? 'bad' : /^(~|note)/.test(s) ? 'warn' : '';
    return `<td class="${cls}">${esc(s)}</td>`;
  };
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map(cell).join('')}</tr>`)
    .join('')}</tbody></table>`;
}
export function card({ title, sub, blocks, width = 1540 }) {
  const body = blocks
    .map((b) => {
      let out = b.h ? `<h2>${esc(b.h)}</h2>` : '';
      if (b.cap) out += `<div class="cap">${esc(b.cap)}</div>`;
      if (b.svg) out += `<div class="svg">${b.svg}</div>`;
      if (b.table) out += b.table;
      if (b.pre) out += `<pre>${esc(b.pre)}</pre>`;
      if (b.imgs) out += `<div class="imgs">${b.imgs.map((i) => `<figure><figcaption>${esc(i.cap)}</figcaption><img src="${i.src}" style="width:${i.w ?? 100}%"></figure>`).join('')}</div>`;
      if (b.note) out += `<div class="note">${esc(b.note)}</div>`;
      return out;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif}
#card{padding:26px 30px 22px;width:${width}px}
h1{font-size:25px;margin:0 0 6px}
.sub{color:#8b949e;margin:0 0 10px;font-size:15px}
h2{font-size:18px;margin:20px 0 4px;color:#79c0ff}
.cap{color:#8b949e;font-size:14px;margin:0 0 4px}
table{border-collapse:collapse;width:100%;font-size:14.5px;margin-top:6px}
th{text-align:left;color:#8b949e;font-weight:600;border-bottom:1px solid #30363d;padding:6px 8px}
td{border-bottom:1px solid #21262d;padding:6px 8px;font-family:ui-monospace,Menlo,monospace;font-size:13.5px;vertical-align:top}
td.ok{color:#3fb950}td.bad{color:#f85149}td.warn{color:#d29922}td.chg{background:#1c2a1f}
pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;font-size:13px;white-space:pre-wrap;margin:6px 0}
.imgs{display:flex;gap:14px;flex-wrap:wrap}.imgs figure{margin:6px 0;flex:1 1 45%}.imgs img{border:1px solid #30363d;border-radius:6px;display:block}figcaption{color:#e6edf3;font-size:14px;margin:4px 0}
.note{border-left:4px solid #3fb950;padding:6px 12px;margin-top:14px;font-size:15px;background:#0f1a12}
</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;
}
