import { fx, M } from './ajv.mjs';
const L = M.MANAGED_TOOL_RESULT_LIMITS;
function build(idChar, pageIdChar) {
  const longest = idChar.repeat(L.maxIdBytes / Buffer.byteLength(idChar));
  const pageId = pageIdChar.repeat(L.maxIdBytes / Buffer.byteLength(pageIdChar));
  const segBytes = L.maxSegmentBytes, pageBytes = segBytes * L.maxSegmentsPerPage;
  const pages = Array.from({ length: L.maxPagesPerStream }, () => ({
    ref: { resourceId: pageId, kind: M.MANAGED_TOOL_RESULT_KINDS.page, schemaVersion: 1, byteLength: L.maxPageBytes, digest: 'f'.repeat(64) },
    segmentCount: L.maxSegmentsPerPage, byteLength: pageBytes }));
  return { ...fx.manifest, tenantId: longest, sessionId: longest, turnId: longest, executionCallId: longest, callId: longest, invocationDigest: longest,
    bindingGeneration: '9223372036854775807', captureId: 'c'.repeat(128), signal: null, exitCode: -2147483648,
    contents: [{ streamId: 's'.repeat(128), role: 'stdout', mimeType: `application/${'x'.repeat(243)}`, state: 'sealed',
      byteLength: pageBytes * pages.length, digest: 'f'.repeat(64), missingRanges: [], body: { pages } }] };
}
const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
for (const [label, a, b] of [
  ['PR test: ids "x"x512, page ids "x"x512', 'x', 'x'],
  ['store-assigned page ids (randomUUID, 36 B)', '"', null],
  ['ids of \'"\' x512 (valid id, escapes to 2 B)', '"', '"'],
  ['ids of \'\\\\\' x512', '\\', '\\'],
  ['ids of U+2028 x170 (3 B, JSON.stringify keeps raw)', ' ', ' '],
]) {
  let m = build(a, b ?? 'x');
  if (b === null) m = { ...m, contents: [{ ...m.contents[0], body: { pages: m.contents[0].body.pages.map(p => ({ ...p, ref: { ...p.ref, resourceId: uuid } })) } }] };
  let objOk; try { M.parseToolResultManifest(m); objOk = 'valid'; } catch (e) { objOk = 'INVALID ' + e.message; }
  const bytes = Buffer.from(JSON.stringify(m));
  let wireOk; try { M.parseToolResultManifestBytes(bytes); wireOk = 'parses'; } catch (e) { wireOk = 'refused: ' + e.message; }
  console.log(label.padEnd(52), String(bytes.length).padStart(6), 'B /', L.maxManifestBytes, '|', objOk, '|', wireOk);
}
