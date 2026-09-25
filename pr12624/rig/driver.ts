// PR #12624 real-TUI A/B driver. Usage: ARM=head|base npx tsx driver.ts
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeOpenAIServer } from '../integration-tests/fake-openai-server.js';
import { TerminalCapture } from '../integration-tests/terminal-capture/terminal-capture.js';

const ARM = process.env.ARM!;
const CLI = process.env.CLI_OVERRIDE ?? `${process.env.HOME}/git/pr12624-${ARM}/dist/cli.js`;
const OUT = process.env.OUT!;
const ROOT = process.env.RIG!; // isolated root
rmSync(ROOT, { recursive: true, force: true });
const HOMEDIR = join(ROOT, 'qhome'), WS = join(ROOT, 'ws');
mkdirSync(HOMEDIR, { recursive: true }); mkdirSync(WS, { recursive: true });
writeFileSync(join(WS, 'README.md'), 'rig\n');
writeFileSync(join(HOMEDIR, 'settings.json'), JSON.stringify({ security: { auth: { selectedType: 'openai' } }, ui: { hideTips: true }, general: { disableAutoUpdate: true } }));

const log: string[] = [];
const fake = await startFakeOpenAIServer(({ body }) => {
  const msgs = (body['messages'] as any[]) ?? [];
  const tools = ((body['tools'] as any[]) ?? []).length;
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const text = JSON.stringify(lastUser?.content ?? '');
  let usage = { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } as any;
  let content = 'aux';
  if (tools > 5 && text.includes('SESSION-B')) {
    usage = { prompt_tokens: 12_000, completion_tokens: 30, total_tokens: 12_030, prompt_tokens_details: { cached_tokens: 11_000 } };
    content = 'Reply for session B.';
  } else if (tools > 5 && text.includes('SESSION-A')) {
    usage = { prompt_tokens: 65_267, completion_tokens: 40, total_tokens: 65_307, prompt_tokens_details: { cached_tokens: 64_653 } };
    content = 'Reply for session A.';
  }
  log.push(`tools=${tools} marker=${text.includes('SESSION-A') ? 'A' : text.includes('SESSION-B') ? 'B' : '-'} usage=${JSON.stringify(usage)}`);
  return { content, usage };
});

const env: Record<string, string> = {
  PATH: process.env.PATH!, HOME: process.env.HOME!, TERM: 'xterm-256color', FORCE_COLOR: '1', NODE_NO_WARNINGS: '1', LANG: 'en_US.UTF-8',
  QWEN_HOME: HOMEDIR, QWEN_RUNTIME_DIR: HOMEDIR, OPENAI_API_KEY: 'dummy', ...(process.env.PR12624_PROBE ? { PR12624_PROBE: process.env.PR12624_PROBE } : {}),
};
const args = ['--auth-type', 'openai', '--openai-api-key', 'dummy', '--openai-base-url', fake.baseUrl, '--model', 'dummy', '--approval-mode', 'yolo'];

// Phase 1: record session B headlessly
const r = await new Promise<{status:number|null;stdout:string;stderr:string}>((res) => { const c = spawn("node", [CLI, ...args, "-p", "SESSION-B: say hi"], { cwd: WS, env, stdio: ["ignore", "pipe", "pipe"] }); let o = "", e = ""; c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", (d) => (e += d)); c.on("close", (status) => res({ status, stdout: o, stderr: e })); });
log.push(`B exit=${r.status} out=${r.stdout.trim().slice(0, 80)} err=${r.stderr.trim().slice(0, 200)}`);
const find = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? find(p) : [p]; });
const chats = find(HOMEDIR).filter((p) => p.endsWith('.jsonl') && p.includes('chats'));
const bId = chats[0]?.split('/').pop()!.replace('.jsonl', '');
log.push(`B session=${bId} files=${chats.length}`);

// Phase 2: live TUI session A -> /context -> /resume B -> /context
const t = await TerminalCapture.create({ cols: 110, rows: 42, cwd: WS, env, theme: 'github-dark', chrome: true, title: `qwen — PR #12624 ${ARM}`, outputDir: OUT });
await t.spawn('node', [CLI, ...args]);
await t.waitFor('Type your message', { timeout: 60_000 }).catch(() => {});
await t.idle(1500, 20_000);
await t.type('SESSION-A: say hi\n');
await t.waitFor('Reply for session A', { timeout: 60_000 });
await t.idle(1500, 20_000);
await t.type('/context\n');
await t.waitFor('Messages', { timeout: 30_000 }).catch(() => {});
await t.idle(1500, 20_000);
writeFileSync(join(OUT, `${ARM}-1-sessionA-context.txt`), await t.getScreenText());
await t.capture(`${ARM}-1-sessionA-context.png`);
await t.type(`/resume ${bId}\n`);
await t.idle(3000, 30_000);
writeFileSync(join(OUT, `${ARM}-2-after-resume.txt`), await t.getScreenText());
await t.type('/context\n');
await t.idle(2000, 20_000);
writeFileSync(join(OUT, `${ARM}-3-resumedB-context.txt`), await t.getScreenText());
await t.capture(`${ARM}-3-resumedB-context.png`);
writeFileSync(join(OUT, `${ARM}-raw.txt`), t.getOutput());
await t.close();
const aId = find(HOMEDIR).filter((p) => p.endsWith(".jsonl") && p.includes("chats")).map((p) => p.split("/").pop()!.replace(".jsonl", "")).find((id) => id !== bId)!;
log.push("A session=" + aId);
const t2 = await TerminalCapture.create({ cols: 110, rows: 42, cwd: WS, env, theme: "github-dark", chrome: true, title: "qwen --resume (A) — PR #12624 " + ARM, outputDir: OUT });
await t2.spawn("node", [CLI, ...args, "--resume", aId]);
await t2.waitFor("Reply for session A", { timeout: 60_000 }).catch(() => {});
await t2.idle(2000, 20_000);
await t2.type("/context\n");
await t2.idle(2000, 20_000);
writeFileSync(join(OUT, ARM + "-4-freshResumeA-context.txt"), await t2.getScreenText());
await t2.capture(ARM + "-4-freshResumeA-context.png");
await t2.close();
writeFileSync(join(OUT, `${ARM}-log.txt`), log.join('\n') + '\n');
console.log(log.join('\n'));
process.exit(0);
