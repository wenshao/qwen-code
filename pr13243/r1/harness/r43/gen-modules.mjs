// VERIFICATION RIG ONLY (PR #13243): trusted function-hook handler modules whose top-level evaluation
// is the variable under test. Each module logs eval-start/eval-done to RIG_HOOK_LEDGER from top-level code.
import fs from 'node:fs';
const DIR = new URL('.', import.meta.url).pathname;
const head = (name) => `import fs from 'node:fs';
import path from 'node:path';
const LEDGER = process.env.RIG_HOOK_LEDGER;
const log = (e) => LEDGER && fs.appendFileSync(LEDGER, JSON.stringify({ t: Date.now(), pid: process.pid, module: ${JSON.stringify(name)}, ...e }) + '\\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
log({ kind: 'eval-start' });
`;
const tail = (name) => `
log({ kind: 'eval-done' });
export const registered = {
  handlerRevision: 1,
  async callback(input) {
    log({ kind: 'callback', event: input.hook_event_name, session: input.session_id });
    return { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: 'R43-CTX-${name}' } };
  },
  onHookSuccess() {},
};
`;
const bodies = {
  hang: `await new Promise(() => {});\n`,
  gate1: `const GATE = path.join(path.dirname(LEDGER), 'r43-gate-gate1');\nwhile (!fs.existsSync(GATE)) await sleep(50);\n`,
  gate2: `const GATE = path.join(path.dirname(LEDGER), 'r43-gate-gate2');\nwhile (!fs.existsSync(GATE)) await sleep(50);\n`,
  gate3: `const GATE = path.join(path.dirname(LEDGER), 'r43-gate-gate3');\nwhile (!fs.existsSync(GATE)) await sleep(50);\n`,
  gate4: `const GATE = path.join(path.dirname(LEDGER), 'r43-gate-gate4');\nwhile (!fs.existsSync(GATE)) await sleep(50);\n`,
  gate5: `const GATE = path.join(path.dirname(LEDGER), 'r43-gate-gate5');\nwhile (!fs.existsSync(GATE)) await sleep(50);\n`,
  slow300: `await sleep(300);\n`,
  slow1500: `await sleep(1500);\n`,
  slow1500b: `await sleep(1500);\n`,
  broken: `throw new Error('r43 broken module');\n`,
};
for (const [name, body] of Object.entries(bodies)) fs.writeFileSync(`${DIR}${name}.mjs`, head(name) + body + tail(name));
console.log(`wrote ${Object.keys(bodies).length} modules to ${DIR}`);
