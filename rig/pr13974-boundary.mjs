// Offline: the largest ASCII plan submitPlan admits for alice's real launch envelope.
import { readFileSync } from 'node:fs';
const records = await import('./packages/core/dist/src/managed-runtime/managed-session-records.js');
records.MANAGED_SESSION_ENABLED_DOMAINS.push('team_plan'); // the gate-on build's one difference
const ops = await import('./packages/core/dist/src/managed-runtime/managed-child-operations.js');
const chain = await import('./packages/cli/dist/src/serve/hosted-member-chain.js');
const team = await import('./packages/cli/dist/src/serve/hosted-team-session.js');
const launch = ops.decodeChildLaunchEnvelope(readFileSync(process.argv[2]));
const fits = (n, ch = 'B') => {
  try {
    ops.encodeChildLaunchEnvelope({ ...launch, prompt: chain.teamMemberPreamble({ name: 'alice', teamName: 'review' }, true) + team.teamPlanInstruction(ch.repeat(n), 'rejected', '"'.repeat(4096)) });
    return true;
  } catch (e) { if (n === 1) throw e; return false; }
};
let lo = 1, hi = 40000;
while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (fits(mid)) lo = mid; else hi = mid; }
const preamble = chain.teamMemberPreamble({ name: 'alice', teamName: 'review' }, true);
console.log(JSON.stringify({ maxAsciiPlan: lo, firstRefused: hi, preambleBytes: Buffer.byteLength(preamble), namesExit: preamble.includes('exit_plan_mode'),
  maxPlanOfQuotes: (() => { let a = 1, b = 40000; while (a + 1 < b) { const m = (a + b) >> 1; if (fits(m, '"')) a = m; else b = m; } return a; })(),
  envelopeKeys: Object.keys(launch), descriptionBytes: Buffer.byteLength(launch.description ?? ''), launchPromptBytes: Buffer.byteLength(launch.prompt) }));
