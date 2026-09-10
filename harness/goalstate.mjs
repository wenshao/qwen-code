/** Prints the goal_state ladder from the throwaway HOME's journal. */
import fs from 'node:fs';
import path from 'node:path';

const home = process.env.HOME_T || '/root/git/h11576/home';
const root = path.join(home, '.qwen', 'projects');
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsonl')) files.push(p);
  }
};
if (fs.existsSync(root)) walk(root);
files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);

const rows = [];
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.subtype !== 'goal_state') continue;
    const g = rec.systemPayload?.snapshot?.goal;
    if (!g) continue;
    rows.push({
      cause: rec.systemPayload?.cause,
      activity: rec.systemPayload?.snapshot?.activity,
      status: g.status,
      turnCount: g.turnCount,
      checkpointStalls: g.checkpointStalls,
      lastCheckpointFailure: g.lastCheckpointFailure,
      limitKind: g.limitKind,
      hasCheckpoint: !!g.evidenceCheckpoint,
      lastReason: g.lastReason,
    });
  }
}
const mode = process.argv[2] || 'ladder';
if (mode === 'json') {
  console.log(JSON.stringify(rows, null, 2));
} else {
  let prev = '';
  for (const r of rows) {
    const key = JSON.stringify([
      r.status,
      r.checkpointStalls,
      r.lastCheckpointFailure,
      r.limitKind,
      r.lastReason,
    ]);
    if (key === prev) continue;
    prev = key;
    console.log(
      JSON.stringify({
        cause: r.cause,
        status: r.status,
        turnCount: r.turnCount,
        checkpointStalls: r.checkpointStalls ?? null,
        lastCheckpointFailure: r.lastCheckpointFailure ?? null,
        limitKind: r.limitKind ?? null,
        lastReason: r.lastReason ? r.lastReason.slice(0, 400) : null,
      }),
    );
  }
  console.log(`# ${rows.length} goal_state records in ${files.length} files`);
}
