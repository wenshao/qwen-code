// Real-daemon HTTP parity: legacy full status vs summary vs per-extension details, on one arm.
// usage: node http-parity.mjs <armDir> <home> <workspace> <port> <outJson>
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { startDaemon, get } from './daemon.mjs';

const [arm, home, workspace, port, out] = process.argv.slice(2);
const d = await startDaemon({ arm, home, workspace, port: Number(port), log: out.replace(/\.json$/, '.daemon.log') });
const result = { arm, features: d.capabilities.features.filter((f) => f.startsWith('extension')), checks: [] };
const check = (name, ok, detail) => { result.checks.push({ name, ok, ...(detail ? { detail } : {}) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : ''}`); };
try {
  result.advertises = d.capabilities.features.includes('extension_list_details');
  const full = await get(d, '/workspace/extensions');
  const summary = await get(d, '/workspace/extensions/summary');
  writeFileSync(out.replace(/\.json$/, '.full.json'), JSON.stringify(full.json, null, 2));
  result.full = { status: full.status, count: full.json.extensions?.length, bytes: full.bytes };
  result.summary = { status: summary.status, count: summary.json?.extensions?.length, bytes: summary.bytes, code: summary.json?.code };
  check('legacy GET /workspace/extensions = 200', full.status === 200, { count: full.json.extensions?.length });
  if (!result.advertises) {
    check('summary route absent on this arm (404)', summary.status === 404, { status: summary.status });
    const det = await get(d, '/workspace/extensions/rich-qwen/details');
    check('details route absent on this arm (404)', det.status === 404, { status: det.status, body: det.json });
  } else {
    check('summary = 200', summary.status === 200);
    const { extensions: fullExts, ...fullEnv } = full.json;
    const { extensions: sumExts, ...sumEnv } = summary.json;
    check('summary envelope == full envelope (minus extensions)', JSON.stringify(sumEnv) === JSON.stringify(fullEnv), { sumEnv, fullEnv });
    const expected = fullExts.map(({ capabilities, details, ...m }) => m);
    let sameOrderAndFields = true; const mism = [];
    if (expected.length !== sumExts.length) { sameOrderAndFields = false; mism.push({ len: [expected.length, sumExts.length] }); }
    for (let i = 0; i < Math.max(expected.length, sumExts.length); i++) {
      try { assert.deepStrictEqual(sumExts[i], expected[i]); } catch { sameOrderAndFields = false; mism.push({ i, full: expected[i]?.name, summary: sumExts[i]?.name }); }
    }
    check(`summary entries deep-equal full entries minus capabilities/details (${sumExts.length} entries, same order)`, sameOrderAndFields, mism.length ? mism.slice(0, 5) : undefined);
    check('no summary entry carries capabilities/details', sumExts.every((e) => !('capabilities' in e) && !('details' in e)));
    const detailMismatch = []; const detailTimes = [];
    for (const e of fullExts) {
      const r = await get(d, `/workspace/extensions/${encodeURIComponent(e.name)}/details`);
      detailTimes.push(r.ms);
      try { assert.equal(r.status, 200); assert.deepStrictEqual(r.json, e); } catch { detailMismatch.push({ name: e.name, path: e.path, status: r.status, gotPath: r.json?.path, gotSkills: r.json?.details?.skills, wantSkills: e.details?.skills, gotMcp: r.json?.details?.mcpServers, wantMcp: e.details?.mcpServers, gotCaps: r.json?.capabilities, wantCaps: e.capabilities }); }
    }
    result.detailMismatch = detailMismatch;
    check(`every /:name/details deep-equals its full-status entry (${fullExts.length} extensions)`, detailMismatch.length === 0, detailMismatch.length ? detailMismatch.map((m) => m.name) : undefined);
    const missing = await get(d, '/workspace/extensions/no-such-extension/details');
    check('missing extension -> 404 extension_not_found', missing.status === 404 && missing.json?.code === 'extension_not_found', { status: missing.status, body: missing.json });
    const rich = fullExts.find((e) => e.name === 'rich-qwen');
    if (rich) {
      const upper = await get(d, '/workspace/extensions/RICH-QWEN/details');
      check('upper-cased name resolves to the same entry', upper.status === 200 && JSON.stringify(upper.json) === JSON.stringify(rich));
      check('rich-qwen source redacted in summary', summary.json.extensions.find((e) => e.name === 'rich-qwen')?.source === rich.source && !/s3cr3t|access_token|readme/.test(rich.source), { source: rich.source });
      result.richDetails = rich.details; result.richCaps = rich.capabilities;
    }
    const plugin = fullExts.find((e) => e.name === 'agent-plugin');
    if (plugin) result.pluginDetails = plugin.details;
    const after = await get(d, '/workspace/extensions');
    check('legacy status after new reads unchanged', JSON.stringify(after.json) === JSON.stringify(full.json));
  }
} finally {
  await d.stop();
  writeFileSync(out, JSON.stringify(result, null, 2));
}
const failed = result.checks.filter((c) => !c.ok).length;
console.log(`${result.checks.length - failed}/${result.checks.length} passed`);
