// Tap variants: route Spring -> Harness through the runner's own recording
// proxy (holdExecutionStart=false, so it only forwards and records non-2xx
// bodies). Used only on arms that fail at Harness POST /session, because the
// proxy buffers whole responses and would stall a streaming exchange.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const scripts = '/Users/wenshao/git/pr13263-head/scripts';
function replace(text, from, to) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor matched ${n} times: ${from.slice(0, 120)}`);
  return text.replace(from, () => to);
}
function tap(text) {
  text = replace(
    text,
    'let heldStartProxy: HeldExecutionStartProxy | undefined;\n',
    'let heldStartProxy: HeldExecutionStartProxy | undefined;\nlet harnessTap: HeldExecutionStartProxy | undefined;\n',
  );
  text = replace(
    text,
    '  const spring = start(\n',
    '  harnessTap = await startHeldExecutionStartProxy(\n    `http://127.0.0.1:${harnessPort}`,\n    false,\n  );\n  const spring = start(\n',
  );
  text = replace(
    text,
    '        QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${harnessPort}`,\n',
    '        QWEN_MANAGED_AGENT_HARNESS_BASE_URL: harnessTap.baseUrl,\n',
  );
  text = replace(
    text,
    '  await heldStartProxy?.close();\n  await replacementBrokerProxy?.close();',
    "  console.error('TAP Spring->Harness ' + JSON.stringify(harnessTap?.observations() ?? []));\n  await harnessTap?.close();\n  await heldStartProxy?.close();\n  await replacementBrokerProxy?.close();",
  );
  return text;
}
for (const name of ['base-obs', 'm1-no-session-store', 'm2-no-broker-flags']) {
  const source = readFileSync(path.join(scripts, `e2e-v-${name}.ts`), 'utf8');
  const out = path.join(scripts, `e2e-v-${name}-tap.ts`);
  writeFileSync(out, tap(source));
  console.log(out);
}
