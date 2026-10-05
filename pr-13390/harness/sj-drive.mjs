// Drive the real bundled CLI through the stream-json control protocol (the
// SDK's transport) and read `get_context_usage {show_details:true}` before the
// first reply (estimate path) and after it (provider-count path).
// usage: node sj-drive.mjs <arm> <rundir> <promptTokensAfter> [scenario]
//   scenario: codemode-alwaysload (default) | codemode-deferred | direct-alwaysload
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [arm, runArg, ptAfter, scenario = 'codemode-alwaysload'] =
  process.argv.slice(2);
const run = resolve(runArg);
const cli = `/root/verify/pr13390/${arm}/dist/cli.js`;
rmSync(run, { recursive: true, force: true });
mkdirSync(join(run, 'home/.qwen'), { recursive: true });
mkdirSync(join(run, 'ws'), { recursive: true });

const settings = {
  tools: { codeModeOnly: scenario.startsWith('codemode') },
  security: { folderTrust: { enabled: false } },
  mcpServers: {
    tracker: {
      command: process.execPath,
      args: [
        '/root/verify/pr13390/harness/mcp-server.mjs',
        join(run, 'hits.jsonl'),
      ],
      env: { MCP_SCALE: process.env.MCP_SCALE || '1' },
      alwaysLoadTools: scenario.endsWith('alwaysload'),
    },
  },
};
writeFileSync(
  join(run, 'home/.qwen/settings.json'),
  JSON.stringify(settings, null, 2),
);

const env = { ...process.env };
for (const k of [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_COLOR',
]) {
  delete env[k];
}
const ptFile = join(run, 'prompt-tokens.txt');
writeFileSync(ptFile, String(ptAfter));
Object.assign(env, {
  HOME: join(run, 'home'),
  USERPROFILE: join(run, 'home'),
  QWEN_SANDBOX: 'false',
  QWEN_CODE_NO_RELAUNCH: '1',
  NODE_NO_WARNINGS: '1',
  LOG: join(run, 'requests.jsonl'),
  PROMPT_TOKENS_FILE: ptFile,
});

const fake = spawn(
  process.execPath,
  ['/root/verify/pr13390/harness/fake-model.cjs'],
  { env, stdio: ['ignore', 'pipe', 'inherit'] },
);
const url = await new Promise((resolve) => {
  let b = '';
  fake.stdout.on('data', (d) => {
    b += d;
    const m = b.match(/FAKE_SERVER_READY (\S+)/);
    if (m) resolve(m[1]);
  });
});

const child = spawn(
  process.execPath,
  [
    cli,
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--approval-mode',
    'yolo',
    '--auth-type',
    'openai',
    '--openai-api-key',
    'dummy',
    '--openai-base-url',
    url,
    '--model',
    'fake-model',
  ],
  { cwd: join(run, 'ws'), env, stdio: ['pipe', 'pipe', 'pipe'] },
);
let stderr = '';
child.stderr.on('data', (d) => {
  stderr += d;
  appendFileSync(join(run, 'stderr.log'), d);
});
child.on('exit', (code, sig) => {
  appendFileSync(join(run, 'stderr.log'), `\n[child exit ${code} ${sig}]\n`);
});
// Never outlive a hung run, and never leave the fake provider behind.
const killAll = () => {
  try { child.kill('SIGKILL'); } catch {}
  try { fake.kill('SIGKILL'); } catch {}
};
setTimeout(() => {
  appendFileSync(join(run, 'stderr.log'), '\n[harness watchdog]\n');
  killAll();
  process.exit(3);
}, 150000).unref();
process.on('unhandledRejection', (e) => {
  console.error(String(e));
  killAll();
  process.exit(2);
});

const frames = [];
const waiters = [];
createInterface({ input: child.stdout }).on('line', (line) => {
  let f;
  try {
    f = JSON.parse(line);
  } catch {
    return;
  }
  frames.push(f);
  appendFileSync(join(run, 'frames.jsonl'), line + '\n');
  if (f.type === 'control_request') {
    // Acknowledge anything the CLI asks so nothing stalls.
    child.stdin.write(
      JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: f.request_id,
          response: { behavior: 'allow', updatedInput: f.request?.input },
        },
      }) + '\n',
    );
  }
  for (const w of [...waiters]) {
    if (w.pred(f)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(f);
    }
  }
});
const waitFor = (pred, ms = 60000) =>
  new Promise((resolve, reject) => {
    const hit = frames.find(pred);
    if (hit) return resolve(hit);
    const timer = setTimeout(
      () => reject(new Error(`timeout; stderr=${stderr.slice(-2000)}`)),
      ms,
    );
    waiters.push({
      pred,
      resolve: (f) => {
        clearTimeout(timer);
        resolve(f);
      },
    });
  });

let rid = 0;
async function control(request) {
  const request_id = `req-${++rid}`;
  child.stdin.write(
    JSON.stringify({ type: 'control_request', request_id, request }) + '\n',
  );
  const f = await waitFor(
    (x) =>
      x.type === 'control_response' && x.response?.request_id === request_id,
  );
  if (f.response.subtype !== 'success') {
    throw new Error(JSON.stringify(f.response));
  }
  return f.response.response;
}

await control({ subtype: 'initialize', hooks: null });
// Give MCP discovery time to finish before the first measurement.
await new Promise((r) => setTimeout(r, 4000));
const before = await control({
  subtype: 'get_context_usage',
  show_details: true,
});

child.stdin.write(
  JSON.stringify({
    type: 'user',
    session_id: 'x',
    message: { role: 'user', content: 'Say hello.' },
    parent_tool_use_id: null,
  }) + '\n',
);
await waitFor((x) => x.type === 'result', 120000);
const after = await control({
  subtype: 'get_context_usage',
  show_details: true,
});
const init = frames.find((x) => x.type === 'system' && x.subtype === 'init');

child.stdin.end();
child.kill('SIGTERM');
fake.kill('SIGTERM');

const summarize = (u) => {
  const sum = (rows) => rows.reduce((s, r) => s + r.tokens, 0);
  return {
    totalTokens: u.totalTokens,
    isEstimated: u.isEstimated,
    breakdown: u.breakdown,
    mcpRows: u.mcpTools,
    mcpRowSum: sum(u.mcpTools),
    builtinRowSum: sum(u.builtinTools),
    builtinRowCount: u.builtinTools.length,
    memoryRowSum: sum(u.memoryFiles),
  };
};
const out = {
  arm,
  scenario,
  promptTokensAfter: Number(ptAfter),
  initTools: init?.tools,
  initMcpServers: init?.mcp_servers,
  before: summarize(before),
  after: summarize(after),
};
writeFileSync(join(run, 'result.json'), JSON.stringify(out, null, 2));
writeFileSync(
  join(run, 'raw-usage.json'),
  JSON.stringify({ before, after }, null, 2),
);
console.log(JSON.stringify(out));
process.exit(0);
