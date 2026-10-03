// Read-only diagnostic for --session-failover: print the journal operation
// sequence and resource kinds right before the mode's success summary.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const W = '/Users/wenshao/git/pr13263-head';
const anchor = '      console.log(\n        JSON.stringify(\n          {\n            sessionId: session.id,\n            firstHarnessBootId: firstBootId,';
const probe = "      console.log('SFOBS ' + JSON.stringify({ ops: runMysql(mysqlPort, 'SELECT journal_revision, operation FROM qwen_managed_agent.qwen_managed_session_journal_tx ORDER BY journal_revision'), kinds: runMysql(mysqlPort, 'SELECT kind, COUNT(*) FROM qwen_managed_agent.qwen_managed_session_resource GROUP BY kind ORDER BY kind'), session: runMysql(mysqlPort, 'SELECT workspace_id FROM qwen_managed_agent.managed_agent_session') }));\n";
const sources = {
  base: execFileSync('git', ['-C', W, 'show', '5130c1a734:scripts/run-managed-agent-server-e2e.ts'], { encoding: 'utf8' }),
  r1: execFileSync('git', ['-C', W, 'show', '8e1375c380:scripts/run-managed-agent-server-e2e.ts'], { encoding: 'utf8' }),
  head: readFileSync(`${W}/scripts/run-managed-agent-server-e2e.ts`, 'utf8'),
};
for (const [name, text] of Object.entries(sources)) {
  const n = text.split(anchor).length - 1;
  if (n !== 1) throw new Error(`${name}: anchor matched ${n}`);
  writeFileSync(`${W}/scripts/e2e-v-sfobs-${name}.ts`, text.replace(anchor, () => probe + anchor));
  console.log(`sfobs-${name} written`);
}
