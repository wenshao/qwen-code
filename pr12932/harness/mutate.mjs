// Independent mutation check of the PR's Turn read model. Each mutant is one
// exact text replacement (must occur exactly once), compiled and run against
// the PR's unit tests; DB-specific mutants also run the MySQL/MariaDB IT test.
// usage: node mutate.mjs [ids...]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SP = path.dirname(new URL(import.meta.url).pathname);
const MOD = path.join(SP, 'wt-mut/packages/sdk-java/managed-agent-server');
const J = path.join(MOD, 'src/main/java/com/alibaba/qwen/code/managedagent');
const F = {
  S: path.join(J, 'store/ManagedAgentStore.java'),
  V: path.join(J, 'service/ManagedAgentService.java'),
  C: path.join(J, 'api/PublicAgentController.java'),
};
const M = [
  ['M01', 'S', 'oldest first', '" DESC, turn_id DESC LIMIT ?"', '" ASC, turn_id ASC LIMIT ?"'],
  ['M02', 'S', 'ties ordered by ID ascending', '" DESC, turn_id DESC LIMIT ?"', '" DESC, turn_id ASC LIMIT ?"'],
  ['M03', 'S', 'keyset repeats the cursor Turn (<=)', '+ " turn_id < ?))";', '+ " turn_id <= ?))";'],
  ['M04', 'S', 'keyset ignores created_at (ID only)', '" AND (created_at < ? OR (created_at = ? AND"', '" AND ((? IS NOT NULL) AND (? IS NOT NULL AND"'],
  ['M05', 'S', 'keyset skips Turns tied with the cursor', '" AND (created_at < ? OR (created_at = ? AND"', '" AND (created_at < ? OR (created_at = ? AND 1 = 0 AND"'],
  ['M06', 'S', 'fetches limit rows, not limit+1', 'arguments.add(limit + 1);\n        List<TurnSummary> rows', 'arguments.add(limit);\n        List<TurnSummary> rows'],
  ['M07', 'S', 'has_more when rows == limit', 'turnSummaryMapper, arguments.toArray());\n        boolean hasMore = rows.size() > limit;', 'turnSummaryMapper, arguments.toArray());\n        boolean hasMore = rows.size() >= limit;'],
  ['M08', 'S', 'detail drops the exact-ID filter (trailing spaces)', '.filter(turn -> turn.turnId().equals(turnId))', '.filter(turn -> true)', 'it'],
  ['M09', 'S', 'list drops the tenant predicate', '+ " FROM managed_agent_turn WHERE tenant_id = ? AND"', '+ " FROM managed_agent_turn WHERE ? IS NOT NULL AND"', 'it'],
  ['M10', 'S', 'detail drops the Session predicate', '" session_id = ? AND turn_id = ?",\n                turnSummaryMapper', '" ? IS NOT NULL AND turn_id = ?",\n                turnSummaryMapper'],
  ['M11', 'V', 'list skips the Session check', 'requireReadableSession(tenantId, actorId, sessionId);\n        TurnPage page', 'TurnPage page'],
  ['M12', 'V', 'detail skips the Session check', 'requireReadableSession(tenantId, actorId, sessionId);\n        return store.findTurnSummary', 'return store.findTurnSummary'],
  ['M13', 'V', 'list checks the Session before validating', 'int limit = limit(requestedLimit);\n        TurnCursor decoded = decodeTurnCursor(cursor);\n        requireReadableSession(tenantId, actorId, sessionId);', 'requireReadableSession(tenantId, actorId, sessionId);\n        int limit = limit(requestedLimit);\n        TurnCursor decoded = decodeTurnCursor(cursor);'],
  ['M14', 'V', 'ID length in UTF-16 units', 'turnId.codePointCount(0, turnId.length()) > TURN_ID_MAX_LENGTH', 'turnId.length() > TURN_ID_MAX_LENGTH'],
  ['M15', 'V', 'ID length limit 65', 'TURN_ID_MAX_LENGTH = 64;', 'TURN_ID_MAX_LENGTH = 65;'],
  ['M16', 'V', 'next_cursor on the last page', 'if (!page.hasMore() || page.turns().isEmpty()) {', 'if (page.turns().isEmpty()) {'],
  ['M17', 'V', 'blank cursor rejected', 'if (cursor == null || cursor.isBlank()) {\n            return null;\n        }\n        String decoded;', 'if (cursor == null || cursor.isEmpty()) {\n            return null;\n        }\n        String decoded;'],
  ['M18', 'V', 'standard base64 decoder', '\n            decoded = new String(Base64.getUrlDecoder().decode(cursor),', '\n            decoded = new String(Base64.getDecoder().decode(cursor),'],
  ['M19', 'V', 'cursor accepts leading zeros', '"^(0|[1-9][0-9]{0,18}):([A-Za-z0-9_-]{1,64})$"', '"^([0-9]{1,19}):([A-Za-z0-9_-]{1,64})$"'],
  ['M20', 'V', 'cursor rejects a 64-char ID', '"^(0|[1-9][0-9]{0,18}):([A-Za-z0-9_-]{1,64})$"', '"^(0|[1-9][0-9]{0,18}):([A-Za-z0-9_-]{1,63})$"'],
  ['M21', 'C', 'default limit 100', '@RequestParam(defaultValue = "20") int limit) {\n        return service.listPublicTurns(', '@RequestParam(defaultValue = "100") int limit) {\n        return service.listPublicTurns('],
  ['M22', 'V', 'cursor carries seconds, not ms', 'String raw = last.createdAt() + ":" + last.turnId();', 'String raw = (last.createdAt() / 1000) + ":" + last.turnId();'],
  ['M23', 'V', 'cursor names the first Turn of the page', 'TurnSummary last = page.turns().getLast();', 'TurnSummary last = page.turns().getFirst();'],
  ['M24', 'S', 'summary completed_at never null', 'result.getLong("created_at"),\n                    nullableLong(result, "completed_at"),\n                    result.getString("error_code"));', 'result.getLong("created_at"),\n                    result.getLong("completed_at"),\n                    result.getString("error_code"));'],
];
const only = process.argv.slice(2);
const env = { ...process.env, JAVA_HOME: `${process.env.HOME}/Install/jdk21`, PATH: `${process.env.HOME}/Install/jdk21/bin:${process.env.HOME}/Install/maven/bin:${process.env.PATH}` };
const MVN = ['-o', '--batch-mode', '--no-transfer-progress', '-s', path.join(SP, 'm2settings.xml'), `-Dmaven.repo.local=${path.join(SP, 'm2')}`, '-Dcheckstyle.skip'];
function mvn(args, log) {
  const r = spawnSync('mvn', [...MVN, ...args], { cwd: MOD, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  fs.writeFileSync(log, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  if (/COMPILATION ERROR/.test(out)) return { verdict: 'compile-error', failed: [] };
  const failed = [...new Set([...out.matchAll(/\[ERROR\]\s+(?:Tests run:.*?-- in )?([\w.]+Test\w*|[\w.]+IT)[.#](\w+)/g)].map((m) => `${m[1].split('.').pop()}.${m[2]}`))];
  const summary = [...out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].pop();
  const ran = summary ? Number(summary[1]) : 0;
  const bad = summary ? Number(summary[2]) + Number(summary[3]) : 0;
  if (!summary || ran === 0) return { verdict: 'no-tests', failed };
  return { verdict: bad > 0 ? 'killed' : 'survived', ran, bad, failed };
}
const results = [];
for (const [id, f, what, from, to, stage] of M) {
  if (only.length && !only.includes(id)) continue;
  const file = F[f];
  const orig = fs.readFileSync(file, 'utf8');
  const count = orig.split(from).length - 1;
  if (count !== 1) {
    console.log(`${id} ANCHOR x${count} — skipped`);
    results.push({ id, what, verdict: `anchor x${count}` });
    continue;
  }
  fs.writeFileSync(file, orig.replace(from, to));
  try {
    const unit = mvn(['-Dtest=ManagedTurnQueryTest,ManagedAgentApiContractTest', '-Dsurefire.failIfNoSpecifiedTests=false', 'test'], path.join(SP, 'logs', `mut-${id}-unit.log`));
    const row = { id, what, unit: unit.verdict, unitFailed: unit.failed };
    if (stage === 'it') {
      for (const [eng, port] of [['mariadb', 33296], ['mysql', 33294]]) {
        const db = `mut_${id}_${eng}_${Date.now()}`.toLowerCase();
        const it = mvn(['-Pmysql-integration', `-Dmysql.url=jdbc:mysql://127.0.0.1:${port}/${db}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false`, '-Dmysql.user=root', '-Dmysql.password=v12932', '-Dtest=NoSuchTest', '-Dsurefire.failIfNoSpecifiedTests=false', '-Dit.test=ManagedAgentMySqlIT#pagesTurnsNewestFirstOnMySql', 'verify'], path.join(SP, 'logs', `mut-${id}-it-${eng}.log`));
        row[`it_${eng}`] = it.verdict;
      }
    }
    row.verdict = [row.unit, row.it_mariadb, row.it_mysql].includes('killed') ? 'killed' : row.unit;
    results.push(row);
    console.log(`${id} ${row.verdict.toUpperCase().padEnd(9)} ${what} | unit=${row.unit}${row.it_mysql ? ` it(mariadb)=${row.it_mariadb} it(mysql)=${row.it_mysql}` : ''} | ${unit.failed.join(', ')}`);
  } finally {
    fs.writeFileSync(file, orig);
  }
}
fs.writeFileSync(path.join(SP, 'rig/out', `mutants${only.length ? '-' + only.join('-') : ''}.json`), JSON.stringify(results, null, 2));
const k = results.filter((r) => r.verdict === 'killed').length;
console.log(`KILLED ${k}/${results.length}`);
execFileSync('git', ['-C', MOD, 'diff', '--stat'], { stdio: 'inherit' });
