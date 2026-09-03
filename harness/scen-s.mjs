// Group S — session replies (PR arm, cards off, blockStreaming off)
import * as L from './lib.mjs';
import fs from 'node:fs';
const ws = process.argv[2];
const arm = process.argv[3] || 'pr';
const say = (text, extra = '') => `SAYB64:${L.b64(text)} ${extra}`.trim();
const noPath = (s) => !s.includes(ws) && !s.includes('[FILE:');
const basenames = (names, s) => names.every((n) => s.includes(`[File delivery failed: ${n}]`));
let conv = 0;
async function run(label, text, { isGroup = false, extra = 'CHUNK:4', quiet = 2500 } = {}) {
  const id = `conv-s${++conv}-${label}`;
  const t0 = await L.turn({ conversationId: id, directive: say(text, extra), isGroup });
  const e = await L.settle({ after: t0, quiet });
  const after = (xs) => xs.filter((x) => x.t > t0);
  return { t0, e, up: after(L.uploads(e)), files: after(L.fileSends(e)), md: after(L.mdSends(e)), tok: after(L.tokens(e)), out: L.outText(e, t0) };
}

// ---------- S1 text + file (DM) ----------
{
  const r = await run('s1', `Here is the report.\n[FILE: ${ws}/report.txt]\nDone.`);
  const part = r.up[0]?.body?.multipart?.[0];
  L.check('S1 exactly one media upload, type=file', r.up.length === 1 && r.up[0].query.type === 'file', JSON.stringify(r.up[0]?.query));
  L.check('S1 uploaded bytes are the fixture (sha256 + size match)', part?.sha256 === L.sha256File(`${ws}/report.txt`) && part?.size === fs.statSync(`${ws}/report.txt`).size, `${part?.size}B ${part?.sha256?.slice(0, 12)}`);
  L.check('S1 upload uses the current access token', r.up[0]?.query?.access_token?.startsWith('HARNESS_AT_'));
  L.check('S1 one msgtype=file webhook message carrying the returned mediaId', r.files.length === 1 && r.files[0].body.file.mediaId === r.up[0].reply.media_id, JSON.stringify(r.files[0]?.body));
  L.check('S1 fileName/fileType = report.txt / txt', r.files[0]?.body.file.fileName === 'report.txt' && r.files[0]?.body.file.fileType === 'txt');
  L.check('S1 file message precedes the markdown text', r.md.length === 1 && r.files[0].t <= r.md[0].t, `file@${r.files[0]?.t} md@${r.md[0]?.t}`);
  L.check('S1 markdown keeps the surrounding text, drops the marker line', r.md[0]?.body.markdown.text === 'Here is the report.\n\nDone.', JSON.stringify(r.md[0]?.body.markdown.text));
  L.check('S1 no marker / no local path anywhere on the wire', noPath(r.out));
  L.check('S1 no success claim / no failure notice', !r.out.includes('File delivery'));
}
// ---------- S2 pure file (DM) ----------
{
  const r = await run('s2', `[FILE: ${ws}/blob.bin]`);
  L.check('S2 pure-file reply: one upload, one file message, ZERO markdown messages', r.up.length === 1 && r.files.length === 1 && r.md.length === 0, `up=${r.up.length} files=${r.files.length} md=${r.md.length}`);
  L.check('S2 binary bytes intact (3000B sha256 match)', r.up[0]?.body?.multipart?.[0]?.sha256 === L.sha256File(`${ws}/blob.bin`) && r.up[0]?.body?.multipart?.[0]?.size === 3000);
  L.check('S2 fileType=bin', r.files[0]?.body.file.fileType === 'bin');
}
// ---------- S3 group session reply ----------
{
  const r = await run('s3', `Group report\n[FILE: ${ws}/report.pdf]`, { isGroup: true });
  L.check('S3 group session: file message via sessionWebhook, then markdown', r.files.length === 1 && r.md.length === 1 && r.files[0].t <= r.md[0].t, `files=${r.files.length} md=${r.md.length}`);
  L.check('S3 group markdown keeps the text, no path', r.md[0]?.body.markdown.text.includes('Group report') && noPath(r.out), JSON.stringify(r.md[0]?.body.markdown.text));
  L.check('S3 fileType=pdf', r.files[0]?.body.file.fileType === 'pdf');
}
// ---------- S4 five files, then seven ----------
{
  const five = [1, 2, 3, 4, 5].map((i) => `[FILE: ${ws}/m${i}.txt]`).join('\n');
  const r = await run('s4a', `Five files:\n${five}`);
  L.check('S4a five markers -> five uploads + five file messages, in order', r.up.length === 5 && r.files.length === 5 && r.files.map((f) => f.body.file.fileName).join() === 'm1.txt,m2.txt,m3.txt,m4.txt,m5.txt', r.files.map((f) => f.body.file.fileName).join());
  L.check('S4a markdown has no notice', r.md.length === 1 && !r.out.includes('File delivery'), JSON.stringify(r.md[0]?.body.markdown.text));
  const seven = [1, 2, 3, 4, 5, 6, 7].map((i) => `[FILE: ${ws}/m${i}.txt]`).join('\n');
  const r2 = await run('s4b', `Seven files:\n${seven}`);
  L.check('S4b seven markers -> only five uploaded/delivered (m6/m7 never touched)', r2.up.length === 5 && r2.files.length === 5 && !r2.out.includes('m6.txt') && !r2.out.includes('m7.txt'), `up=${r2.up.length} files=${r2.files.length}`);
  L.check('S4b limit notice appended, path-free', r2.md[0]?.body.markdown.text.includes('[File delivery failed: response file limit exceeded]') && noPath(r2.out), JSON.stringify(r2.md[0]?.body.markdown.text));
}
// ---------- S5 invalid files: missing, empty, oversized, symlink escape, outside root ----------
{
  const bad = [`${ws}/missing.txt`, `${ws}/empty.txt`, `${ws}/big.bin`, `${ws}/escape-link`, `/root/h10893-outside.txt`];
  const r = await run('s5', `Bad ones:\n${bad.map((p) => `[FILE: ${p}]`).join('\n')}\nend`);
  L.check('S5 zero uploads, zero file messages for the five invalid files', r.up.length === 0 && r.files.length === 0, `up=${r.up.length} files=${r.files.length}`);
  L.check('S5 one notice per file, basename only', basenames(['missing.txt', 'empty.txt', 'big.bin', 'escape-link', 'h10893-outside.txt'], r.md[0]?.body.markdown.text ?? ''), JSON.stringify(r.md[0]?.body.markdown.text));
  L.check('S5 no path / marker / secret content leaked', noPath(r.out) && !r.out.includes('outside secret') && !r.out.includes('/root/'));
  L.check('S5 escape-link target content never uploaded', !r.out.includes(fs.readFileSync('/etc/hostname', 'utf8').trim()));
}
// ---------- S6 directory, relative path, bracket path, 20 MiB boundary, inside symlink ----------
{
  const r = await run('s6', `Edge:\n[FILE: ${ws}/adir]\n[FILE: report.txt]\n[FILE: ${ws}/brk].txt]\n[FILE: ${ws}/exact.bin]\n[FILE: ${ws}/inside-link]\nend`, { quiet: 4000 });
  const names = r.files.map((f) => f.body.file.fileName);
  L.check('S6 directory + relative path rejected with basename notices', basenames(['adir', 'report.txt'], r.md[0]?.body.markdown.text ?? ''), JSON.stringify(r.md[0]?.body.markdown.text));
  L.check('S6 path containing "]" -> invalid-marker notice, never uploaded', r.md[0]?.body.markdown.text.includes('[File delivery failed: invalid marker]') && !r.out.includes('brk'));
  L.check('S6 exactly 20 MiB is accepted and uploaded intact', r.up.some((u) => u.body.multipart[0].size === 20 * 1024 * 1024 && u.body.multipart[0].sha256 === L.sha256File(`${ws}/exact.bin`)), r.up.map((u) => u.body.multipart[0].size).join());
  L.check('S6 symlink INSIDE the workspace is delivered under its real name', names.includes('report.txt'), names.join());
  L.check('S6 no path leaked', noPath(r.out));
}
// ---------- S7 tmp root, nested dir, odd names ----------
{
  const r = await run('s7', `[FILE: /tmp/h10893/tmpfile.md]\n[FILE: ${ws}/sub/nested.md]\n[FILE: ${ws}/with space.txt]\n[FILE: ${ws}/noext]\n[FILE: ${ws}/archive.tar.gz]`);
  const got = r.files.map((f) => `${f.body.file.fileName}:${f.body.file.fileType}`);
  L.check('S7 /tmp file, nested file, space, no-ext, .tar.gz all delivered', r.up.length === 5 && got.join() === 'tmpfile.md:md,nested.md:md,with space.txt:txt,noext:file,archive.tar.gz:gz', got.join());
  L.check('S7 pure-file multi reply sends no markdown', r.md.length === 0);
}
// ---------- S8 marker placement: mid-line, trailing text, inside code fence ----------
{
  const r = await run('s8', `see [FILE: ${ws}/report.txt] here\n[FILE: ${ws}/report.txt] trailing\n\`\`\`\n[FILE: ${ws}/report.txt]\n\`\`\`\nend`);
  L.check('S8 mid-line and trailing-text markers are invalid (no upload), rest of those lines redacted', r.md[0]?.body.markdown.text.includes('[File delivery failed: invalid marker]'), JSON.stringify(r.md[0]?.body.markdown.text));
  L.check('S8 marker inside a code fence IS treated as a marker (over-redaction by design): delivered', r.up.length === 1 && r.files.length === 1, `up=${r.up.length}`);
  L.check('S8 no path leaked', noPath(r.out));
}
// ---------- S9 streaming split (1 code point per SSE delta) and no split ----------
{
  const r = await run('s9a', `A\n[FILE: ${ws}/report.txt]\nB`, { extra: 'CHUNK:1' });
  L.check('S9a marker split into 1-char SSE deltas still delivered exactly once', r.up.length === 1 && r.files.length === 1 && r.md[0]?.body.markdown.text === 'A\n\nB', JSON.stringify(r.md[0]?.body.markdown.text));
  const r2 = await run('s9b', `A\n[FILE: ${ws}/report.txt]\nB`, { extra: 'NOSTREAMSPLIT' });
  L.check('S9b single-delta answer delivered exactly once', r2.up.length === 1 && r2.files.length === 1 && r2.md[0]?.body.markdown.text === 'A\n\nB');
}
// ---------- S10 tool boundary: marker emitted BEFORE a tool call ----------
{
  const pre = `Sending now\n[FILE: ${ws}/report.txt]\n`;
  const r = await run('s10a', `Tool finished.`, { extra: `TOOL PREB64:${L.b64(pre)} CHUNK:4`, quiet: 4000 });
  L.check('S10a marker seen only before the tool boundary: NOT delivered (fail closed), unavailable notice appended', r.up.length === 0 && r.files.length === 0 && r.out.includes('[File delivery unavailable]'), `up=${r.up.length} out=${r.md.map((m) => m.body.markdown.text).join(' | ')}`);
  L.check('S10a no path leaked', noPath(r.out));
  const r2 = await run('s10b', `Tool finished.\n[FILE: ${ws}/report.txt]`, { extra: `TOOL PREB64:${L.b64(pre)} CHUNK:4`, quiet: 4000 });
  L.check('S10b marker before the tool call AND in the final text: final one delivered once', r2.up.length === 1 && r2.files.length === 1, `up=${r2.up.length} files=${r2.files.length}`);
  L.check('S10b OBSERVATION: "[File delivery unavailable]" is ALSO appended although that file was delivered (streamed=2 > final=1)', r2.out.includes('[File delivery unavailable]'), JSON.stringify(r2.md.map((m) => m.body.markdown.text)));
}
// ---------- S11 token refresh + permanent auth failure + 500 + missing media id ----------
{
  await L.setMode('upload-expired-once');
  const r = await run('s11a', `[FILE: ${ws}/report.txt]`);
  const toks = r.up.map((u) => u.query.access_token);
  L.check('S11a expired token: second upload retried with a FRESH token and delivered', r.up.length === 2 && toks[0] !== toks[1] && r.files.length === 1, `tokens=${toks.join(',')} gettoken=${r.tok.length}`);
  L.check('S11a exactly one extra gettoken for the retry', r.tok.length === 1, `gettoken calls=${r.tok.length}`);
  L.check('S11a no failure notice after a successful retry', !r.out.includes('File delivery failed'));
  await L.setMode('upload-auth-fail');
  const r2 = await run('s11b', `[FILE: ${ws}/report.txt]`);
  L.check('S11b permanent auth failure: exactly 2 upload attempts (no loop), no file message, notice', r2.up.length === 2 && r2.files.length === 0 && r2.md[0]?.body.markdown.text === '[File delivery failed: report.txt]', `up=${r2.up.length} md=${JSON.stringify(r2.md.map((m) => m.body.markdown.text))}`);
  await L.setMode('upload-500');
  const r3 = await run('s11c', `text\n[FILE: ${ws}/report.txt]`);
  L.check('S11c HTTP 500 on upload: single attempt, notice appended to the text', r3.up.length === 1 && r3.files.length === 0 && r3.md[0]?.body.markdown.text === 'text\n[File delivery failed: report.txt]', JSON.stringify(r3.md[0]?.body.markdown.text));
  await L.setMode('upload-nomedia');
  const r4 = await run('s11d', `[FILE: ${ws}/report.txt]`);
  L.check('S11d upload reply without media_id: notice, no file message', r4.up.length === 1 && r4.files.length === 0 && r4.md[0]?.body.markdown.text === '[File delivery failed: report.txt]');
  await L.setMode('');
}
// ---------- S12 delivery failure after a good upload ----------
{
  await L.setMode('webhook-file-fail');
  const r = await run('s12a', `Report attached.\n[FILE: ${ws}/report.txt]`);
  L.check('S12a webhook errcode!=0 on the file message: failure notice, text still delivered', r.up.length === 1 && r.files.length === 1 && r.md[0]?.body.markdown.text === 'Report attached.\n[File delivery failed: report.txt]', JSON.stringify(r.md[0]?.body.markdown.text));
  await L.setMode('webhook-file-500');
  const r2 = await run('s12b', `[FILE: ${ws}/report.txt]`);
  L.check('S12b HTTP 500 on the file message: notice only, exactly one send attempt', r2.files.length === 1 && r2.md[0]?.body.markdown.text === '[File delivery failed: report.txt]', JSON.stringify(r2.md.map((m) => m.body.markdown.text)));
  await L.setMode('');
}
L.summary();
