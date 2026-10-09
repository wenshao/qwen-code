// `qwen --resume "<title>"` on the glued/clean title copies made by glued-title.ts.
import { spawn } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { startFakeOpenAIServer } from '../integration-tests/fake-openai-server.js';
const D = process.argv[2];
const server = await startFakeOpenAIServer(async () => ({ content: 'resumed ok' }));
const env = (home: string) => { const e: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/_proxy$/i.test(k)) e[k] = v; return { ...e, HOME: home, QWEN_HOME: path.join(home, '.qwen'), NO_PROXY: '127.0.0.1,localhost' }; };
for (const dir of readdirSync(D).filter((d) => /-(title-clean|title-glued-marker)$/.test(d)).sort()) {
  const arm = dir.split('-')[0];
  const home = path.join(D, dir, 'home');
  const reqs0 = server.requests.length;
  const child = spawn(process.execPath, [`/Users/wenshao/git/pr13332-${arm}/dist/cli.js`, '--resume', 'Legacy title', '-p', 'continue', '--output-format', 'json', '--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', server.baseUrl, '--model', 'dummy'], { cwd: path.join(D, 'project'), env: env(home), stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
  const t = setTimeout(() => child.kill('SIGKILL'), 120_000);
  const status = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  clearTimeout(t); child.stdin.end();
  const line = `${dir}\texit=${status}\tmodelCalls=${server.requests.length - reqs0}\t${err.trim().split('\n').filter((l) => !/Warning|YOLO/.test(l)).slice(-1)[0]?.slice(0, 200) ?? ''}`;
  console.log('RESULT\t' + line);
  appendFileSync('/Users/wenshao/git/pr13332-rig/results/r2-resume-title.tsv', line + '\n');
}
await server.close(); process.exit(0);
