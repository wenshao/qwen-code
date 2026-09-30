// Keeps copies of what the runner deletes on exit: the Harness daemon log and
// the public event rows of the run's own temporary MySQL server. Read-only.
// usage: node tap-run.mjs <TMPDIR> <outDir> <mysqlClient>
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [tmp, out, mysql] = process.argv.slice(2);
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
const sql =
  "SELECT sequence_id, event_type, terminal, LEFT(data_json, 600) FROM qwen_managed_agent.managed_agent_event ORDER BY sequence_id";
while (!stopping) {
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith('managed-agent-server-e2e-')) continue;
    const base = path.join(tmp, name);
    for (const home of ['harness-home', 'replacement-harness-home']) {
      const log = path.join(base, home, '.qwen', 'debug', 'daemon', 'daemon.log');
      try {
        if (existsSync(log)) copyFileSync(log, path.join(out, `${home}-daemon.log`));
      } catch {
        // Deleted between the check and the copy.
      }
    }
  }
  try {
    const ps = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const line = ps.split('\n').find((row) => row.includes(`--datadir=${tmp}/managed-agent-server-e2e-`) && row.includes('--port='));
    const port = line ? /--port=(\d+)/.exec(line)?.[1] : undefined;
    if (port) {
      const rows = execFileSync(mysql, ['--protocol=tcp', '--host=127.0.0.1', `--port=${port}`, '--user=root', '--batch', '--skip-column-names', '--execute', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (rows.trim().length > 0) writeFileSync(path.join(out, 'public-events.tsv'), rows);
    }
  } catch {
    // The database or table is not there yet, or already gone.
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}
