// Mutation matrix for the PR #13141 help-text test.
// Usage: node mutate.mjs <tree> <label> [testFile]
// Applies each mutant to packages/cli/src/commands/serve.ts (exactly one hit
// per replacement), runs the Broker help test, records killed/survived, and
// restores the original bytes after every mutant.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [tree, label, testFile = 'src/commands/serve.test.ts'] = process.argv.slice(2);
const cliDir = path.join(tree, 'packages/cli');
const target = path.join(cliDir, 'src/commands/serve.ts');
const original = readFileSync(target, 'utf8');
const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'results', `mutants-${label}.jsonl`);

const NEW_URL = 'Private Broker URL for --profile hosted-harness; required together with token for Workspace tool turns.';
const NEW_TOK = 'Private Broker credential for --profile hosted-harness; required together with URL for Workspace tool turns.';
const OLD_URL = 'Reserved Broker URL for --profile hosted-harness; not implemented and rejects startup.';
const OLD_TOK = 'Reserved Broker credential for --profile hosted-harness; not implemented and rejects startup.';
const SWAP = '\u0000';

const MUTANTS = [
  { id: 'M0', what: 'no change (control)', edits: [] },
  { id: 'M1', what: 'URL help reverted to the stale text', edits: [[NEW_URL, OLD_URL]] },
  { id: 'M2', what: 'token help reverted to the stale text', edits: [[NEW_TOK, OLD_TOK]] },
  { id: 'M3', what: 'both reverted (= base serve.ts)', edits: [[NEW_URL, OLD_URL], [NEW_TOK, OLD_TOK]] },
  { id: 'M4', what: 'URL option hidden from help', edits: [["      .option('managed-runtime-broker-url', {\n        type: 'string',", "      .option('managed-runtime-broker-url', {\n        hidden: true,\n        type: 'string',"]] },
  { id: 'M5', what: 'stale claim re-added without "Reserved": "...; not implemented and rejects startup."', edits: [[NEW_URL, 'Private Broker URL for --profile hosted-harness; not implemented and rejects startup.'], [NEW_TOK, 'Private Broker credential for --profile hosted-harness; not implemented and rejects startup.']] },
  { id: 'M6', what: 'URL and token descriptions swapped', edits: [[NEW_URL, SWAP], [NEW_TOK, NEW_URL], [SWAP, NEW_TOK]] },
  { id: 'M7', what: 'scope dropped: "Private Broker URL." / "Private Broker credential."', edits: [[NEW_URL, 'Private Broker URL.'], [NEW_TOK, 'Private Broker credential.']] },
  { id: 'M8', what: 'pairing claim inverted: "optional; either may be set alone"', edits: [[NEW_URL, 'Private Broker URL for --profile hosted-harness; optional, may be set without a token.'], [NEW_TOK, 'Private Broker credential for --profile hosted-harness; optional, may be set without a URL.']] },
  { id: 'M9', what: 'stale claim appended after the correct sentence', edits: [[NEW_TOK, NEW_TOK + ' Not implemented; rejects startup.']] },
];

const results = [];
try {
  for (const m of MUTANTS) {
    let text = original;
    for (const [from, to] of m.edits) {
      const hits = text.split(from).length - 1;
      if (hits !== 1) throw new Error(`${m.id}: expected 1 hit for ${JSON.stringify(from.slice(0, 40))}, got ${hits}`);
      text = text.replace(from, to);
    }
    writeFileSync(target, text);
    const r = spawnSync('npx', ['vitest', 'run', '--coverage.enabled=false', testFile, '-t', 'Hosted Runtime Broker'], {
      cwd: cliDir, encoding: 'utf8', env: process.env, maxBuffer: 64 << 20,
    });
    const log = (r.stdout ?? '') + (r.stderr ?? '');
    const tests = log.match(/Tests\s+([^\n]+)/)?.[1]?.trim() ?? '?';
    const reason = log.match(/AssertionError: ([^\n]+)/)?.[1]?.slice(0, 160);
    const ranOne = /1 (passed|failed)/.test(tests);
    const verdict = !ranOne ? 'ERROR' : r.status === 0 ? 'survived' : 'killed';
    const row = { label, id: m.id, what: m.what, verdict, exit: r.status, tests, reason };
    results.push(row);
    appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(`${m.id} ${verdict.padEnd(8)} ${m.what}${reason ? `\n     ${reason}` : ''}`);
    writeFileSync(target, original);
  }
} finally {
  writeFileSync(target, original);
}
