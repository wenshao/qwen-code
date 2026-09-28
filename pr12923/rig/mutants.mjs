// Single-point mutants against the PR head; each is run against the PR's own
// tests for that package and attributed by failing test name.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WT = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/64df5bb9-2331-4255-b253-6b11e72da2dc/scratchpad/wt-head';
const OUT = path.join(WT, '..', 'runs', 'mutants.json');
const U = 'packages/acp-bridge/src/session-attachment-uploads.ts';
const S = 'packages/acp-bridge/src/sessionAttachments.ts';
const CP = 'packages/acp-bridge/src/session-control-plane.ts';
const DC = 'packages/sdk-typescript/src/daemon/DaemonClient.ts';
const DE = 'packages/sdk-typescript/src/daemon/DaemonAttachmentUploadError.ts';
const R = 'packages/cli/src/serve/routes/session.ts';

const bridgeTests = [
  { cwd: 'packages/acp-bridge', args: ['src/session-attachment-uploads.test.ts', 'src/sessionAttachments.test.ts'] },
  { cwd: 'packages/acp-bridge', args: ['src/bridge.test.ts', '-t', 'chunk uploads|attachment stores during bridge shutdown'] },
];
const sdkTests = [
  { cwd: 'packages/sdk-typescript', args: ['test/unit/DaemonClient.attachments.test.ts', 'test/unit/DaemonSessionClient.test.ts'] },
];
const cliTests = [{ cwd: 'packages/cli', args: ['src/serve/server.test.ts', '-t', 'attachment'] }];

const M = [
  ['M1', U, 'offset === upload.previousOffset &&', 'false &&', 'identical-retry idempotency for a lost chunk response', bridgeTests],
  ['M2', U, 'if (upload.completion) return upload.completion;', '', 'completion memo for a lost complete response', bridgeTests],
  ['M3', U, 'this.active >= MAX_SESSION_UPLOADS ||', 'false ||', 'per-session limit of 8', bridgeTests],
  ['M4', U, 'activeUploads >= MAX_ACTIVE_UPLOADS ||', 'false ||', 'daemon-wide limit of 32', bridgeTests],
  ['M5', U, 'stagedBytes + metadata.size > MAX_STAGED_BYTES', 'false', '128 MiB staged-byte cap', bridgeTests],
  ['M6', U, "if (upload.state !== 'completing' && upload.expiresAt <= Date.now()) {", 'if (false) {', 'expiry check on access', bridgeTests],
  ['M7', U, 'if (!upload || upload.clientId !== clientId) throw notFound();', 'if (!upload) throw notFound();', 'creator-only access', bridgeTests],
  ['M8', U, 'if (upload.clientId === clientId) this.discard(upload);', '', 'cancelClient discards', bridgeTests],
  ['M9', U, 'this.closed = true;\n    for (const upload of this.records.values()) this.discard(upload);', 'this.closed = true;', 'uploads.close() discards', bridgeTests],
  ['M10', S, 'if (metadata.size > SESSION_ATTACHMENT_MAX_ITEM_BYTES) {', 'if (false) {', '8 MiB cap on create', bridgeTests],
  ['M11', S, 'this.closing = true;\n    this.uploads.close();\n    await this.waitForCopy();\n    if (this.closed) return;', 'this.closing = true;\n    await this.waitForCopy();\n    if (this.closed) return;', 'store.close() releases staged uploads', bridgeTests],
  ['M12', S, 'this.closing = true;\n    this.uploads.close();\n    await this.waitForCopy();\n    options.assertCanCommit?.();', 'this.closing = true;\n    await this.waitForCopy();\n    options.assertCanCommit?.();', 'store.delete() releases staged uploads', bridgeTests],
  ['M13', CP, '      entry.attachments.cancelClientUploads(clientId);\n', '', 'last-attach detach cancels the client uploads', bridgeTests],
  ['M14', CP, '...entries.map((entry) => entry.attachments.close()),', '...[...byId.values()].map((entry) => entry.attachments.close()),', 'shutdown closes captured stores (latent-bug fix)', bridgeTests],
  ['M15', DC, '[502, 503, 504].includes(error.status)', 'false', 'retry transient 502/503/504', sdkTests],
  ['M16', DC, '      if (uploadId) {\n        try {', '      if (false) {\n        try {', 'cleanup DELETE after failure/cancel', sdkTests],
  ['M17', DC, 'if (this.activeAttachmentUploads >= 2) {', 'if (false) {', 'two concurrent chunked uploads per client', sdkTests],
  ['M18', DC, '    this.attachmentCapabilitiesGeneration += 1;\n    this.attachmentCapabilitiesRequest = undefined;\n    this.attachmentCapabilities = undefined;\n', '', 'dispose() invalidates the probe (follow-up fix)', sdkTests],
  ['M19', DC, "            error.message +=\n              '; a reverse proxy request-body limit may be rejecting this attachment';", '            void 0;', 'legacy 413 proxy hint', sdkTests],
  ['M20', DC, 'if (data.size > 512 * 1024) {', 'if (data.size > 8 * 1024 * 1024) {', 'chunk above 512 KiB', sdkTests],
  ['M21', DE, 'this.status = this.httpStatus === 404 ? undefined : this.httpStatus;', 'this.status = this.httpStatus;', 'hide 404 so callers never inline-replay', [...sdkTests, { cwd: 'packages/web-shell', args: ['--config', 'vitest.config.ts', 'daemon/session/actions.test.ts'] }]],
  ['M22', R, "            .toLowerCase() !== 'application/octet-stream'", "            .toLowerCase() === '__never__'", 'chunk route requires application/octet-stream', cliTests],
];

const only = process.argv[2] ? new Set(process.argv[2].split(',')) : undefined;
const results = fs.existsSync(OUT) && only ? JSON.parse(fs.readFileSync(OUT, 'utf8')).filter((r) => !only.has(r.id)) : [];
for (const [id, file, from, to, what, suites] of M) {
  if (only && !only.has(id)) continue;
  const abs = path.join(WT, file);
  const orig = fs.readFileSync(abs, 'utf8');
  const count = orig.split(from).length - 1;
  if (count !== 1) {
    results.push({ id, what, error: `anchor found ${count} times` });
    console.log(id, 'ANCHOR', count);
    continue;
  }
  fs.writeFileSync(abs, orig.replace(from, to));
  const failing = [];
  let killed = false;
  try {
    for (const s of suites) {
      const r = spawnSync('npx', ['vitest', 'run', ...s.args], { cwd: path.join(WT, s.cwd), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const out = (r.stdout ?? '') + (r.stderr ?? '');
      if (r.status !== 0) killed = true;
      for (const l of out.split('\n')) {
        const m = l.match(/^\s*(?:FAIL|×)\s+(.*)$/);
        if (m && !failing.includes(m[1].trim())) failing.push(m[1].trim().slice(0, 200));
      }
    }
  } finally {
    fs.writeFileSync(abs, orig);
  }
  results.push({ id, file, what, killed, failing: failing.slice(0, 6) });
  console.log(id, killed ? 'KILLED' : 'SURVIVED', what, '|', failing.slice(0, 2).join(' || '));
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
}
