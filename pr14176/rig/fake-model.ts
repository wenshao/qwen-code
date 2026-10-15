// Deterministic OpenAI-compatible model for the operator walk-through.
// Dispatches on markers in the request text, never on request order.
import { appendFileSync } from 'node:fs';
import { startFakeOpenAIServer } from '/rig/cli/integration-tests/fake-openai-server.ts';
const log = process.argv[2] ?? '/rig/op/fake-model.log';
function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
  return '';
}
const server = await startFakeOpenAIServer(({ body, requestIndex }) => {
  const messages = (body['messages'] as any[]) ?? [];
  const users = messages.filter((m) => m?.role === 'user').map((m) => text(m.content));
  const all = messages.map((m) => text(m?.content)).join('\n');
  const last = users.at(-1) ?? '';
  let content = 'AUX_OK';
  if (last.includes('REF_TURN_ONE')) content = 'REFERENCE_TURN_ONE_OK';
  else if (last.includes('REF_TURN_TWO')) content = all.includes('REFERENCE_TURN_ONE_OK') ? 'REFERENCE_TURN_TWO_SAW_CONTEXT' : 'REFERENCE_TURN_TWO_CONTEXT_MISSING';
  else if (last.includes('REF_TURN_THREE')) content = all.includes('REFERENCE_TURN_TWO_SAW_CONTEXT') ? 'REFERENCE_TURN_THREE_AFTER_RESTART_OK' : 'REFERENCE_TURN_THREE_CONTEXT_MISSING';
  appendFileSync(log, `${new Date().toISOString()} #${requestIndex} model=${body['model']} msgs=${messages.length} reply=${content}\n`);
  return { content };
}, { listenHost: '127.0.0.1', baseUrlHost: '127.0.0.1' });
console.log(server.baseUrl);
