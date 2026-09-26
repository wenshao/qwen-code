// Shared harness helpers. Everything imports the compiled core dist, so the
// probes exercise the same JavaScript the product would ship.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const mod = (rel) => pathToFileURL(path.join(CORE, rel)).href;
export const CORE =
  process.env.CORE_DIST ??
  '/Users/wenshao/git/qwen-code-pr12767-h2/packages/core/dist/src';
const STORE_FILE =
  process.env.STORE_FILE ?? 'local-managed-tool-result-store.js';

export const { LocalToolResultSegmentStore } = await import(mod(`managed-runtime/${STORE_FILE}`));
export const { SessionWriterLease } = await import(mod('services/session-writer-lease.js'));
export const { LocalManagedSessionResourceStore } = await import(mod('managed-runtime/managed-session-resources.js'));
export const MTR = await import(mod('managed-runtime/managed-tool-result.js'));

export const FIXTURES = path.join(CORE, '..', '..', 'src', 'managed-runtime', 'contracts', 'managed-tool-result-v1.fixtures.json');

export const sessionKey = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  sessionId: 'session-a',
};

export const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function mkRuntime(base, tag) {
  const root = await fs.mkdtemp(path.join(base ?? os.tmpdir(), `o1b-${tag}-`));
  const runtimeBaseDir = path.join(root, 'runtime');
  const transcriptPath = path.join(
    runtimeBaseDir,
    'chats',
    `${sessionKey.sessionId}.jsonl`,
  );
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
  return { root, runtimeBaseDir, transcriptPath };
}

export async function openWriter(rt, key = sessionKey) {
  const lease = await SessionWriterLease.acquire({
    runtimeBaseDir: rt.runtimeBaseDir,
    sessionId: key.sessionId,
    transcriptPath: rt.transcriptPath,
  });
  const store = await LocalToolResultSegmentStore.openWritable({
    lease,
    sessionKey: key,
  });
  return { lease, store };
}

export async function closeWriter(w) {
  await w.store.close();
  await w.lease.release();
}

/** Deterministic bytes for (tag, ordinal, variant). */
export function segmentBytes(seed, tag, ordinal, length, variant = 0) {
  const out = Buffer.alloc(length);
  let block = 0;
  for (let pos = 0; pos < length; block++) {
    const d = createHash('sha256')
      .update(`${seed}/${tag}/${ordinal}/${variant}/${block}`)
      .digest();
    pos += d.copy(out, pos);
  }
  return out;
}

export function json(value) {
  return JSON.stringify(value, (_k, v) =>
    Buffer.isBuffer(v) ? { buffer: v.toString('hex') } : v,
  );
}
