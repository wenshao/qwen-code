// S1: triage finding 1 — does a hand-edited advisorMaxUses stop the CLI
// from starting? Real bundled CLI, isolated HOME, -p one-shot prompt.
import { writeFileSync } from 'node:fs';
import { baseSettings, prepareDirs, runCli, withServer } from './lib.ts';

const arms = (process.env.ARMS ?? 'head,base').split(',');
const cases: Array<{ label: string; scope: 'user' | 'system' | 'workspace'; extra: Record<string, unknown> }> = [
  { label: 'valid 2', scope: 'user', extra: { advisorMaxUses: 2 } },
  { label: 'user -1', scope: 'user', extra: { advisorMaxUses: -1 } },
  { label: 'user 1.5', scope: 'user', extra: { advisorMaxUses: 1.5 } },
  { label: 'user "5"', scope: 'user', extra: { advisorMaxUses: '5' } },
  { label: 'user null', scope: 'user', extra: { advisorMaxUses: null } },
  { label: 'system -1', scope: 'system', extra: { advisorMaxUses: -1 } },
  { label: 'workspace -1', scope: 'workspace', extra: { advisorMaxUses: -1 } },
  { label: 'user -1, advisor off', scope: 'user', extra: { advisorMaxUses: -1, advisorModel: 'off' } },
  { label: 'control visionBridgeTimeoutMs -1', scope: 'user', extra: { visionBridgeTimeoutMs: -1 } },
];

const rows: string[] = [];
const out: unknown[] = [];
for (const arm of arms) {
  for (const c of cases) {
    await withServer(
      ({ body }) => (body['stream'] === true ? { content: 'STARTED_OK' } : { content: '{}' }),
      async (server) => {
        const common = baseSettings(server.baseUrl, { advisorModel: 'advisor-model' });
        const user = c.scope === 'user' ? { ...common, ...c.extra } : common;
        const dirs = prepareDirs(`s1-${c.label.replace(/[^a-z0-9]+/gi, '_')}`, arm, {
          userSettings: user,
          workspaceSettings: c.scope === 'workspace' ? c.extra : undefined,
          systemSettings: c.scope === 'system' ? c.extra : undefined,
        });
        const r = await runCli(arm, dirs, server.baseUrl, ['--yolo', '--auth-type', 'openai', '--model', 'executor-model', '--prompt', 'say hi'], undefined, 60_000);
        const started = r.stdout.includes('STARTED_OK');
        const errLine = (r.stderr.split('\n').find((l) => /advisorMaxUses|Error/.test(l)) ?? '').slice(0, 160);
        rows.push(`${arm.padEnd(5)} | ${c.label.padEnd(34)} | exit=${String(r.code).padEnd(4)} | model requests=${server.requests.length} | reply=${started ? 'yes' : 'NO '} | ${errLine}`);
        out.push({ arm, case: c.label, code: r.code, requests: server.requests.length, started, stderr: r.stderr.slice(0, 4000), stdout: r.stdout.slice(0, 2000) });
      },
    );
  }
}
console.log(rows.join('\n'));
writeFileSync(`/root/verify/pr12688/runs/s1-startup-${arms.join('_')}.json`, JSON.stringify(out, null, 2));
