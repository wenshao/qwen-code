// S5: the trusted-actor header on the packaged server (real Spring + MySQL). Admission only: the
// question is which requests get an actor principal, so no Harness is started.
// usage: tsx s5-actor.ts <label> <on|off>
import { createRig, freePort } from './stack.js';

const label = process.argv[2] ?? 's5';
const enabled = process.argv[3] !== 'off';
const rig = await createRig({ label, workspace: true });
let failure: unknown;
try {
  await rig.startModel(() => ({ content: 'unused' }));
  const spring = await rig.startSpring('A', {
    harnessUrl: `http://127.0.0.1:${await freePort()}`,
    extraEnv: enabled ? {} : { QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: '' },
  });
  const H = 'x-qwen-e2e-trusted-actor';
  const create = async (name: string, headers: Record<string, string>, bound: boolean) => {
    const response = await fetch(`${spring.url}/v1/agents/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `s5-${name}-${Date.now()}`, ...headers },
      body: JSON.stringify({
        agent_id: 'qwen-code',
        input: [{ type: 'text', text: 'S5' }],
        ...(bound ? { workspace: { workspace_id: 'e2e-workspace' } } : {}),
      }),
    });
    const text = await response.text();
    let code = '';
    try {
      code = (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? '';
    } catch {
      // not JSON
    }
    return `${response.status}${code ? ` ${code}` : ''}`;
  };
  const T = { 'x-qwen-tenant-id': rig.tenant };
  const result = {
    label,
    platform: process.platform,
    db: rig.dbVersion,
    property: enabled ? `qwen.managed-agent.trusted-actor-header=${H}` : 'qwen.managed-agent.trusted-actor-header unset (default)',
    'bound create, granted actor in header': await create('granted', { ...T, [H]: 'e2e-actor' }, true),
    'bound create, no actor header': await create('none', T, true),
    'bound create, blank actor header': await create('blank', { ...T, [H]: '  ' }, true),
    'bound create, actor without a grant': await create('intruder', { ...T, [H]: 'intruder' }, true),
    'bound create, granted actor but another tenant': await create(
      'cross',
      { 'x-qwen-tenant-id': 'other-tenant', [H]: 'e2e-actor' },
      true,
    ),
    'bound create, actor in a different header name': await create(
      'othername',
      { ...T, 'x-qwen-actor-id': 'e2e-actor' },
      true,
    ),
    'unbound create, no actor header': await create('unbound', T, false),
    'unbound create, actor header present': await create('unbound-actor', { ...T, [H]: 'e2e-actor' }, false),
    'workspace discovery, granted actor': String(
      (await fetch(`${spring.url}/v1/agents/workspaces`, { headers: { ...T, [H]: 'e2e-actor' } })).status,
    ),
    'workspace discovery, no actor': String(
      (await fetch(`${spring.url}/v1/agents/workspaces`, { headers: T })).status,
    ),
    'actuator health with actor header only (no tenant)': String(
      (await fetch(`${spring.url}/actuator/health`, { headers: { [H]: 'e2e-actor' } })).status,
    ),
  };
  rig.save('result.json', result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await rig.cleanup();
}
if (failure) process.exit(1);
