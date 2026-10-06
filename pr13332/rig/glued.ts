// Real-CLI A/B for the glued-marker finding: a real Legacy session is created
// by the bundled CLI, a torn append leaves raw header-marker text glued onto
// one of its lines, and each arm's bundled CLI then tries the Legacy
// `--resume` path against a copy of that exact transcript.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { startFakeOpenAIServer } from '../integration-tests/fake-openai-server.js';

const RESULTS = '/Users/wenshao/git/pr13332-rig/results/glued.tsv';
const server = await startFakeOpenAIServer(async () => ({ content: 'ok from fake model' }));
const base = server.baseUrl ?? (server as unknown as { url: string }).url;
const root = mkdtempSync('/private/tmp/claude-501/p13332-glued-');
const env = (home: string) => {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/_proxy$/i.test(k)) e[k] = v;
  return { ...e, HOME: home, QWEN_HOME: path.join(home, '.qwen'), NO_PROXY: '127.0.0.1,localhost' };
};
const cli = (arm: string) => `/Users/wenshao/git/pr13332-${arm}/dist/cli.js`;
const args = ['--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', base, '--model', 'dummy', '--output-format', 'json'];
// stdin stays open (a headless run whose stdin is at EOF cancels its own
// turn with exit 130 before any model call, on every arm).
async function run(arm: string, home: string, cwd: string, extra: string[]) {
  const child = spawn(process.execPath, [cli(arm), ...extra, ...args], { cwd, env: env(home), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => (stdout += d)); child.stderr.on('data', (d) => (stderr += d));
  const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
  const status = await new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
  clearTimeout(timer);
  return { status, stdout, stderr };
}
function findTranscripts(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.jsonl') && p.includes(`${path.sep}chats${path.sep}`)) out.push(p); } };
  walk(dir);
  return out;
}
// 1. A real Legacy session, recorded by the base bundle.
const seedHome = path.join(root, 'seed-home'); const seedCwd = path.join(root, 'project');
mkdirSync(seedHome, { recursive: true }); mkdirSync(seedCwd, { recursive: true });
const seed = await run('base', seedHome, seedCwd, ['-p', 'hello']);
const transcripts = findTranscripts(path.join(seedHome, '.qwen'));
if (transcripts.length !== 1) { console.log(seed.status, seed.stdout, seed.stderr, transcripts); process.exit(2); }
console.log(`seed exit=${seed.status} stdout=${JSON.stringify(seed.stdout.trim().slice(0, 80))} stderrTail=${JSON.stringify(seed.stderr.trim().slice(-300))}`);
const seedTranscript = transcripts[0]!;
const sessionId = path.basename(seedTranscript, '.jsonl');
// 2. Shapes: as recorded; a torn append that glued raw marker bytes onto the
// first user line (the PR's test shape); and a control whose marker is only
// quoted inside a JSON string (escaped quotes) — never Managed on any arm.
const original = readFileSync(seedTranscript, 'utf8');
const lines = original.split('\n');
const userIdx = lines.findIndex((l) => l.includes('"type":"user"'));
const shapes: Record<string, string> = {
  'as-recorded': original,
  'glued-marker-tail': lines.map((l, i) => (i === userIdx ? `${l} and the raw bytes "subtype":"managed_session_header_v1" landed here` : l)).join('\n'),
};
for (const arm of ['base', 'head', 'merge']) {
  for (const [shape, text] of Object.entries(shapes)) {
    const home = path.join(root, `${arm}-${shape}`, 'home');
    cpSync(seedHome, home, { recursive: true });
    const t = seedTranscript.replace(seedHome, home);
    writeFileSync(t, text);
    const before = readFileSync(t, 'utf8');
    const reqs0 = server.requests.length;
    const r = await run(arm, home, seedCwd, ['--resume', sessionId, '-p', 'continue please']);
    const after = readFileSync(t, 'utf8');
    const modelCalls = server.requests.length - reqs0;
    const err = (r.stderr || '').split('\n').filter((l) => /managed|refus|Managed|Error/i.test(l)).slice(0, 2).join(' / ').slice(0, 220);
    const row = `${arm}\t${shape}\texit=${r.status}\tmodelCalls=${modelCalls}\ttranscript ${before === after ? 'UNCHANGED' : `+${after.length - before.length} B`}\tstdout=${JSON.stringify(r.stdout.trim().slice(0, 40))}\t${err}`;
    console.log(`RESULT\t${row}`);
    appendFileSync(RESULTS, row + '\n');
  }
}
await server.close();
process.exit(0);
