// Rebuilds the two manifests of 'keeps the largest single stream within the manifest limit' at a94d76f960.
import { randomUUID } from 'node:crypto';
import { fx, M } from './ajv.mjs';
const L = M.MANAGED_TOOL_RESULT_LIMITS, K = M.MANAGED_TOOL_RESULT_KINDS;
const longest = '"'.repeat(L.maxIdBytes);
const pageBytes = L.maxSegmentBytes * L.maxSegmentsPerPage;
const pages = Array.from({ length: L.maxPagesPerStream }, () => ({ ref: { resourceId: randomUUID(), kind: K.page, schemaVersion: 1, byteLength: L.maxPageBytes, digest: 'f'.repeat(64) }, segmentCount: L.maxSegmentsPerPage, byteLength: pageBytes }));
const manifest = { ...fx.manifest, tenantId: longest, sessionId: longest, turnId: longest, executionCallId: longest, callId: longest, invocationDigest: longest,
  bindingGeneration: '9223372036854775807', captureId: 'c'.repeat(128), signal: null, exitCode: -2147483648,
  contents: [{ streamId: 's'.repeat(128), role: 'stdout', mimeType: `a/b;${'"'.repeat(251)}`, state: 'sealed', byteLength: pageBytes * pages.length, digest: 'f'.repeat(64), missingRanges: [], body: { pages } }] };
const long = { ...manifest, contents: [{ ...manifest.contents[0], body: { pages: pages.map((p) => ({ ...p, ref: { ...p.ref, resourceId: longest } })) } }] };
for (const [label, m] of [['worst-case identity ids, UUID page ids', manifest], ['same, 512-byte escaped page ids', long]]) {
  const b = Buffer.from(JSON.stringify(m)); let r; try { M.parseToolResultManifestBytes(b); r = 'parses'; } catch (e) { r = 'refused: ' + e.message; }
  console.log(label.padEnd(42), b.length, 'B', r);
}
