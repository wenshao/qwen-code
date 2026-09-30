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
const HEAD = '80a860ae2a';

const cards = [];
const card = (id, title, sub, body, width = 1500) => cards.push({ id, html: `<section class="card" id="${id}" style="width:${width}px"><h1>${title}</h1><p class="sub">${sub}</p>${body}</section>` });

// ---------------------------------------------------------------- 01 before / after
card(
  '01-before-after',
  'One Hosted Shell Turn, before and after this PR',
  `The Turn ran on <b>main</b> (3a8fd11711) in a real stack. Left: main server + main WebShell. Right: the same database upgraded in place to the PR (${HEAD}, Flyway V23 → V24), O3 enabled, PR WebShell — the historical receipt was back-filled and projected.`,
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
          ['JS heap during the download (65 samples)', '42.9 – 81.5 MiB'],
          ['Download request', '200, no Range, If-Match, auth headers, no credential in the URL'],
          ['Close the panel 0.4 s into a second download', ok('request aborted; server audit: 2,162,688 of 103,546,880 B, then stopped')],
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
  'Failure boundaries, upgrade, and a real Aliyun OSS bucket',
  `All on ${HEAD}. The OSS double speaks TLS to the real aliyun-sdk-oss client; the last block uses a real private bucket (created for this run, deleted afterwards).`,
  `<div class="two">
  ${table(
    ['Scenario', 'Observed'],
    [
      ['Harness and all workers SIGKILLed, writer lease expired', ok('results + 9 B / 40 MiB / 99 MiB read exact; 0 Harness requests for these Sessions, 0 model calls, 0 worker launches; journal revision unchanged')],
      ['Grant revoked 4 MiB into a full download', ok('stops after about 0.5 MiB more; received bytes are an exact prefix; no JSON appended')],
      ['One bit flipped in segment 5 of 8, then a full download', ok('exactly 5 MiB delivered, corrupt segment never sent; publication quarantined; execution facts unchanged')],
      ['Object GETs return 500 during projection', ok('RETRYABLE with back-off, READY after recovery; 1 event, 2 artifacts')],
      ['Object GET stalls 25 s inside the projector', ok('another Session’s Turn: assistant Item visible after 0.6 s') + ' (25.1 s on the previous head ea8639a0); other results wait behind it'],
      ['Server SIGKILLed while a claimed projection waits on the store', ok('restart; reclaimed when the 60 s lease expired; 1 event, 2 artifacts, bytes exact')],
      ['Five parallel full downloads', '200 ×4, fifth 429 + Retry-After: 1'],
      ['1 GiB with <code>-Xmx256m</code> (read budget raised)', ok('single and 4 parallel: exact; peak RSS 348 / 447 MiB; no OutOfMemoryError')],
    ],
  )}
  <div>
  ${table(
    ['Upgrade in place: main → PR', 'Observed'],
    [
      ['Flyway', 'V23 → V24 on the populated schema, 0.07 s'],
      ['PR jar, default configuration (O3 off)', ok('file Turn (write_file) and Shell Turns work; capability false; routes 404; Shell receipts recorded as PENDING')],
      ['Enable O3 (restart)', ok('3 pending results READY at once; 4 main-era results back-filled; one event each')],
      ['Back-fill pace', warn('79 journal revisions of 5 legacy Sessions in 79 s — one revision per second')],
    ],
  )}
  ${table(
    ['Real private OSS bucket (cn-hangzhou)', 'Observed'],
    [
      ['Publish 13 B / 8.4 MB / 103.5 MB, project', ok('READY; receipt → public event 0.3 / 1.2 / 0.9 s; metadata SHA-256 == local run')],
      ['Anonymous GET of a stored segment', '403'],
      ['64 KiB page reads', '219 – 307 ms'],
      ['Full download 103.5 MB through Java', ok('exact') + ', 23.0 – 25.5 s (4.1 – 4.5 MB/s)'],
      ['One bit flipped in the bucket', ok('stream stops after 4 verified MiB; quarantined; unavailable')],
      ['Bucket afterwards', '115 object versions and the bucket deleted; NoSuchBucket'],
    ],
  )}
  </div></div>`,
  1560,
);

// ---------------------------------------------------------------- 07 read cost
card(
  '07-download-cost-and-abort',
  'F1 / F2 — a full download costs 441 SELECTs per MiB, and an aborted stream hangs for 60 s',
  `Measured on ${HEAD}. Statement counts come from MySQL’s <code>Com_select</code> counter (background rate subtracted) and do not depend on host load; timings do (load average 45–95 on a 10-core machine).`,
  `${table(
    ['Full download through <code>/artifacts/{id}/content</code>', `PR ${HEAD}`, 'candidate patch (+11 / −5)'],
    [
      ['SELECTs for 103,546,880 B', bad('43,590') + ' = 27.6 per 64 KiB chunk = 441 per MiB', ok('911') + ' = 9 per MiB'],
      ['Local MySQL, 99 MiB (back-to-back pairs, load ≈ 20)', '5.3 – 6.1 s', ok('1.3 – 1.5 s')],
      ['Local MySQL, 1 GiB (same pairs)', '47.0 – 47.9 s &nbsp;(104.6 s at load 75 with a 256 MiB heap)', ok('6.6 – 7.6 s')],
      ['Database +1.75 ms per statement (TCP relay), 99 MiB', bad('85.3 s'), ok('3.0 s')],
      ['Database +1.75 ms per statement, 1 GiB', bad('cut by the 2-minute budget at 157,941,760 B; HTTP 200, curl exit 18'), ok('complete and exact in 22.9 s')],
      ['Real OSS bucket, 99 MiB (local MySQL)', '24.8 / 25.5 s', '7.5 / 8.7 s'],
      ['2 MiB/s client, 1 GiB, default budget', bad('cut at 254,607,360 B after 120 s'), '—'],
      ['After the server stops a stream (revocation / corruption / budget): time until the client sees the end', bad('60.2 – 60.8 s of silence'), ok('2 – 17 ms')],
      ['Bytes still delivered after a mid-stream revocation', '0.45 – 0.56 MiB', '1.0 – 3.1 MiB (one 1 MiB chunk plus what is in flight)'],
      ['The PR’s 72 focused Java tests', 'pass', ok('pass, unchanged')],
    ],
  )}
  <div class="two" style="margin-top:14px">
    <div class="box"><b>Where the statements come from.</b> For every 64 KiB the server runs the full authorization guard three times (copy loop in <code>ManagedArtifactService.content</code>, twice in <code>VerifiedStream.read</code>) and once more for every 64 KiB it reads from the object store into its private buffer (<code>copyVerified</code> heartbeat). Each guard is Session + Workspace grant + publication catalog. Nothing is delivered between these checks, so three of the four add no freshness.</div>
    <div class="box"><b>What the candidate does.</b> One fresh guard before a segment is fetched and one immediately before its bytes are released, with 1 MiB release chunks (the public Range cap is already 1 MiB); no time-based throttle. Plus <code>Connection: close</code> on full downloads, so a stream that is stopped after the headers ends at once instead of idling until the 60 s keep-alive timeout.</div>
  </div>
  <p class="note">There is no resume: a Range may not exceed 1 MiB and the WebShell download is one full stream, so whatever does not fit in the 2-minute budget cannot be downloaded at all. While four such downloads run, every other Session’s page read in the same server process answers 429.</p>`,
  1560,
);

// ---------------------------------------------------------------- 08 ansi
card(
  '08-ansi-and-cr',
  'Coloured output: the paged view shows escape sequences as text',
  'A test run printing SGR colours, carriage-return progress and one CRLF line. The approved preview strips the colours (and joins the progress frames); the paged bytes show <code>\\u001b[32m</code> and <code>\\r</code> literally. Raised earlier by @yiliang114 for the first head; unchanged here.',
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
