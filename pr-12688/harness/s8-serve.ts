// S8: `qwen serve` with "advisorMaxUses": -1 in user settings — does the
// daemon boot, and can a session be created?
import { spawn } from 'node:child_process';
import { ARMS, baseSettings, cliEnv, prepareDirs, withServer } from './lib.ts';

const arms = (process.env.ARMS ?? 'head,fix').split(',');
for (const arm of arms) {
  await withServer(({ body }) => (body['stream'] === true ? { content: 'ok' } : { content: '{}' }), async (server) => {
    const dirs = prepareDirs('s8-serve', arm, { userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', advisorMaxUses: -1 }) });
    const child = spawn('node', [ARMS[arm]!, 'serve', '--port', '0', '--token', 'T', '--workspace', dirs.ws], { cwd: dirs.ws, env: cliEnv(dirs.home, server.baseUrl), stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const t0 = Date.now();
    let port: string | undefined;
    while (Date.now() - t0 < 30000 && child.exitCode === null) {
      port = out.match(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/)?.[1];
      if (port) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    let session = 'n/a';
    if (port) {
      const r = await fetch(`http://127.0.0.1:${port}/session`, { method: 'POST', headers: { authorization: 'Bearer T', 'content-type': 'application/json' }, body: JSON.stringify({ cwd: dirs.ws }) });
      session = `${r.status} ${(await r.text()).slice(0, 220)}`;
    }
    console.log(`${arm}: boot=${port ? 'listening' : 'no'} exit=${child.exitCode} POST /session -> ${session}`);
    if (!port) console.log(out.slice(0, 600));
    child.kill('SIGTERM');
  });
}
