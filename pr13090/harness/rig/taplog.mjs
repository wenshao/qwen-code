// usage: node taplog.mjs <file> <sinceMs> [untilMs] [regex]
import fs from 'node:fs';
const [file, since, until, pattern] = process.argv.slice(2);
const re = new RegExp(pattern ?? 'qwen_tool_publication|journal_head|qwen_output|ROLLBACK|COMMIT');
for (const l of fs.readFileSync(file, 'utf8').trim().split('\n')) {
  const e = JSON.parse(l);
  if (e.t < +since || (until && e.t > +until) || !re.test(e.sql) || /managed_agent_/.test(e.sql)) continue;
  console.log(`+${e.t - since}ms c${e.conn} ${e.result} | ${e.sql.replace(/'[0-9a-f-]{36}'/g, "'<uuid>'").replace(/'[0-9a-f]{64}'/g, "'<hash>'").slice(0, 260)}`);
}
