// Agent Plugins stdio MCP + an uncreatable plugin data root: does /details agree with the full status?
import { mkdirSync, writeFileSync, cpSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon, get } from './daemon.mjs';
const [arm, run, port, src] = process.argv.slice(2);
const tag = arm.split('/').pop();
const home = join(run, `datadir-${tag}`); const ws = join(run, `ws-datadir-${tag}`);
mkdirSync(join(home, 'extensions'), { recursive: true });
cpSync(join(src, 'agent-plugin'), join(home, 'extensions', 'agent-plugin'), { recursive: true });
let d = await startDaemon({ arm, home, workspace: ws, port: Number(port), log: join(run, `datadir-${tag}.log`) });
const out = {};
try {
  const caps = d.capabilities.features.includes('extension_list_details');
  // get the id without triggering a full load (summary is manifest-only); base arm: read full once on a throwaway copy
  let id;
  if (caps) id = (await get(d, '/workspace/extensions/summary')).json.extensions[0].id;
  await d.stop();
  if (!id) { // base: compute via a throwaway home
    const tmpHome = join(run, `datadir-${tag}-idprobe`);
    mkdirSync(join(tmpHome, 'extensions'), { recursive: true });
    cpSync(join(src, 'agent-plugin'), join(tmpHome, 'extensions', 'agent-plugin'), { recursive: true });
    const t = await startDaemon({ arm, home: tmpHome, workspace: ws, port: Number(port) + 1, log: join(run, `datadir-${tag}-idprobe.log`) });
    id = (await get(t, '/workspace/extensions')).json.extensions[0].id; await t.stop();
  }
  const dataRoot = join(home, 'extension-store', 'plugin-data', 'agent-plugins', id);
  out.dataRootExistedBefore = existsSync(dataRoot);
  mkdirSync(join(dataRoot, '..'), { recursive: true });
  if (!existsSync(dataRoot)) writeFileSync(dataRoot, 'not a directory\n');  // mkdir -p now fails (EEXIST)
  d = await startDaemon({ arm, home, workspace: ws, port: Number(port), log: join(run, `datadir-${tag}.log`) });
  const full = await get(d, '/workspace/extensions');
  out.full = { status: full.status, mcpServers: full.json.extensions?.[0]?.details?.mcpServers, mcpServerCount: full.json.extensions?.[0]?.capabilities?.mcpServerCount };
  if (caps) {
    const det = await get(d, '/workspace/extensions/agent-plugin/details');
    out.details = { status: det.status, mcpServers: det.json?.details?.mcpServers, mcpServerCount: det.json?.capabilities?.mcpServerCount };
  }
  out.dataRootIsFileAfter = statSync(dataRoot).isFile();
} finally { await d.stop(); }
console.log(JSON.stringify(out, null, 1));
