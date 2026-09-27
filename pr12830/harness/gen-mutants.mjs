// Feed mutated copies of the spec to the real WebShell generator (no files touched).
import { readFileSync } from 'node:fs';
const W = '$HEAD_WORKTREE/packages/web-shell';
const { webShellContract } = await import(W + '/scripts/generate-managed-agent-api.mjs');
const { default: openapiTS, astToString } = await import('$HEAD_WORKTREE/node_modules/openapi-typescript/dist/index.mjs');
const SPEC = '$HEAD_WORKTREE/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json';
const committed = readFileSync(W + '/client/components/managed/generated/managed-agent-api.ts', 'utf8');
const HEADER = committed.split('\n').slice(0, 2).join('\n') + '\n';
const render = async (spec) => HEADER + astToString(await openapiTS(webShellContract(spec), { defaultNonNullable: false }));
const diff = (a, b) => { const A = a.split('\n'), B = new Set(b.split('\n')); const add = A.filter((l) => !b.split('\n').includes(l)); return add; };
const load = () => JSON.parse(readFileSync(SPEC, 'utf8'));
const S = 'x-qwen-implementation-status';
const mutants = {
  'M0 unmodified spec': (s) => s,
  'M7 cancelWebShellTask partial': (s) => { s.paths['/api/agent/web-shell/v1/tasks/cancel'].post[S] = 'partial'; return s; },
  'M8 WebShellSession.capabilities.tasks unmarked': (s) => { delete s.components.schemas.WebShellSession.properties.capabilities.properties.tasks[S]; return s; },
  'M9 queryWebShellTasks partial': (s) => { s.paths['/api/agent/web-shell/v1/tasks/query'].post[S] = 'partial'; return s; },
  'M10 archiveWebShellSession partial (task_cancel enum reach)': (s) => { s.paths['/api/agent/web-shell/v1/sessions/archive'].post[S] = 'partial'; return s; },
};
for (const [name, f] of Object.entries(mutants)) {
  const out = await render(f(load()));
  const added = diff(out, committed), removed = diff(committed, out);
  console.log(`${name}: identical=${out === committed} +${added.length} -${removed.length}`);
  const hits = added.filter((l) => /task_cancel|taskId|tasks\??:|"\/tasks/.test(l)).slice(0, 6);
  for (const l of hits) console.log('    ' + l.trim().slice(0, 140));
}
