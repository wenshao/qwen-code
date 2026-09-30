// VERIFICATION RIG ONLY (PR #13117): apply one named mutant to a worktree, fail closed if the edit did not land.
// usage: node mut.mjs <worktree> <mutant-id>
import { readFileSync, writeFileSync } from 'node:fs';

const [wt, id] = process.argv.slice(2);
const FILTER = `${wt}/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/api/TenantContextFilter.java`;
const SPEC = `${wt}/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json`;

function edit(file, from, to) {
  const text = readFileSync(file, 'utf8');
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${id}: expected exactly one match in ${file}, found ${n}`);
  writeFileSync(file, text.replace(from, to));
}
const SKIP = (prefix) => edit(FILTER,
  'return !path.startsWith("/v1/agents/")',
  `return path.startsWith("${prefix}") || !path.startsWith("/v1/agents/")`);

const BYPASS = (test) => edit(FILTER,
  `            if (!tenantId.equals(actor.tenantId())
                    || !validActorId(tenantId, claimedActorId)) {`,
  `            if ((!tenantId.equals(actor.tenantId())
                    || !validActorId(tenantId, claimedActorId))
                    && !request.getRequestURI().${test}) {`);

function spec(mutate) {
  const text = readFileSync(SPEC, 'utf8');
  const json = JSON.parse(text);
  mutate(json);
  writeFileSync(SPEC, JSON.stringify(json, null, 2) + '\n');
}
function op(json, operationId) {
  for (const item of Object.values(json.paths)) for (const o of Object.values(item)) if (o?.operationId === operationId) return o;
  throw new Error(`${id}: no operation ${operationId}`);
}
function drop403(operationId) {
  spec((json) => {
    const o = op(json, operationId);
    if (!o.responses['403']) throw new Error(`${id}: ${operationId} has no 403`);
    delete o.responses['403'];
  });
}

const MUTANTS = {
  F1: () => edit(FILTER, '"actor_scope_mismatch",', '"actor_scope_denied",'),
  F2: () => edit(FILTER, 'response.setStatus(HttpServletResponse.SC_FORBIDDEN);', 'response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);'),
  F3: () => SKIP('/api/agent/web-shell/v1/events/stream'),
  F4: () => SKIP('/v1/agents/workspaces'),
  F5: () => SKIP('/api/agent/web-shell/v1/transcript/'),
  F6: () => SKIP('/api/agent/web-shell/v1/turns/'),
  F7: () => edit(FILTER, 'return !path.startsWith("/v1/agents/")', 'return path.endsWith("/items") || !path.startsWith("/v1/agents/")'),
  G3: () => BYPASS('startsWith("/api/agent/web-shell/v1/events/stream")'),
  G4: () => BYPASS('startsWith("/v1/agents/workspaces")'),
  G5: () => BYPASS('startsWith("/api/agent/web-shell/v1/transcript/")'),
  G6: () => BYPASS('startsWith("/api/agent/web-shell/v1/turns/")'),
  G7: () => BYPASS('endsWith("/items")'),
  G8: () => BYPASS('endsWith("/events")'),
  C0: () => spec(() => {}),
  C1: () => drop403('getAgent'),
  C2: () => drop403('webShellTranscript'),
  C3: () => drop403('listItems'),
  C4: () => spec((json) => { op(json, 'getSessionEvents').responses['403'] = { $ref: '#/components/responses/NotFound' }; }),
  C5: () => drop403('webShellChangeCwd'),
};
if (!MUTANTS[id]) throw new Error(`unknown mutant ${id}`);
MUTANTS[id]();
console.log(`applied ${id}`);
