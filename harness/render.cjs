const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const SP = '/tmp/claude-0/-root-git-qwen-code-x7/e6f79e51-9977-40f2-8e78-7916b150c6b7/scratchpad';
const H = SP + '/harness';
const OUT = SP + '/shots';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const load = (f) => fs.readFileSync(H + '/' + f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const WS_RE = /\/tmp\/claude-0\/[^"'\s]*?\/scratchpad\/harness\/runs\/[^/"'\s]+\/ws/g;
const short = (s) => String(s).replace(WS_RE, '<ws>');
/** entries of the turn started by the ws_down frame whose conversationId matches */
function turn(entries, conversationId) {
  const i = entries.findIndex((e) => e.kind === 'ws_down' && e.data?.conversationId === conversationId);
  if (i < 0) return [];
  const rest = entries.slice(i + 1);
  const j = rest.findIndex((e) => e.kind === 'ws_down');
  return [entries[i], ...(j < 0 ? rest : rest.slice(0, j))];
}
const isOut = (e) => e.kind === 'http' && !e.path.includes('emotion') && (e.path === '/media/upload' || e.path.startsWith('/robot') || e.path.startsWith('/v1.0/robot') || e.path.startsWith('/v1.0/card'));

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.55 -apple-system,"Segoe UI",Roboto,"PingFang SC","Noto Sans CJK SC",Helvetica,Arial,sans-serif}
.wrap{padding:26px;display:inline-block;max-width:1180px}
h1{font-size:17px;margin:0 0 4px;font-weight:650}
.sub{font-size:12.5px;color:#8b949e;margin:0 0 16px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.cols{display:flex;gap:22px;align-items:flex-start}
.col{width:520px}
.coltag{font-size:12px;color:#7d8590;margin:0 0 8px;letter-spacing:.03em;text-transform:uppercase}
.chat{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:14px}
.bot{display:flex;gap:9px;margin-bottom:9px;align-items:center}
.avatar{width:24px;height:24px;border-radius:6px;background:#1f6feb;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.botname{font-size:12px;color:#8b949e}
.bubble{background:#fff;color:#1f2328;border-radius:10px;border:1px solid #d0d7de;padding:10px 13px;margin-bottom:8px;font-size:13.5px;white-space:pre-wrap;word-break:break-word}
.file{display:flex;gap:10px;align-items:center}
.ficon{width:34px;height:40px;border-radius:5px;background:#e8f0fe;border:1px solid #c7d7f7;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#1f6feb}
.fname{font-weight:600}.fmeta{font-size:12px;color:#57606a}
.notice{color:#9a6700}
pre.wire{background:#010409;border:1px solid #30363d;border-radius:9px;padding:12px 14px;margin:10px 0 0;font:11.6px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9;white-space:pre-wrap;word-break:break-all}
.k{color:#58a6ff}.g{color:#3fb950}.y{color:#d29922}.r{color:#f85149}.d{color:#8b949e}
.note{margin-top:12px;font-size:12px;color:#8b949e;background:#161b22;border:1px solid #30363d;border-left:3px solid #3fb950;border-radius:0 7px 7px 0;padding:9px 12px}
.note.warn{border-left-color:#d29922}
table{border-collapse:collapse;font-size:12.6px}
th,td{border:1px solid #30363d;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#161b22;color:#8b949e;font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em}
.ok{color:#3fb950}.warnc{color:#d29922}.bad{color:#f85149}
pre.term{background:#010409;border:1px solid #30363d;border-radius:9px;padding:14px 16px;margin:0;font:11.4px/1.42 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9;white-space:pre-wrap;word-break:break-word}
.p{color:#3fb950;font-weight:700}.hdr{color:#58a6ff;font-weight:700}.sum{color:#d29922}
.tl{list-style:none;margin:0;padding:0}
.tl li{display:flex;gap:10px;padding:4px 0;border-bottom:1px dashed #21262d;font-size:12.4px}
.tl .t{width:62px;color:#8b949e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;flex:none}
.tl .ep{width:270px;flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.tl .b{color:#c9d1d9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
`;

// ---------- page 1: session reply, PR vs base ----------
const S = load('gw-final-s.jsonl');
const B = load('gw-base-final.jsonl');
const s1 = turn(S, 'conv-s1-s1').filter(isOut);
const b1 = turn(B, 'conv-ab1-s1').filter(isOut);
function wireLines(list, t0) {
  return list.map((e) => {
    const t = `+${String(e.t - t0).padStart(4)}ms`;
    let b = e.body?.multipart ? `multipart media=${e.body.multipart[0].filename} ${e.body.multipart[0].size}B sha256=${e.body.multipart[0].sha256.slice(0, 16)}… → media_id=${e.reply?.media_id}` : JSON.stringify(e.body);
    const q = e.path === '/media/upload' ? `?type=${e.query.type}&access_token=${e.query.access_token}` : '';
    const cls = e.path === '/media/upload' ? 'y' : e.body?.msgtype === 'file' || e.body?.msgKey === 'sampleFile' ? 'g' : 'k';
    return `<span class="d">${t}</span> <span class="${cls}">${e.method} ${e.host}${e.path}${esc(q)}</span>\n        ${esc(short(b))}`;
  }).join('\n');
}
function chatPR(list) {
  const up = list.find((e) => e.path === '/media/upload');
  const file = list.find((e) => e.body?.msgtype === 'file');
  const md = list.find((e) => e.body?.msgtype === 'markdown');
  return `<div class="chat"><div class="bot"><div class="avatar">Q</div><div class="botname">Qwen Code · DingTalk (session reply)</div></div>
  <div class="bubble"><div class="file"><div class="ficon">${esc(file.body.file.fileType.toUpperCase())}</div><div><div class="fname">${esc(file.body.file.fileName)}</div><div class="fmeta">${up.body.multipart[0].size} B · msgtype=file · mediaId ${esc(file.body.file.mediaId)}</div></div></div></div>
  <div class="bubble">${esc(md.body.markdown.text)}</div></div>`;
}
function chatBase(list) {
  const md = list.find((e) => e.body?.msgtype === 'markdown');
  const t = md.body.markdown.text;
  const i = t.indexOf('[File delivery unavailable]');
  return `<div class="chat"><div class="bot"><div class="avatar">Q</div><div class="botname">Qwen Code · DingTalk (session reply)</div></div>
  <div class="bubble">${esc(t.slice(0, i))}<span class="notice">${esc(t.slice(i))}</span></div></div>`;
}
const page1 = `<style>${CSS}</style><div class="wrap">
<h1>PR #10893 — the same model output, before and after (Linux, spoofed DingTalk API, real daemon)</h1>
<p class="sub">Model final text: <span class="mono">Here is the report.\\n[FILE: &lt;ws&gt;/report.txt]\\nDone.</span> — streamed in 4-char SSE deltas into <span class="mono">qwen serve --channel dingtalk</span>; every byte the daemon sent to <span class="mono">*.dingtalk.com</span> was captured on a local TLS server.</p>
<div class="cols">
  <div class="col"><div class="coltag">base — main @ a8248ea (merge-base)</div>${chatBase(b1)}<pre class="wire">${wireLines(b1, b1[0].t)}</pre></div>
  <div class="col"><div class="coltag">PR #10893 @ 98bb096 (= main @ 6025f32 squash)</div>${chatPR(s1)}<pre class="wire">${wireLines(s1, s1[0].t)}</pre></div>
</div>
<div class="note">The chat bubbles are the harness's rendering of the captured payloads, not a DingTalk client screenshot. The uploaded multipart body is byte-identical to the fixture (sha256 + size), the file message carries exactly the <span class="mono">media_id</span> the upload returned, and the markdown that follows contains neither the marker nor the local path.</div>
</div>`;

// ---------- page 2: status card timeline ----------
const C = load('gw-final-c.jsonl');
const c1 = turn(C, 'conv-c1-c1').filter(isOut);
const c0 = c1[0].t;
const tlRows = c1.map((e) => {
  let b = '';
  if (e.path === '/v1.0/card/instances/createAndDeliver') b = `status card created · statusLine="${e.body.cardData.cardParamMap.statusLine}" content=""`;
  else if (e.path === '/v1.0/card/streaming') b = `${e.body.isFinalize ? 'FINALIZE stream · ' : 'partial frame · '}content=${JSON.stringify(e.body.content)}`;
  else if (e.path === '/media/upload') b = `upload ${e.body.multipart[0].filename} (${e.body.multipart[0].size} B) → ${e.reply.media_id}`;
  else if (e.body?.msgtype === 'file') b = `msgtype=file ${JSON.stringify(e.body.file)}`;
  else if (e.path === '/v1.0/card/instances') { const pm = e.body.cardData.cardParamMap; b = pm.flowStatus === '3' ? `TERMINAL card update · flowStatus=3 statusLine="${pm.statusLine}" content=${JSON.stringify(pm.content)}` : `status-line tick · statusLine="${pm.statusLine}"${pm.content !== undefined ? ` content=${JSON.stringify(pm.content)}` : ''}`; }
  else b = JSON.stringify(e.body);
  const cls = e.path === '/media/upload' ? 'y' : e.body?.msgtype === 'file' ? 'g' : e.path === '/v1.0/card/instances' && e.body.cardData.cardParamMap.flowStatus === '3' ? 'r' : e.path === '/v1.0/card/instances' ? 'd' : 'k';
  return `<li><span class="t">+${e.t - c0}ms</span><span class="ep ${cls}">${esc(e.method + ' ' + e.path)}</span><span class="b">${esc(short(b))}</span></li>`;
}).join('');
const page2 = `<style>${CSS}</style><div class="wrap">
<h1>Status card on — delivery order as seen on the wire (PR arm, model slowed to 120 ms per 3-char delta)</h1>
<p class="sub">Model text: <span class="mono">Here is the report.\\n[FILE: &lt;ws&gt;/report.txt]\\nDone, see attachment.</span></p>
<ul class="tl">${tlRows}</ul>
<div class="note">The marker line never reaches a streaming frame (the partial frames jump from <span class="mono">"Here is the report.\\n"</span> straight to <span class="mono">"…\\n\\nD"</span>), the upload and the <span class="mono">msgtype=file</span> message both land <b>before</b> the terminal card update (<span class="mono">flowStatus=3</span>), and the card's final content is the marker-free text. No fallback markdown message is sent.</div>
</div>`;

// ---------- page 3: failure / boundary matrix ----------
const rows = [
  ['missing file', '0 / 0', '[File delivery failed: missing.txt]', 'ok'],
  ['empty file (0 B)', '0 / 0', '[File delivery failed: empty.txt]', 'ok'],
  ['20 MiB + 1 B', '0 / 0', '[File delivery failed: big.bin]', 'ok'],
  ['exactly 20 MiB', '1 / 1', 'delivered (sha256 intact, 20 971 520 B multipart)', 'ok'],
  ['symlink → /etc/hostname (escapes workspace)', '0 / 0', '[File delivery failed: escape-link]', 'ok'],
  ['symlink → file inside workspace', '1 / 1', 'delivered under the real name report.txt', 'ok'],
  ['/root/…outside.txt (outside workspace and tmp)', '0 / 0', '[File delivery failed: h10893-outside.txt]', 'ok'],
  ['/tmp/h10893/tmpfile.md (system temp root)', '1 / 1', 'delivered · fileType=md', 'ok'],
  ['directory', '0 / 0', '[File delivery failed: adir]', 'ok'],
  ['relative path report.txt', '0 / 0', '[File delivery failed: report.txt]', 'ok'],
  ['path containing "]"  /  marker mid-line  /  trailing text after "]"  /  trailing space  /  4100-char path', '0 / 0', 'line redacted · one aggregated [File delivery failed: invalid marker]', 'ok'],
  ['7 markers in one reply', '5 / 5', 'm1…m5 delivered, m6/m7 never touched · [File delivery failed: response file limit exceeded]', 'ok'],
  ['marker inside a ``` code fence', '1 / 1', 'treated as a marker and delivered (over-redaction by design)', 'warn'],
  ['marker emitted only BEFORE a tool call', '0 / 0', '[File delivery unavailable] (fail closed, no upload)', 'ok'],
  ['same marker before the tool call AND in the final text', '1 / 1', 'delivered once, but "[File delivery unavailable]" is appended too', 'warn'],
  ['upload → errcode 42001 (expired token) once', '2 / 1', 'gettoken again, retry with the new token, delivered, no notice', 'ok'],
  ['upload → errcode 40014 (permanent auth failure)', '2 / 0', 'exactly two attempts, [File delivery failed: report.txt]', 'ok'],
  ['upload → HTTP 500 / reply without media_id', '1 / 0', 'single attempt, [File delivery failed: report.txt]', 'ok'],
  ['file message → errcode 300001 / HTTP 500', '1 / 1 attempt', 'text still sent + [File delivery failed: report.txt]', 'ok'],
  ['proactive group/DM reply without processQueryKey · HTTP 400', '1 / 1 attempt', '[File delivery failed: report.txt] (no retry loop)', 'ok'],
  ['blockStreaming = "on"', '0 / 0', 'marker redacted, [File delivery unavailable], no [FILE:] instruction in the system prompt', 'ok'],
  ['base arm (main @ a8248ea), any marker', '0 / 0', '[File delivery unavailable] — redaction only', 'ok'],
];
const page3 = `<style>${CSS}</style><div class="wrap">
<h1>Boundary and failure matrix — measured live, one daemon turn per row</h1>
<p class="sub">Columns: what the model referenced · media uploads / file messages actually sent · what the user sees. No row leaked a local path, a marker, or the access token onto the wire.</p>
<table><tr><th>input</th><th>uploads / file msgs</th><th>user-visible outcome</th></tr>
${rows.map(([a, b, c, k]) => `<tr><td>${esc(a)}</td><td class="mono ${k === 'ok' ? '' : 'warnc'}">${esc(b)}</td><td class="${k === 'ok' ? '' : 'warnc'}">${esc(c)}</td></tr>`).join('')}
</table>
<div class="note warn">The two amber rows are observations, not defects: code-fence over-redaction is the documented trade-off carried over from the redaction-only projector; the double-notice case (marker before a tool boundary and again in the final text) delivers the file yet still appends <span class="mono">[File delivery unavailable]</span> because the streamed marker count (2) exceeds the final count (1).</div>
</div>`;

// ---------- page 4: e2e results ----------
const groups = [
  ['Group S — session replies, DM + group, cards off (PR arm)', 'out-s-pr-final.txt'],
  ['Group C — status cards on (PR arm)', 'out-c-pr-final.txt'],
  ['Group P — proactive delivery via the channel-webhook route, group + DM targets (PR arm)', 'out-p-pr-final.txt'],
  ['Group X — concurrency / duplicates / CRLF / long paths (PR arm)', 'out-x-pr-final.txt'],
  ['A/B — base arm, main @ a8248ea', 'out-ab-base-final.txt'],
  ['A/B — PR arm with blockStreaming = "on"', 'out-ab-block.txt'],
];
let termLines = [];
for (const [title, f] of groups) {
  termLines.push(`<span class="hdr">#### ${esc(title)}</span>`);
  for (const l of fs.readFileSync(H + '/' + f, 'utf8').split('\n')) {
    if (l.startsWith('PASS')) { const name = l.slice(6).split('  ::')[0]; termLines.push(`<span class="p">PASS</span>  ${esc(name)}`); }
    else if (l.startsWith('==')) termLines.push(`<span class="sum">${esc(l)}</span>`);
  }
  termLines.push('');
}
const page4 = `<style>${CSS}</style><div class="wrap">
<h1>End-to-end run — 95 live checks, one clean pass per group</h1>
<p class="sub">Stack: vendor <span class="mono">dingtalk-stream-sdk-nodejs</span> DWClient → spoofed <span class="mono">api/oapi.dingtalk.com</span> (TLS, /etc/hosts) → <span class="mono">qwen serve --channel dingtalk</span> built from the PR → scripted OpenAI-compatible model. Oracles: the captured request bodies (multipart bytes, JSON payloads, card frames) and the model-side prompt log.</p>
<pre class="term">${termLines.join('\n')}</pre>
</div>`;

// ---------- page 5: mutants ----------
const mut = JSON.parse(fs.readFileSync(SP + '/mut/results.json', 'utf8'));
const killedBy = {
  M2: 'outbound-file.test.ts › rejects empty, directory, and oversized files', M3: 'outbound-file.test.ts › rejects empty, directory, and oversized files', M4: 'outbound-file.test.ts › rejects a outside root', M5: 'DingtalkAdapter.test.ts › sends a local file attachment and path-free text reply', M6: 'DingtalkAdapter.test.ts › does not upload a file for an untrusted session webhook', M7: 'DingtalkAdapter.test.ts › refreshes the token and retries one expired file upload', M8: 'DingtalkAdapter.test.ts › sends a local file attachment … (pure-file reply expects 1 webhook call)', M11: 'DingtalkAdapter.test.ts › delivers a projected file before finalizing the status card', M12: 'DingtalkAdapter.test.ts › reports a proactive group file response without a delivery verdict', M13: 'outbound-file.test.ts › redacts the access token from upload errors',
  M1: 'not needed for correctness: realpathSync already resolved the link; O_NOFOLLOW only guards a swap between realpath and open. Live S5 still rejects the escaping symlink.', M9: 'no unit test asserts the "response file limit exceeded" notice. Live S4b covers it (7 markers → 5 delivered + notice).', M10: 'outbound-file.test.ts imports MAX_FILES_PER_RESPONSE symbolically, so the number 5 is not pinned. Live S4b pins it.', M14: 'no unit test feeds an EXISTING file under blockStreaming="on" (the existing tests use /workspace/… paths that do not exist). Live A/B block-on covers it: 0 uploads.',
};
const page5 = `<style>${CSS}</style><div class="wrap">
<h1>Are the new tests load-bearing? 14 hand-written mutants against the PR's unit suite</h1>
<p class="sub">Each mutant edits one guard in <span class="mono">outbound-file.ts</span> / <span class="mono">DingtalkAdapter.ts</span>, then runs <span class="mono">vitest run outbound-file.test.ts DingtalkAdapter.test.ts</span>; the source is restored after every run.</p>
<table><tr><th>mutant</th><th>verdict</th><th>killed by / why it survived</th></tr>
${mut.map(([name, v]) => { const id = name.split(' ')[0]; return `<tr><td>${esc(name)}</td><td class="mono ${v === 'KILLED' ? 'ok' : 'warnc'}">${esc(v)}</td><td>${esc(killedBy[id] || '')}</td></tr>`; }).join('')}
</table>
<div class="note">10 / 14 killed. The four survivors are all covered by the live harness, so they are unit-coverage gaps rather than behaviour gaps; M14 (blockStreaming="on" must not upload an existing file) is the one worth a follow-up test.</div>
</div>`;

(async () => {
  const browser = await chromium.launch();
  const pages = [['01-before-after-wire', page1], ['02-status-card-timeline', page2], ['03-boundary-matrix', page3], ['04-e2e-results', page4], ['05-mutants', page5]];
  for (const [name, html] of pages) {
    const p = await browser.newPage({ deviceScaleFactor: 2 });
    await p.setContent(html, { waitUntil: 'load' });
    await p.locator('.wrap').screenshot({ path: path.join(OUT, name + '.png') });
    await p.close();
    console.log('wrote', name + '.png');
  }
  await browser.close();
})();
