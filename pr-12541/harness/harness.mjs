// Real-daemon A/B harness for PR #12541.
// Usage: node harness.mjs <distDir> <armLabel> <outDir>
// Builds a fresh QWEN_HOME per scenario, boots `dist/cli.js serve` with three
// workspaces (primary trusted, secondary trusted, tertiary untrusted), drives
// the real HTTP routes, and writes every response body to <outDir>/<arm>/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const [distDir, arm, outRoot] = process.argv.slice(2);
const outDir = path.join(outRoot, arm);
fs.mkdirSync(outDir, { recursive: true });
const TOKEN = 'verify-token-12541';
const wsId = (cwd) =>
  crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

// A "heavy" qwen extension: manifest plus subresources the full load walks.
function makeQwenExt(dir, manifest, { skills = 0, commands = 0, agents = 0 } = {}) {
  writeJson(path.join(dir, 'qwen-extension.json'), manifest);
  for (let i = 0; i < skills; i++) {
    const s = path.join(dir, 'skills', `skill-${i}`);
    fs.mkdirSync(s, { recursive: true });
    fs.writeFileSync(
      path.join(s, 'SKILL.md'),
      `---\nname: ${manifest.name}-skill-${i}\ndescription: Skill ${i} of ${manifest.name}\n---\n\n${'Body line.\n'.repeat(40)}`,
    );
  }
  for (let i = 0; i < commands; i++) {
    const c = path.join(dir, 'commands', `group${i % 5}`);
    fs.mkdirSync(c, { recursive: true });
    fs.writeFileSync(
      path.join(c, `cmd${i}.toml`),
      `description = "cmd ${i}"\nprompt = "do ${i}"\n`,
    );
  }
  for (let i = 0; i < agents; i++) {
    const a = path.join(dir, 'agents');
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(
      path.join(a, `agent-${i}.md`),
      `---\nname: ${manifest.name}-agent-${i}\ndescription: Agent ${i}\n---\n\nYou are agent ${i}.\n`,
    );
  }
}

const SCENARIOS = {
  // S1: regular + linked install, override on the secondary workspace,
  // untrusted tertiary workspace.
  baseline(home, root) {
    const ext = path.join(home, 'extensions');
    makeQwenExt(path.join(ext, 'plain'), { name: 'plain', version: '1.0.0' }, { skills: 2, commands: 2, agents: 1 });
    const src = path.join(root, 'linked-src');
    makeQwenExt(src, { name: 'linked', version: '2.0.0' }, { skills: 2 });
    writeJson(path.join(ext, 'linked', '.qwen-extension-install.json'), { source: src, type: 'link' });
    return { overrides: [{ name: 'linked', ws: 'secondary', state: 'disabled' }, { name: 'plain', ws: 'primary', state: 'disabled' }] };
  },
  // S2: `cp -r` of an extension dir (same manifest name, no sidecar).
  dupName(home) {
    const ext = path.join(home, 'extensions');
    makeQwenExt(path.join(ext, 'my-ext'), { name: 'my-ext', version: '1.1.0' });
    makeQwenExt(path.join(ext, 'my-ext-copy'), { name: 'my-ext', version: '9.9.9' });
    makeQwenExt(path.join(ext, 'other'), { name: 'other', version: '1.0.0' });
    return { overrides: [] };
  },
  // S3: manifest whose post-head load throws (hook command not a string):
  // full load's catch skips it, manifest head accepts it.
  badHook(home) {
    const ext = path.join(home, 'extensions');
    makeQwenExt(path.join(ext, 'good'), { name: 'good', version: '1.0.0' });
    makeQwenExt(path.join(ext, 'bad-hook'), {
      name: 'bad-hook',
      version: '1.0.0',
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 42 }] }] },
    });
    makeQwenExt(path.join(ext, 'bad-ctx'), { name: 'bad-ctx', version: '1.0.0', contextFileName: 5 });
    return { overrides: [], probePhantoms: true };
  },
  // S4: Agent Plugins v1 plugin with a stdio MCP server: does a GET mkdir
  // the plugin data root?
  agentPlugin(home) {
    const dir = path.join(home, 'extensions', 'ap');
    writeJson(path.join(dir, 'plugin.json'), {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'ap',
      version: '0.3.0',
      description: 'agent plugin fixture',
    });
    writeJson(path.join(dir, 'mcp.json'), {
      mcpServers: { local: { type: 'stdio', command: 'node', args: ['server.js'] } },
    });
    return { overrides: [] };
  },
  // S5b: a modest install: 6 extensions x (8 skills, 8 commands, 3 agents).
  typical(home) {
    const ext = path.join(home, 'extensions');
    for (let i = 0; i < 6; i++) {
      makeQwenExt(path.join(ext, `ext-${i}`), { name: `ext-${i}`, version: `1.0.${i}` }, { skills: 8, commands: 8, agents: 3 });
    }
    return { overrides: [], latency: 60 };
  },
  // S5: many heavy extensions for latency.
  heavy(home) {
    const ext = path.join(home, 'extensions');
    for (let i = 0; i < 40; i++) {
      makeQwenExt(path.join(ext, `heavy-${i}`), { name: `heavy-${i}`, version: `1.0.${i}` }, { skills: 40, commands: 40, agents: 15 });
    }
    return { overrides: [], latency: 40 };
  },
};

async function waitReady(base) {
  for (let i = 0; i < 300; i++) {
    try {
      const r = await fetch(`${base}/capabilities`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (r.status !== 503) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('daemon never became ready');
}

async function call(base, method, p, body) {
  const t0 = performance.now();
  const r = await fetch(`${base}${p}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  const ms = performance.now() - t0;
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, ms };
}

function listTree(dir) {
  const out = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      out.push(path.relative(dir, p) + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

async function runScenario(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pr12541-${arm}-${name}-`));
  const home = path.join(root, '.qwen');
  const wss = { primary: path.join(root, 'ws-primary'), secondary: path.join(root, 'ws-secondary'), tertiary: path.join(root, 'ws-untrusted') };
  for (const d of Object.values(wss)) fs.mkdirSync(d, { recursive: true });
  // Untrusted tertiary workspace also carries a workspace settings file that
  // would disable everything if the route (wrongly) loaded it.
  writeJson(path.join(wss.tertiary, '.qwen', 'settings.json'), { extensions: { disabled: ['plain', 'linked', 'my-ext', 'good', 'bad-hook', 'ap'] } });
  writeJson(path.join(home, 'settings.json'), {
    security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: true } },
    model: { name: 'fake-model' },
  });
  writeJson(path.join(home, 'trustedFolders.json'), {
    [wss.primary]: 'TRUST_FOLDER',
    [wss.secondary]: 'TRUST_FOLDER',
    [wss.tertiary]: 'DO_NOT_TRUST',
  });
  const plan = SCENARIOS[name](home, root);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const log = fs.openSync(path.join(outDir, `${name}.daemon.log`), 'w');
  const child = spawn(
    process.execPath,
    [path.join(distDir, 'cli.js'), 'serve', '--port', String(port), '--token', TOKEN,
      '--workspace', wss.primary, '--workspace', wss.secondary, '--workspace', wss.tertiary, '--no-web'],
    {
      cwd: wss.primary,
      env: { ...process.env, QWEN_HOME: home, QWEN_CODE_TRUSTED_FOLDERS_PATH: path.join(home, 'trustedFolders.json'), OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'http://127.0.0.1:9', OPENAI_MODEL: 'fake-model', NO_COLOR: '1' },
      stdio: ['ignore', log, log],
    },
  );
  const base = `http://127.0.0.1:${port}`;
  const result = { scenario: name, arm };
  try {
    await waitReady(base);
    const status = await call(base, 'GET', '/extensions');
    result.catalog = status.json;
    const idByName = {};
    for (const e of status.json.extensions ?? []) idByName[e.name] = e.id;
    result.overrides = [];
    for (const o of plan.overrides) {
      const r = await call(base, 'PUT', `/workspaces/${wsId(wss[o.ws])}/extensions/${idByName[o.name]}/activation`, { state: o.state });
      // wait for the operation to settle
      const opId = r.json?.operationId ?? r.json?.id ?? r.json?.operation?.id;
      let op = null;
      for (let i = 0; i < 200 && opId; i++) {
        op = (await call(base, 'GET', `/extensions/operations/${opId}`)).json;
        if (op && ['succeeded', 'failed', 'completed', 'cancelled'].includes(op.status)) break;
        await new Promise((res) => setTimeout(res, 100));
      }
      result.putBody ??= r.json;
      result.overrides.push({ ...o, http: r.status, final: op?.status });
    }
    const beforeTree = listTree(home);
    result.projection = {};
    for (const [k, cwd] of Object.entries(wss)) {
      const r = await call(base, 'GET', `/workspaces/${wsId(cwd)}/extensions`);
      // Normalise temp paths so arms diff cleanly.
      result.projection[k] = { status: r.status, body: JSON.parse(JSON.stringify(r.json).split(root).join('<root>')) };
    }
    const afterTree = listTree(home);
    result.homeEntriesCreatedByProjectionGets = afterTree.filter((p) => !beforeTree.includes(p));
    // full status as the management page reads it
    const full = await call(base, 'GET', `/workspace/extensions`);
    result.fullStatus = { status: full.status, names: Array.isArray(full.json?.extensions) ? full.json.extensions.map((e) => `${e.name}@${e.version}`) : full.json };
    if (plan.probePhantoms) {
      const loaded = new Set((full.json?.extensions ?? []).map((e) => e.name));
      result.phantomProbe = [];
      for (const e of result.projection.secondary.body.extensions ?? []) {
        if (loaded.has(e.name)) continue;
        const r = await call(base, 'PUT', `/workspaces/${wsId(wss.secondary)}/extensions/${e.extensionId}/activation`, { state: 'disabled' });
        let op = null;
        for (let i = 0; i < 100 && r.json?.operationId; i++) {
          op = (await call(base, 'GET', `/extensions/operations/${r.json.operationId}`)).json;
          if (['succeeded', 'failed'].includes(op?.status)) break;
          await new Promise((res) => setTimeout(res, 100));
        }
        result.phantomProbe.push({ name: e.name, put: r.status, op: op && { status: op.status, error: op.error } });
      }
    }
    if (plan.latency) {
      const ms = [];
      for (let i = 0; i < plan.latency; i++) ms.push((await call(base, 'GET', `/workspaces/${wsId(wss.secondary)}/extensions`)).ms);
      ms.sort((a, b) => a - b);
      const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
      result.latencyMs = { n: ms.length, min: ms[0], p50: q(0.5), p90: q(0.9), max: ms[ms.length - 1] };
    }
  } catch (e) {
    result.error = String(e?.stack ?? e);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
  result.dataDirs = listTree(home).filter((p) => /plugin-data|agent-plugin|\bdata\b/i.test(p));
  writeJson(path.join(outDir, `${name}.json`), result);
  fs.rmSync(root, { recursive: true, force: true });
  return result;
}

const only = process.env.SCENARIOS ? process.env.SCENARIOS.split(',') : Object.keys(SCENARIOS);
for (const s of only) {
  const r = await runScenario(s);
  console.log(`[${arm}] ${s}: ${r.error ? 'ERROR ' + r.error.split('\n')[0] : 'ok'}`);
}
