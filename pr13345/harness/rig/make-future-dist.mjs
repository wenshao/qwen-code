// Builds <tree>/packages/core/dist-future: the arm's own dist plus what a
// later slice would ship per Decision 7 -- a record body registered for the
// envelope domain goal_state, and (where the list exists) goal_state moved
// out of MANAGED_SESSION_ENVELOPE_DOMAINS.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const [tree] = process.argv.slice(2);
const src = `${tree}/packages/core/dist`;
const dst = `${tree}/packages/core/dist-future`;
fs.rmSync(dst, { recursive: true, force: true });
execFileSync('cp', ['-Rc', src, dst]);
const dir = `${dst}/src/managed-runtime`;
function patch(file, find, replace) {
  const text = fs.readFileSync(`${dir}/${file}`, 'utf8');
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`${file}: anchor occurs ${n} times`);
  fs.writeFileSync(`${dir}/${file}`, text.replace(find, () => replace));
  console.log(`patched ${file}`);
}
const anchor = `    monitor_run: Object.freeze({\n        taskKind: 'monitor',`;
patch(
  'managed-extension-projection.js',
  anchor,
  `    goal_state: Object.freeze({
        taskKind: 'monitor',
        parse: (value) => {
            const monitor = parseMonitorRun(value);
            return { record: monitor, recordId: monitor.monitorId, run: monitor.run };
        },
        isStart: isMonitorRunStart,
        isSuccessor: isMonitorRunSuccessor,
    }),
${anchor}`,
);
const records = fs.readFileSync(`${dir}/managed-session-records.js`, 'utf8');
if (records.includes('MANAGED_SESSION_ENVELOPE_DOMAINS = ')) {
  patch(
    'managed-session-records.js',
    `MANAGED_SESSION_ENVELOPE_DOMAINS = ['goal_state', 'session_metadata', 'file_history', 'session_source'];`,
    `MANAGED_SESSION_ENVELOPE_DOMAINS = ['session_metadata', 'file_history', 'session_source'];`,
  );
} else {
  console.log('no envelope list in this arm');
}
