// Counts the fixture's polling statements in a MySQL general log and harness.log reads in a JFR recording.
// usage: node count.mjs <general.log> <recording.jfr> <label>
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
const [, , general, jfr, label] = process.argv;
const log = readFileSync(general, 'utf8');
const n = (re) => (log.match(re) ?? []).length;
const out = {
  label,
  statusPoll: n(/SELECT status FROM managed_agent_turn WHERE session_id = /g),
  diagTurnDump: n(/SELECT status, error_code FROM managed_agent_turn WHERE session_id = /g),
  diagEventDump: n(/SELECT event_type, data_json FROM managed_agent_event\s+WHERE session_id = /g),
  allStatements: n(/\t\s*\d+ (Query|Execute)\t/g),
};
if (existsSync(jfr)) {
  // The recording holds every file read of the JVM (class loading included), so stream the text form.
  const child = spawn(`${process.env.JAVA_HOME}/bin/jfr`, ['print', '--stack-depth', '40', '--events', 'jdk.FileRead', jfr]);
  const rl = readline.createInterface({ input: child.stdout });
  let cur = null, total = 0; const bySite = {}; let reads = 0, bytes = 0;
  for await (const line of rl) {
    if (line.startsWith('jdk.FileRead {')) { cur = { path: '', bytes: 0, site: 'other' }; total++; continue; }
    if (!cur) continue;
    let m;
    if ((m = line.match(/^\s+path = "(.*)"/))) cur.path = m[1];
    else if ((m = line.match(/^\s+bytesRead = (\d+)/))) cur.bytes = Number(m[1]);
    else if (cur.site === 'other' && (m = line.match(/HostedPublicWorkspaceIT\.(\S+?)\(/))) cur.site = m[1];
    else if (line === '}') {
      if (/harness\.log$/.test(cur.path)) { reads++; bytes += cur.bytes; (bySite[cur.site] ??= { reads: 0, bytes: 0 }); bySite[cur.site].reads++; bySite[cur.site].bytes += cur.bytes; }
      cur = null;
    }
  }
  // Text output prints sizes in human units ("1.3 kB"); take exact byte counts from the JSON form.
  const j = spawn(`${process.env.JAVA_HOME}/bin/jfr`, ['print', '--json', '--stack-depth', '0', '--events', 'jdk.FileRead', jfr]);
  let p = '', exact = 0, max = 0;
  for await (const line of readline.createInterface({ input: j.stdout })) {
    let m;
    if ((m = line.match(/^\s+"path": "(.*)",?\s*$/))) p = m[1];
    else if ((m = line.match(/^\s+"bytesRead": (\d+)/))) { if (/harness\.log$/.test(p)) { exact += Number(m[1]); max = Math.max(max, Number(m[1])); } p = ''; }
  }
  bytes = exact; out.harnessLogLargestRead = max;
  for (const v of Object.values(bySite)) delete v.bytes;
  out.harnessLogReads = reads; out.harnessLogBytes = bytes; out.harnessLogReadSites = bySite; out.fileReadEventsTotal = total;
}
console.log('COUNTS ' + JSON.stringify(out));
