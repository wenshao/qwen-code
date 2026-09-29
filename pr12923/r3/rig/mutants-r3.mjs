// R3: falsifiability mutants for the R1-review fixes in 4b45177be.
// Each mutant reverts one fix; the new test that pins it must go red.
// Usage: node mutants-r3.mjs <worktree> <label>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [WT, label] = process.argv.slice(2);
const SA = 'packages/acp-bridge/src/sessionAttachments.ts';
const SU = 'packages/acp-bridge/src/session-attachment-uploads.ts';
const ER = 'packages/cli/src/serve/server/error-response.ts';
const RS = 'packages/cli/src/serve/routes/session.ts';
const DC = 'packages/sdk-typescript/src/daemon/DaemonClient.ts';
const M = [
  // R1-1: queued same-name write reserves its name against DELETE.
  ['R1-1', SA, '      this.queuedNames.has(name) ||\n', '', 'packages/acp-bridge',
    ['src/sessionAttachments.test.ts', '-t', 'keeps a stored name while a same-name write waits']],
  // R1-3: store_busy keeps the upload retryable instead of failed.
  ['R1-3', SU, `          if (
            error instanceof SessionAttachmentUploadError &&
            error.code === 'attachment_upload_store_busy'
          ) {`, '          if (false) {', 'packages/acp-bridge',
    ['src/sessionAttachments.test.ts', '-t', 'retries completion after a concurrent session copy']],
  // R1-6: reads share a publication batch instead of queueing exclusively.
  ['R1-6', SA, '    const releasePublication = await this.acquireReadPublication();',
    '    const releasePublication = await this.acquirePublication();', 'packages/acp-bridge',
    ['src/sessionAttachments.test.ts', '-t', 'reads different published attachments concurrently']],
  // R1-2: upload errors keep their cause, 4xx is expected, busy is retryable.
  ['R1-2', ER, `    if (err.status >= 500) {
      reportBridgeError(err.cause ?? err, ctx, daemonLog);
    } else {
      recordExpectedBridgeError(err, ctx, daemonLog);
    }
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.code === 'attachment_upload_store_busy'
        ? { retryable: true }
        : {}),
    });`, '    res.status(err.status).json({ error: err.message, code: err.code });',
    'packages/cli', ['src/serve/server/error-response.test.ts', '-t', 'session attachment upload errors']],
  // R1-4: 415 distinguishes unsupported encoding from content type/charset.
  ['R1-4', RS, `        code:
          status === 413
            ? 'attachment_upload_too_large'
            : status === 415
              ? error.type === 'encoding.unsupported'
                ? 'invalid_attachment_upload_encoding'
                : 'invalid_attachment_upload_content_type'
              : 'invalid_attachment_upload_body',`,
    `        code:
          status === 413
            ? 'attachment_upload_too_large'
            : 'invalid_attachment_upload_body',`,
    'packages/cli', ['src/serve/server.test.ts', '-t', 'bounds chunk and metadata bodies and rejects malformed input']],
  // R1-5: generic chunk 413 gains the reverse-proxy hint.
  ['R1-5', DC, `                if (
                  error.status === 413 &&
                  (typeof error.body !== 'object' || error.body === null)
                ) {
                  error.message +=
                    '; a reverse proxy request-body limit may be rejecting this attachment';
                }
`, '', 'packages/sdk-typescript',
    ['test/unit/DaemonClient.attachments.test.ts', '-t', 'points generic chunk 413 responses to a request-body limit']],
];
const run = (pkg, args) => {
  const r = spawnSync('npx', ['vitest', 'run', ...args], { cwd: path.join(WT, pkg), encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return { ok: r.status === 0, summary: (out.match(/Tests\s+\d+[^\n]*/) || [''])[0].trim() || out.slice(-200) };
};
const out = [];
for (const [id, file, from, to, pkg, args] of M) {
  const abs = path.join(WT, file);
  const orig = fs.readFileSync(abs, 'utf8');
  if (orig.split(from).length !== 2) {
    out.push({ label, id, anchorError: true });
    console.log(`${label} ${id}: ANCHOR NOT FOUND`);
    continue;
  }
  const clean = run(pkg, args);
  fs.writeFileSync(abs, orig.replace(from, to));
  let mut;
  try { mut = run(pkg, args); } finally { fs.writeFileSync(abs, orig); }
  const restored = fs.readFileSync(abs, 'utf8') === orig;
  out.push({ label, id, cleanPasses: clean.ok, cleanSummary: clean.summary, killed: !mut.ok, mutantSummary: mut.summary, restored });
  console.log(`${label} ${id}: clean ${clean.ok ? 'PASS' : 'FAIL'} (${clean.summary}) | mutant ${mut.ok ? 'SURVIVED' : 'KILLED'} (${mut.summary}) | restored ${restored}`);
}
fs.writeFileSync(path.join(WT, '..', 'results', 'mutants-r3.json'), JSON.stringify(out, null, 2));
