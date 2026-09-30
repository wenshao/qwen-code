// S3: reviewer test plan step 5 — profiles that must keep their behavior: default no-tool, and the MCP profile's native file tools.
// usage: DB=<db> [ARM=head|base] node s3-profiles.mjs <letter>
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, backups, read, holderOf, j } from './lib.mjs';
const [letter] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head';
const R = new Report(`s3-profiles-${arm}`);
const model = await startModel();
const h = await new Harness({ name: `s3-${arm}`, modelUrl: model.url }).start();
const w = await workspace(letter);
try {
  // default profile: no toolProfile at all
  const plain = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId), 'none');
  const c = await plain.create();
  const p = await plain.prompt(script([], 'NO_TOOL_OK'));
  R.check('default no-tool profile: text turn completes', c.status === 200 && p.terminal?.[0]?.type === 'turn_complete', `${turn(p)} tools advertised=${j(model.requests.at(-1)?.tools)}`);
  const hist = await plain.history();
  const undo = await plain.rewind(randomUUID());
  R.check(arm !== 'base' ? 'no-tool profile refuses the file-history API (409), stays usable' : 'base has no such routes', arm !== 'base' ? hist.status === 409 && undo.status === 409 && (await plain.status()).recoveryBlocked === false : hist.status === 404, `history=${hist.status} ${hist.json?.code ?? ''} undo=${undo.status} ${undo.json?.code ?? ''}`);
  // MCP profile with no MCP servers: native file tools only
  fs.writeFileSync(path.join(w.dir, 'mcp-notes.txt'), 'original');
  const mcp = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId), 'hosted-workspace-mcp/1');
  const mc = await mcp.create({ mcpServers: [] });
  R.note('MCP profile', `not exercised by this rig: the profile needs 1–32 catalogued MCP server pins (create with none -> ${mc.status} ${mc.json?.code ?? ''}); covered by the PR unit tests only`);
  if (mc.status === 200) {
    const mp = await mcp.prompt(script([[call('write_file', { file_path: 'mcp-notes.txt', content: 'written in MCP profile' })], [call('edit', { file_path: 'mcp-notes.txt', old_string: 'written', new_string: 'edited' })]], 'MCP_NATIVE_OK'), 240_000);
    R.check('MCP profile: native Write/Edit keep working', mp.terminal?.[0]?.type === 'turn_complete' && read(w.dir, 'mcp-notes.txt') === 'edited in MCP profile', `${turn(mp)} file=${j(read(w.dir, 'mcp-notes.txt'))}`);
    R.check('MCP profile: no backups are taken', backups(mcp.sessionId).length === 0, `backup entries=${backups(mcp.sessionId).length}`);
    const mh = await mcp.history();
    const mu = await mcp.rewind(mp.promptId);
    R.check(arm !== 'base' ? 'MCP profile refuses the file-history API without becoming blocked' : 'base has no such routes', arm !== 'base' ? mh.status === 409 && mh.json?.code === 'hosted_file_history_unavailable' && mu.status === 409 && (await mcp.status()).recoveryBlocked === false : mh.status === 404, `history=${mh.status} ${mh.json?.code ?? ''} undo=${mu.status} ${mu.json?.code ?? ''} recoveryBlocked=${(await mcp.status()).recoveryBlocked}`);
    const next = await mcp.prompt(script([[call('read_file', { file_path: 'mcp-notes.txt' })]], 'MCP_NEXT_OK'), 240_000);
    R.check('MCP profile: next turn still works', next.terminal?.[0]?.type === 'turn_complete', turn(next));
  }
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1200));
} finally {
  await h.stop();
  await model.close();
  R.done();
}
