// Builds candidate follow-up cases for managed-context/1 and takes every
// expected outcome from the unchanged TypeScript module, the contract's
// reference. Output has the fixture file's shape, so Replay.java reads it.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  ManagedContextInstallations,
  checkManagedContextAttestation,
  isManagedContextReady,
  parseManagedContextBoot,
} from './managed-context-envelope.ts';
import { computeManagedContextDigest } from './managed-workspace-binding.ts';

const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const boot = parseManagedContextBoot(fx.boot);
const canonicalAttestation = fx.attestationCases.find((c) => c.id === 'canonical').body;
const base = fx.installationSequences.find((s) => s.id === 'installs-a-context')?.steps[0].request
  ?? fx.installationSequences[0].steps[0].request;

// The W0a encoding over the raw strings, for a binding that breaks a rule.
function rawDigest(b) {
  const items = ['qwen-managed-context-binding-v1', b.tenantId, b.workspaceId,
    b.workspaceGeneration, b.storageId, b.cwdRelative, b.contextConfigRef, b.contextRevision];
  const parts = [];
  for (const item of items) {
    const bytes = Buffer.from(String(item), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length);
    parts.push(len, bytes);
  }
  return `sha256:${createHash('sha256').update(Buffer.concat(parts)).digest('hex')}`;
}
function req(binding, extra = {}) {
  let digest;
  try { digest = computeManagedContextDigest(binding); } catch { digest = rawDigest(binding); }
  return { ...base, contextDigest: digest, ...extra, binding };
}

const out = { ...fx, bootCases: [], readyCases: [], attestationCases: [], installationSequences: [] };
const bootCase = (id, patch) => {
  const b = { ...fx.boot, ...patch };
  let valid = true;
  try { parseManagedContextBoot(b); } catch { valid = false; }
  out.bootCases.push({ id, boot: b, valid });
};
const readyCase = (id, patch) => {
  const r = { ...fx.ready, ...patch };
  out.readyCases.push({ id, ready: r, valid: isManagedContextReady(r, boot) });
};
const attestCase = (id, patch) => {
  const body = { ...canonicalAttestation, ...patch };
  out.attestationCases.push({ id, body, expected: checkManagedContextAttestation(body, boot) });
};
const sequence = (id, requests) => {
  const inst = new ManagedContextInstallations(boot);
  out.installationSequences.push({ id, steps: requests.map((request) => ({ request, expected: inst.install(request) })) });
};

const B = base.binding;
const other = { ...B, contextRevision: String(Number(B.contextRevision) + 1) };

// A. Non-ASCII digits after an ASCII first digit (not in the PR's cases).
bootCase('A-generation-trailing-non-ascii-digit', { workspaceGeneration: '1٧' });
attestCase('A-generation-trailing-non-ascii-digit', { workspaceGeneration: '1٧' });
readyCase('A-port-trailing-non-ascii-digit', { url: 'http://127.0.0.1:4٣123' });

// Deferred 1. Operation replay by a Session ID in another form.
sequence('D1-operation-replay-session-other-case', [
  req(B, { operationId: 'op-1', sessionId: 'session-a' }),
  req(B, { operationId: 'op-1', sessionId: 'SESSION-A' }),
]);
// Deferred 2. Storage ID and mount root normalizations.
attestCase('D2-storage-path-other-case', { storageId: 'storage://pvc/WORKSPACE-A' });
attestCase('D2-storage-trailing-slash', { storageId: 'storage://pvc/workspace-a/' });
attestCase('D2-storage-double-slash', { storageId: 'storage://pvc//workspace-a' });
attestCase('D2-mount-root-trailing-space', { mountRoot: '/runtime/workspaces/workspace-a ' });
attestCase('D2-mount-root-nfkc', { mountRoot: '/runtime/workspaces/workspace－a' });
attestCase('D2-mount-root-percent', { mountRoot: '/runtime/workspaces/workspace%2Da' });
sequence('D2-binding-storage-path-other-case', [
  req({ ...B, storageId: 'storage://pvc/WORKSPACE-A' }),
]);
// Deferred 3. Session IDs and ready IDs trimmed or folded.
sequence('D3-session-trailing-space-is-another-session', [
  req(B, { operationId: 'op-1', sessionId: 'session-a' }),
  req(other, { operationId: 'op-2', sessionId: 'session-a ' }),
]);
sequence('D3-session-nfd-is-another-session', [
  req(B, { operationId: 'op-1', sessionId: 'café' }),
  req(other, { operationId: 'op-2', sessionId: 'café' }),
]);
readyCase('D3-ready-lease-trailing-newline', { leaseId: `${fx.ready.leaseId}\n` });
readyCase('D3-ready-instance-leading-space', { runtimeInstanceId: ` ${fx.ready.runtimeInstanceId}` });
// Deferred 4. Conditional overwrites at a refusal, probed by installing the
// original context again under a new operation.
const tenantB = { ...B, tenantId: 'tenant-b' };
sequence('D4-workspace-refusal-keeps-the-session', [
  req(B, { operationId: 'op-1', sessionId: 'session-a' }),
  req(tenantB, { operationId: 'op-2', sessionId: 'session-a' }),
  req(B, { operationId: 'op-3', sessionId: 'session-a' }),
]);
sequence('D4-digest-refusal-keeps-the-session', [
  req(B, { operationId: 'op-1', sessionId: 'session-a' }),
  { ...req(other, { operationId: 'op-2', sessionId: 'session-a' }), contextDigest: computeManagedContextDigest({ ...B, contextRevision: '99' }) },
  req(B, { operationId: 'op-3', sessionId: 'session-a' }),
]);
sequence('D4-digest-refusal-from-another-session-keeps-the-operation', [
  req(B, { operationId: 'op-1', sessionId: 'session-a' }),
  { ...req(other, { operationId: 'op-1', sessionId: 'session-b' }), contextDigest: req(B).contextDigest },
  req(B, { operationId: 'op-1', sessionId: 'session-a' }),
]);
// Deferred 5. Non-ASCII digits in the identifier, token68 and digest classes.
bootCase('D5-identifier-non-ascii-digit', { tenantId: 'tenant-١' });
bootCase('D5-token-non-ascii-digit', { token: 'token١' });
bootCase('D5-digest-non-ascii-digit', { capabilityDigest: `sha256:${'a'.repeat(63)}١` });
// Deferred 7. A worker that canonicalizes the binding before hashing.
sequence('D7-non-canonical-binding-with-canonical-digest', [
  { ...req({ ...B, cwdRelative: 'src/./app' }), contextDigest: computeManagedContextDigest({ ...B, cwdRelative: 'src/app' }) },
]);

fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
const n = (k) => out[k].length;
console.log(`boot ${n('bootCases')} ready ${n('readyCases')} attest ${n('attestationCases')} install ${n('installationSequences')}`);
for (const c of out.bootCases) console.log('boot', c.id, c.valid);
for (const c of out.readyCases) console.log('ready', c.id, c.valid);
for (const c of out.attestationCases) console.log('attest', c.id, c.expected.status, c.expected.code ?? '');
for (const s of out.installationSequences) console.log('install', s.id, s.steps.map((x) => x.expected.status + (x.expected.code ? ':' + x.expected.code : '')).join(' -> '));
