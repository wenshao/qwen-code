// Real-CLI A/B for R1-20: a Legacy session (recorded by the bundled CLI)
// gets a manual custom_title record; in one copy raw header-marker bytes are
// glued onto that line (torn append). Each arm's `qwen sessions list --json`
// then reports the title.
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { startFakeOpenAIServer } from '../integration-tests/fake-openai-server.js';

const RESULTS = '/Users/wenshao/git/pr13332-rig/results/r2-glued-title.tsv';
const server = await startFakeOpenAIServer(async () => ({ content: 'ok from fake model' }));
const root = mkdtempSync('/private/tmp/claude-501/p13332-title-');
const env = (home: string) => {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/_proxy$/i.test(k)) e[k] = v;
  return { ...e, HOME: home, QWEN_HOME: path.join(home, '.qwen'), NO_PROXY: '127.0.0.1,localhost' };
};
const cli = (arm: string) => `/Users/wenshao/git/pr13332-${arm}/dist/cli.js`;
const model = ['--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', server.baseUrl, '--model', 'dummy'];
async function run(arm: string, home: string, cwd: string, args: string[]) {
  const child = spawn(process.execPath, [cli(arm), ...args], { cwd, env: env(home), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => (stdout += d)); child.stderr.on('data', (d) => (stderr += d));
  const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
  const status = await new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
  clearTimeout(timer);
  child.stdin.end();
  return { status, stdout, stderr };
}
const find = (dir: string): string[] => { const o: string[] = []; const w = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) w(p); else if (p.endsWith('.jsonl') && p.includes(`${path.sep}chats${path.sep}`)) o.push(p); } }; w(dir); return o; };
const seedHome = path.join(root, 'seed-home'); const cwd = path.join(root, 'project');
mkdirSync(seedHome, { recursive: true }); mkdirSync(cwd, { recursive: true });
const seed = await run('base', seedHome, cwd, ['-p', 'hello', '--output-format', 'json', ...model]);
const [seedTranscript] = find(path.join(seedHome, '.qwen'));
if (seed.status !== 0 || !seedTranscript) { console.log('seed failed', seed.status, seed.stderr.slice(-500)); process.exit(2); }
const sessionId = path.basename(seedTranscript, '.jsonl');
const lines = readFileSync(seedTranscript, 'utf8').trimEnd().split('\n');
const last = JSON.parse(lines.at(-1)!);
const title = JSON.stringify({ uuid: randomUUID(), parentUuid: last.uuid ?? null, sessionId, timestamp: new Date().toISOString(), type: 'system', subtype: 'custom_title', customTitle: 'Legacy title', titleSource: 'manual', cwd: last.cwd, version: last.version });
const shapes: Record<string, string> = {
  'title-clean': `${lines.join('\n')}\n${title}\n`,
  'title-glued-marker': `${lines.join('\n')}\n${title} and the raw bytes "subtype":"managed_session_header_v1" landed here\n`,
};
for (const arm of ['base', 'head', 'merge']) {
  for (const [shape, text] of Object.entries(shapes)) {
    const home = path.join(root, `${arm}-${shape}`, 'home');
    cpSync(seedHome, home, { recursive: true });
    writeFileSync(seedTranscript.replace(seedHome, home), text);
    const r = await run(arm, home, cwd, ['sessions', 'list', '--json']);
    const row = r.stdout.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return undefined; } }).find((x) => x && (x.sessionId === sessionId || x.id === sessionId));
    const out = `${arm}\t${shape}\texit=${r.status}\ttitle=${JSON.stringify(row?.title ?? row?.customTitle ?? null)}\tfields=${row ? Object.keys(row).join(',') : 'NO-ROW'}\t${r.stderr.trim().split('\n').slice(-1)[0]?.slice(0, 160) ?? ''}`;
    console.log(`RESULT\t${out}`);
    appendFileSync(RESULTS, out + '\n');
  }
}
await server.close();
process.exit(0);
