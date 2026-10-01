// Builds the evidence figures for the PR #13037 verification report.
// Screenshots come from ../shots (real WebShell in Chromium); tables are typed from ../rig/out/*.log.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13037/packages/web-shell/package.json');
const { chromium } = require('@playwright/test');

const R = path.dirname(new URL(import.meta.url).pathname);
const S = path.dirname(R);
const SHOTS = `${S}/shots`;
const OUT = `${S}/figs`;
fs.mkdirSync(OUT, { recursive: true });
const img = (name, style = '') => `<img src="file://${SHOTS}/${name}.png" style="${style}">`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const table = (head, rows, cls = '') =>
  `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
const ok = (t) => `<span class="ok">${t}</span>`;
const warn = (t) => `<span class="warn">${t}</span>`;
const bad = (t) => `<span class="bad">${t}</span>`;
const HEAD = 'e47fa595ee';

const cards = [];
const card = (id, title, sub, body, width = 1500) => cards.push({ id, html: `<section class="card" id="${id}" style="width:${width}px"><h1>${title}</h1><p class="sub">${sub}</p>${body}</section>` });

// ---------------------------------------------------------------- 01 before / after
card(
  '01-before-after',
  'One Hosted Shell Turn, before and after this PR',
  `The Turn ran on <b>main</b> (0a4bed5c9f) in a real stack. Left: main server + main WebShell. Right: the same database upgraded in place to the PR (${HEAD}, Flyway V25 → V26), O3 enabled, PR WebShell — the historical receipt was back-filled and projected.`,
  `<div class="two">
    <figure><figcaption>Before — main: the answer only. No tool row, no Outputs button, artifact routes 404.</figcaption><div class="crop" style="height:582px">${img('b5-base-main-pretty', 'width:931px;margin-left:-196px')}</div></figure>
    <figure><figcaption>After — PR: Shell card with status, approved preview, three separate facts, and “View output”.</figcaption><div class="crop" style="height:582px">${img('b5-pr-main-pretty', 'width:931px;margin-left:-196px')}</div></figure>
  </div>`,
  1560,
);

// ---------------------------------------------------------------- 02 live + panel
card(
  '02-live-card-and-panel',
  'Live Turn → tool card → saved output panel (real Shell, real Java, real browser)',
  'Public REST create → public Turn → packaged Hosted Harness → Runtime Broker → worker → real Shell → O2 publication → receipt → O3 projection → SSE → WebShell. Live and reloaded transcripts are text-identical.',
  `<div class="two">
    <figure><figcaption>1. While the model is still answering: the Shell row arrives over the live stream (no reload).</figcaption>${img('f-a1-live-running', 'width:100%')}</figure>
    <figure><figcaption>2. Turn completed: card expanded. Reloading the page renders the same text.</figcaption>${img('f-a2-live-card', 'width:100%')}</figure>
  </div>
  <div class="two" style="margin-top:18px">
    <figure><figcaption>3. “View output”: stdout, read by Range with If-Match at the fixed revision.</figcaption>${img('f-a4-panel-stdout', 'width:100%')}</figure>
    <figure><figcaption>4. stderr is a separate stream with its own length and SHA-256.</figcaption>${img('f-a5-panel-stderr', 'width:100%')}</figure>
  </div>`,
  1560,
);

// ---------------------------------------------------------------- 03 large output
card(
  '03-large-output-paging-download',
  'Large output: bounded paging and streaming download',
  'A 12.4 MB and a 103.5 MB text log produced by a real Shell command. Every rendered page and the saved file were compared with the bytes a local run of the same command produces.',
  `<div class="two">
    <figure><figcaption>Page 6 of a 12,425,594-byte stdout (64 KiB pages).</figcaption>${img('f-e1-paging', 'width:100%')}</figure>
    <div>
      ${table(
        ['Check (Chromium 149, real Spring server behind the Vite proxy)', 'Result'],
        [
          ['7 pages forward, 6 back: rendered text == local bytes for that range', ok('13 / 13 exact')],
          ['Requests carry Range + If-Match + the host auth headers', ok('all')],
          ['Page cache', '4 pages kept; older pages re-read (plus a 3-byte look-back)'],
          ['CJK text, 511,890 B: 8 pages joined == produced text; U+FFFD on any page', ok('equal; 0')],
          ['Download 103,546,880 B through <code>showSaveFilePicker</code> → FileSystemWritableFileStream', ok('saved 103,546,880 B, SHA-256 == metadata == local run')],
          ['Blob / object URL created by page code during the download', ok('0 / 0')],
          ['JS heap during the download (19 samples over 4.8 s)', '43.4 – 116.4 MiB'],
          ['Download request', '200, no Range, If-Match, auth headers, no credential in the URL'],
          ['Close the panel 0.4 s into a second download', ok('request aborted; server audit: 10,551,296 of 103,546,880 B, then stopped')],
          ['WebKit / Chromium without the picker', 'pages readable; “needs a host integration” instead of Download'],
          ['Four read slots busy (another user’s downloads)', warn('429, one retry after 1 s, 429 → “reader limit has been reached”')],
        ],
      )}
      <p class="note">Only the native save dialog was replaced (by an OPFS file handle) because headless automation cannot click it; fetch, stream, <code>pipeTo</code> and the writable are the browser’s own.</p>
      <p class="note">Reaching the end of the 12 MB log takes 190 “Next page” clicks; there is no jump to an offset or to the last page.</p>
    </div>
  </div>`,
  1560,
);

// ---------------------------------------------------------------- 04 states
card(
  '04-result-states',
  'Execution, capture and delivery stay separate facts',
  'Each card is a real Turn. “Not executed”: core refused a leading <code>sleep 5</code>. “Capture unavailable”: 3.2 MB of output against a 1 MiB capture budget.',
  `<div class="two">
    <figure><figcaption>Command not executed · No capture · Output delivery blocked (no download offered).</figcaption><div class="crop" style="height:420px">${img('f-b1-not-executed', 'width:100%')}</div></figure>
    <figure><figcaption>Command succeeded · Capture unavailable · Output delivery blocked. The public Turn stays “running” (main behaviour, see notes).</figcaption><div class="crop" style="height:420px">${img('f-c1-capture-blocked', 'width:100%')}</div></figure>
  </div>
  ${table(
    ['Real Shell command', 'execution', 'capture', 'delivery', 'artifacts (stdout / stderr bytes)', 'bytes via public API == local run'],
    [
      ['<code>echo …; echo … &gt;&amp;2</code>', 'success', 'complete', 'committed', '9 / 8', ok('yes')],
      ['<code>…; exit 3</code>', 'error', 'complete', 'committed', '9 / 9', ok('yes')],
      ['<code>true</code>', 'success', 'complete', 'committed', '0 / 0 (200, Content-Length 0)', ok('yes')],
      ['<code>sleep 3; …</code> (refused before start)', 'not_started', 'null', 'blocked', 'none', '—'],
      ['3 MiB with a 1 MiB capture budget', 'success', 'unavailable (quota_exhausted)', 'blocked', 'none', '—'],
      ['200 kB binary + 4 kB stderr', 'success', 'complete', 'committed', '200,000 / 4,096', ok('yes')],
      ['ANSI colours, CR progress, CRLF', 'success', 'complete', 'committed', '93 / 0', ok('yes')],
      ['40 MiB + 1 MiB, exit 7 (41 segments)', 'error', 'complete', 'committed', '41,943,040 / 1,048,576', ok('yes')],
      ['two sequential calls in one Turn', 'success ×2', 'complete', 'committed', '11/0 and 12/11 — two results, two items', ok('sha == metadata')],
      ['two calls in one model response', 'success ×2', 'complete', 'committed', '6/0 and 6/0', ok('sha == metadata')],
      ['512 kB of CJK text', 'success', 'complete', 'committed', '511,890 / 0', ok('yes')],
    ],
  )}`,
  1560,
);

// ---------------------------------------------------------------- 05 http + access
card(
  '05-http-and-access',
  'Byte reads and authorization on the running server (MySQL 8.4.7)',
  '37 / 37 HTTP cases as the PR describes; bytes compared with a local run of the same command (40 MiB stdout, 1 MiB segments).',
  `<div class="two">
  ${table(
    ['Request on a 41,943,040-byte stdout', 'Response'],
    [
      ['no Range', '200, exact, ETag = "sha256", Repr-Digest, nosniff, attachment, no-store'],
      ['<code>bytes=1048570-1048585</code> (segment 0/1 boundary)', '206, 16 B exact'],
      ['1 MiB spanning three segments, first/last byte, <code>-10</code>, open-ended near EOF, end past EOF', '206, exact'],
      ['start at EOF, <code>bytes=-0</code>', '416 + <code>Content-Range: bytes */41943040</code>'],
      ['1 MiB + 1, <code>bytes=0-</code>', '400 range_too_large'],
      ['<code>bytes=0-1,5-6</code>', '400 unsupported_range'],
      ['6 malformed forms', '400 invalid_range'],
      ['no revision / unknown revision', '400 revision_required / 404'],
      ['If-Match wrong, weak, right, <code>*</code>', '412, 412, 206, 206'],
      ['If-Range match / mismatch', '206 / 200 full representation, exact'],
      ['empty stderr: full / any range', '200 with 0 B / 416 <code>bytes */0</code>'],
    ],
  )}
  ${table(
    ['Caller / state', 'metadata', 'content', 'malformed Range'],
    [
      ['alice (Workspace read grant)', '200', '206', '400 invalid_range'],
      ['tenant header only, no actor', '401 actor_required', '401', '401'],
      ['bob (no grant) / other tenant', '404', '404', '404'],
      ['grant set to can_read = false / row deleted', '404', '404', '404'],
      ['artifact id under another readable Session', '404', '404', '—'],
      ['publish-original switched off (restart)', '200, can_read_content = false', '403 artifact_content_forbidden', '403'],
      ['publication quarantined', '200, unavailable', '503', '503'],
      ['Session CLOSED / ARCHIVED (set in SQL)', '200', '206 exact', '400'],
      ['Session DELETING', 'capability false, 404', '404', '404'],
      ['Session DELETED', '404', '404', '404'],
      ['O3 disabled again (restart)', 'capability false, 404', '404', '404'],
    ],
  )}
  </div>
  <p class="note">Refusals come before anything about length or revision is disclosed. “Close” on a Workspace Session answers 409 on main, so CLOSED/ARCHIVED/DELETING were set in SQL.</p>`,
  1560,
);

// ---------------------------------------------------------------- 06 faults / lifecycle / upgrade
card(
  '06-faults-upgrade-real-oss',
  'Failure boundaries and the in-place upgrade',
  `All on ${HEAD}. The OSS double speaks TLS to the real aliyun-sdk-oss client. The real-bucket leg was not repeated this round: nothing on the storage path changed since db01133aec.`,
  `<div class="two">
  ${table(
    ['Scenario', 'Observed'],
    [
      ['Harness SIGKILLed, writer lease expired', ok('results + 9 B / 40 MiB / 99 MiB read exact; no Harness request for the Sessions read (only Spring’s 60 s recovery <code>load</code> of two other Sessions), 0 model calls, 0 worker launches; journal revision unchanged')],
      ['Grant revoked 4 MiB into a full download', ok('stops after at most 0.94 MiB more, within 8 ms; received bytes are an exact prefix; no JSON appended')],
      ['One bit flipped in segment 5 of 8, then a full download', ok('exactly 5 MiB delivered, corrupt segment never sent; publication quarantined; execution facts unchanged')],
      ['Object GETs return 500 during projection', ok('RETRYABLE with back-off, READY after recovery; 1 event, 2 artifacts')],
      ['Object GET stalls 25 s inside the projector', ok('another Session’s Turn: assistant Item visible after 0.6 s') + '; other results wait behind it'],
      ['Server SIGKILLed while a claimed projection waits on the store', ok('restart; reclaimed when the 60 s lease expired; 1 event, 2 artifacts, bytes exact')],
      ['Five parallel full downloads', '200 ×4, fifth 429 + Retry-After: 1'],
      ['1 GiB with <code>-Xmx256m</code> (read budget raised)', ok('single and 4 parallel: exact; peak RSS 396 / 472 MiB; no OutOfMemoryError')],
    ],
  )}
  <div>
  ${table(
    ['Upgrade in place: main → PR', 'Observed'],
    [
      ['Flyway', 'V25 → V26 on the populated schema'],
      ['PR jar, default configuration (O3 off)', ok('file Turn (write_file) and Shell Turns work; capability false; routes 404; Shell receipts recorded as PENDING')],
      ['Enable O3 (restart)', ok('3 pending results READY at once; 4 main-era results back-filled; one event each')],
      ['Back-fill pace', ok('74 journal revisions of 5 legacy Sessions within the first tick')],
    ],
  )}
  </div></div>`,
  1560,
);


card(
  '07-f2-abort-recheck',
  'F2 is fixed at the server; the WebShell dev proxy still hides the abort',
  `Measured on ${HEAD}. The server now closes full (200) downloads it stops after the headers. The Vite dev server behind the documented <code>npm run dev:managed-agent-web</code> (this PR adds its <code>/v1/agents</code> proxy, which carries the downloads) does not pass the upstream close on.`,
  `${table(
    ['After the server stops a download mid-way', 'Client', 'Time from the last byte to the end', 'db01133aec'],
    [
      ['Grant revoked 8 MiB into 99 MiB', 'Node, direct to Spring', ok('2 ms'), '60.4 s'],
      ['One bit flipped in segment 5 of 8', 'Node, direct to Spring', ok('0 ms (5 MiB delivered)'), '—'],
      ['2 MiB/s client hits the 2-minute budget', 'curl, direct to Spring', ok('ends at 120.8 s'), '180.1 s'],
      ['Intact full download / intact 64 KiB range', 'Node, direct to Spring', ok('complete; Connection: close / keep-alive'), '—'],
      ['Grant revoked 8 MiB into 99 MiB', 'Node, through the WebShell Vite dev proxy', bad('300.5 s (the client’s own body timeout)'), '—'],
      ['Same, Vite proxy with the 9-line candidate', 'Node', ok('1 ms'), '—'],
      ['Grant revoked while the panel downloads 99 MiB', 'Chromium, WebShell through the Vite proxy', bad('still “Downloading…” when the probe stopped at 120 s; no error shown'), '—'],
      ['Same, Vite proxy with the candidate', 'Chromium, WebShell', ok('“network error” after 35 ms'), '—'],
    ],
  )}
  <div class="two">
    <figure><figcaption>PR Vite config: 120 s after the revocation the panel still says “Downloading…”.</figcaption>${img('b8-abort-ui-pr-proxy', 'width:100%')}</figure>
    <figure><figcaption>Vite config with the candidate: the download ends with an error at once.</figcaption>${img('b8-abort-ui-candidate-proxy', 'width:100%')}</figure>
  </div>
  <p class="note">F3 is fixed too: with the JVM in Asia/Shanghai and MySQL in UTC, the artifact <code>created_at</code> now matches the event that carries it (0 h; −8 h on db01133aec).</p>`,
  1560,
);
// ---------------------------------------------------------------- 07 read cost
card(
  '08-download-cost',
  'F1 (deferred) — a full download still costs 327 SELECTs per MiB',
  `Measured on ${HEAD}. Statement counts come from MySQL’s <code>Com_select</code> counter (background rate subtracted) and do not depend on host load; timings do (load average 5–26 on a 10-core machine this round).`,
  `${table(
    ['Full download through <code>/artifacts/{id}/content</code>', `PR ${HEAD}`, 'candidate patch (+7 / −5)'],
    [
      ['SELECTs for 103,546,880 B', bad('32,329') + ' = 20.5 per 64 KiB chunk = 327 per MiB', ok('684 – 710') + ' = 7 per MiB'],
      ['Local MySQL, 99 MiB (back-to-back, load 5 – 7)', '4.7 s', ok('1.5 s')],
      ['Local MySQL, 1 GiB (two back-to-back pairs)', '40.6 – 41.8 s', ok('8.2 s')],
      ['Database +1.45 ms per statement (TCP relay), 99 MiB, two alternating pairs', bad('72.5 / 73.8 s'), ok('2.4 / 2.4 s')],
      ['Database +1.45 ms per statement, 1 GiB', bad('cut by the 2-minute budget at 165,675,008 B; HTTP 200, curl exit 18'), ok('complete and exact in 18.5 s')],
            ['2 MiB/s client, 1 GiB, default budget', bad('cut at 253,231,104 B after 120.8 s'), '—'],
      ['Bytes still delivered after a mid-stream revocation', '0.80 – 0.94 MiB', '0.95 – 2.0 MiB (one 1 MiB chunk plus what is in flight)'],
      ['The PR’s 96 focused Java tests', 'pass', ok('pass, unchanged')],
    ],
  )}
  <div class="two" style="margin-top:14px">
    <div class="box"><b>Where the statements come from.</b> R2-3 took the catalog lookup out of the chunk guard (441 → 327 per MiB), but for every 64 KiB the server still runs the guard three times (copy loop in <code>ManagedArtifactService.content</code>, twice in <code>VerifiedStream.read</code>) and once more for every 64 KiB it reads from the object store into its private buffer (<code>copyVerified</code> heartbeat). Each guard is Session + Workspace grant (+ the reader’s catalog check). Nothing is delivered between these checks, so three of the four add no freshness.</div>
    <div class="box"><b>What the candidate does.</b> One fresh guard before a segment is fetched and one immediately before its bytes are released, with 1 MiB release chunks (the public Range cap is already 1 MiB); no time-based throttle. The <code>Connection: close</code> part of the earlier candidate is now in the PR.</div>
  </div>
  <p class="note">There is no resume: a Range may not exceed 1 MiB and the WebShell download is one full stream, so whatever does not fit in the 2-minute budget cannot be downloaded at all. While four such downloads run, every other Session’s page read in the same server process answers 429.</p>`,
  1560,
);

// ---------------------------------------------------------------- 08 ansi
card(
  '09-ansi-and-cr',
  'Coloured output: the paged view shows escape sequences as text',
  'A test run printing SGR colours, carriage-return progress and one CRLF line. R2-7 widened the server-side preview sanitizer; the paged bytes in the panel still show <code>\\u001b[32m</code> and <code>\\r</code> literally (item 2 of @yiliang114’s review).',
  `<div class="two">
    <figure><figcaption>Tool card (approved preview)</figcaption>${img('f-d1-ansi-card', 'width:100%')}</figure>
    <figure><figcaption>Output panel (paged bytes)</figcaption>${img('f-d2-ansi-panel', 'width:100%')}</figure>
  </div>`,
  1560,
);

const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
  .card{padding:28px 30px 30px;background:#0d1117;box-sizing:border-box}
  h1{font-size:25px;margin:0 0 8px;font-weight:650}
  .sub{color:#9da7b3;font-size:15.5px;margin:0 0 18px;line-height:1.45}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
  figure{margin:0;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #30363d}
  figcaption{background:#161b22;color:#c9d1d9;font-size:14px;padding:9px 12px;line-height:1.4;border-bottom:1px solid #30363d}
  figure img{display:block}
  .crop{overflow:hidden}
  table{border-collapse:collapse;width:100%;font-size:14px;margin:0 0 14px}
  th{text-align:left;background:#161b22;color:#9da7b3;font-weight:600;padding:8px 10px;border:1px solid #30363d}
  td{padding:7px 10px;border:1px solid #30363d;vertical-align:top;line-height:1.4}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#161b22;padding:1px 4px;border-radius:4px}
  .ok{color:#3fb950}.warn{color:#d29922}.bad{color:#ff7b72}
  .note{color:#9da7b3;font-size:13.5px;margin:6px 0 0;line-height:1.45}
  .box{border:1px solid #30363d;border-left:3px solid #58a6ff;border-radius:6px;padding:10px 12px;font-size:14px;line-height:1.5;background:#11161d}
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${cards.map((c) => c.html).join('\n')}</body></html>`;
fs.writeFileSync(`${OUT}/cards.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
await page.goto(`file://${OUT}/cards.html`, { waitUntil: 'load' });
await page.waitForTimeout(800);
for (const c of cards) {
  const el = page.locator(`[id="${c.id}"]`);
  await el.screenshot({ path: `${OUT}/${c.id}.png` });
  const clipped = await el.evaluate((n) => [...n.querySelectorAll('td,th,figcaption')].filter((x) => x.scrollWidth > x.clientWidth + 1).length);
  const broken = await el.evaluate((n) => [...n.querySelectorAll('img')].filter((i) => !i.complete || i.naturalWidth === 0).length);
  console.log(c.id, `${(fs.statSync(`${OUT}/${c.id}.png`).size / 1024).toFixed(0)} KiB`, `clipped cells=${clipped}`, `broken images=${broken}`);
}
await browser.close();
