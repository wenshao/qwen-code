// Evidence cards that depend only on head-only scenarios (head 7c54aa78). Values are copied from out/e2e-new/*.log.
import fs from 'node:fs';
const dir = new URL('./cards/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const ENV = 'Ubuntu 24.04 VM (kernel 6.8, ext4), MySQL 8.4, PR-head fat jar as a systemd service with durable local workers, packaged Hosted Harness and workers, deterministic local model';
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));

card('01-rollout-and-cold-restore', {
  title: 'README rollout and W1a cold restore on a real Linux host (head 7c54aa78)',
  subtitle: ENV,
  blocks: [
    { label: 'option turned on before anything is registered', pre: [
      '-- tool Turn on the unregistered mount     runtimes:warm -> 409 workspace_unavailable; nothing written',
      '== lease row stays UNVERIFIED rev 0, no marker file appears: the directory found at startup is not enrolled',
      '++ a text-only Turn of the same Session still completes'].join('\n') },
    { label: 'service stopped: maintenance entry run from the shipped fat jar (java -cp server.jar -Dloader.main=...RegistrationMain ...PropertiesLauncher)', pre: [
      '-- register ... (without --offline-confirmed)         usage, exit 1',
      '++ register t-w1a st-a /srv/w1a/a <uuid> --offline-confirmed   exit 0  row READY rev 1  dev=64769 ino=788592',
      '== marker /srv/w1a/a/.qwen-managed-storage.json  205 bytes, mode 664, no temporary file left',
      '++ same command again (same uuid)                     exit 0  row, marker inode and mtime unchanged',
      '-- same command with another uuid                     exit 1  row unchanged',
      '== inspect: state=ready revision=1 operation=null completed=b0a24a3f-... holder=false identity=match marker=match'].join('\n') },
    { label: 'option on; Spring and the Harness restarted (Harness boot id ec45e0c0 -> fd7b9c92, new disposable home)', pre: [
      '++ cold load without a tool profile   file Session 200 (1286 ms), Shell Session 200 (553 ms); model calls +0, Broker calls 0',
      '++ history                            the model receives 8 messages: 3 user, 1 tool result from before the restart',
      '++ next file Turn                     warm 200, acquire 200, prepare 200, start 200, release 200 -> turn_complete (note3.txt)',
      '++ next Shell Turn                    turn_complete; .calls has 2 lines, note.txt is still "v1": no earlier effect repeated',
      '-- Session on the unregistered storage c   runtimes:warm -> 409 workspace_unavailable'].join('\n') },
    { label: 'kill -9 of the server process (workers 88835, 89087 keep running), restart', pre: [
      '++ cold load 200 / 200; next file Turn and next Shell Turn complete on the same two worker PIDs'].join('\n') },
    { label: 'kill -9 of the Harness without detaching', pre: [
      '!! first load in the new Harness: 503 managed_session_open_failed; 200 after 54 s, when the dead writer\'s 60 s lease has lapsed',
      '++ next file Turn completes'].join('\n') },
  ],
});

card('02-identity-matrix', {
  title: 'A2 at deployment level: 13 storage changes made while the service is stopped (head 7c54aa78, option on)',
  subtitle: `${ENV}. Each case: detach, stop, change, start, cold load the completed Session, ask for one new write_file.`,
  blocks: [
    { table: [
      ['#', 'change while stopped', 'next tool call', 'inspect'],
      ['1', 'nothing (control)', '++ executed', 'identity=match marker=match'],
      ['2', 'mv a a.prev; mkdir a/project  (ino 788592 -> 790712)', '-- warm 409 workspace_unavailable', 'identity=mismatch marker=unavailable'],
      ['3', 'case 2 + marker copied into the replacement', '-- warm 409 workspace_unavailable', 'identity=mismatch marker=match'],
      ['4', 'original moved back (control)', '++ executed', 'identity=match marker=match'],
      ['5', 'marker removed', '-- warm 409 workspace_unavailable', 'identity=match marker=unavailable'],
      ['6', 'marker registrationId edited', '-- warm 409 workspace_unavailable', 'identity=match marker=mismatch'],
      ['7', 'marker pretty-printed, same values', '++ executed', 'identity=match marker=match'],
      ['8', 'marker replaced by a symlink to an identical copy', '-- warm 409 workspace_unavailable', 'identity=match marker=unavailable'],
      ['9', 'saved cwd missing (mv project project.bak)', '-- warm 409 workspace_unavailable', 'identity=match marker=match'],
      ['10', 'saved cwd replaced by a symlink', '-- warm 409 workspace_unavailable', 'identity=match marker=match'],
      ['11', 'root replaced by a symlink to the moved original', '-- server does not start (mount must be canonical)', 'identity=mismatch marker=match'],
      ['12', 'fence st-a at revision 1', '-- warm 409 workspace_unavailable', 'state=fenced revision=1 operation=a4acc9e3-...'],
      ['13', 'restore-original (revision 2)', '++ executed', 'state=ready revision=2'],
    ] },
    { label: 'in every refused case: cold load 200, GET session 200, GET events 200 (history stays readable); nothing written anywhere', pre: [
      '== fence / restore runbook on the same storage',
      '++ fence rev 1 <op>                     row FENCED rev 1',
      '++ fence rev 1 <op> again               exit 0, unchanged',
      '-- fence rev 1 <other op>               refused',
      '-- restore-original rev 1 <other op>    refused',
      '-- restore-original rev 2 <op>          refused',
      '++ restore-original rev 1 <op>          row READY rev 2',
      '++ restore-original rev 1 <op> again    exit 0, still rev 2',
      '-- delayed fence rev 1 <op>             refused, row stays READY rev 2'].join('\n') },
  ],
});

card('06-marker-and-the-agents-own-tools', {
  title: 'The root marker lives in the tree the agent works on (head 7c54aa78, option on)',
  subtitle: `${ENV}. Storage c is a git repository at the storage root; the Session cwd is "." (the repository root).`,
  blocks: [
    { label: 'Shell-profile Session', pre: [
      '== 1. git status --porcelain        ->  ?? .qwen-managed-storage.json',
      '!! 2. cat .qwen-managed-storage.json ->  {"version":1,...,"hostId":"f03cd9a6530b4a84...","device":"64769","inode":"788596",...}',
      '==                                      (host machine-id, device and inode are sent to the model provider as a tool result)',
      '!! 3. git stash -u                   ->  turn_complete; marker on disk: ABSENT; inspect: identity=match marker=unavailable',
      '-- 4. git stash pop (the agent undoing it)      runtimes:warm -> 409 workspace_unavailable',
      '-- 5. new Session in another Workspace on the same storage   runtimes:warm -> 409 workspace_unavailable'].join('\n') },
    { label: 'what the maintenance entry offers the operator (service stopped)', pre: [
      '-- register, same operation uuid     refused',
      '-- register, new operation uuid      refused',
      '-- fence rev 1                       refused',
      '-- restore-original rev 1            refused',
      '++ outside the product: `git stash pop` on the host      inspect: marker=match; next Shell Turn completes'].join('\n') },
    { label: 'variants', pre: [
      '!! 8.  git clean -fdx               ->  "Removing .qwen-managed-storage.json"; next Turn: warm 409 workspace_unavailable',
      '++ 9.  operator rewrites the 8 marker fields by hand from the SQL row   inspect: marker=match; next Turn completes',
      '!! 10. file profile, write_file .qwen-managed-storage.json {}   ->  "Successfully overwrote file"; inspect: marker=mismatch;',
      '--     next file Turn: warm 409 workspace_unavailable'].join('\n') },
    { note: 'None of these calls is hostile; each completes normally and the storage is closed afterwards for every Workspace on it. The design excludes "malicious same-UID" writers and states that W1a has no repair command.' },
  ],
});

card('07-java-connector-and-approvals', {
  title: 'Public G0 route through the Java connector, and tool approvals from main, with W1a (head 7c54aa78)',
  subtitle: `${ENV}. Spring started with harness.enabled=true and the option on.`,
  blocks: [
    { label: 'POST /v1/agents/sessions with an initial input (real QwenHostedHarnessConnector -> Harness -> Broker -> worker)', table: [
      ['storage', 'Turn', 'time', 'model calls', 'Broker calls'],
      ['a, registered', '++ COMPLETED, pub.txt written', '2937 ms', '+2', 'warm, acquire, prepare, start, status, release: 200'],
      ['c, never registered', '-- FAILED workspace_unavailable', '791 ms', '+0', 'none'],
      ['b, registered then fenced', '-- FAILED workspace_unavailable', '501 ms', '+0', 'none'],
      ['d, replaced at the same pathname', '-- FAILED workspace_unavailable', '487 ms', '+0', 'none'],
      ['c, text-only initial Turn', '-- FAILED workspace_unavailable', '478 ms', '+0', 'none'],
    ] },
    { label: 'after a Spring restart', pre: '++ GET session 200, events 200 (7 events), turns 200 (completed): history stays readable\n== public next input on the completed G0 Session: 409 (still gated, as the PR says)' },
    { label: 'tool approvals (approvalMode=default) and W1a cold-load validation', pre: [
      '++ write_file asks; answer allow -> Turn completes, file written; answer deny -> Turn completes, file not written',
      '++ detach, cold load without a profile -> 200, model calls +0; the next Turn asks again and completes',
      '++ each of the 6 action-options / action-decision resources made unavailable in turn -> load 409 hosted_turn_recovery_required (6/6)',
      '++ an Action still unanswered when the Harness is killed -> load in a new Harness: 409 hosted_turn_recovery_required; no file',
      '++ a Session created by the first-round bundle (no approval fields) -> load 200 approvalMode=yolo; next Turn completes'].join('\n') },
  ],
});
console.log('cards-a written');
