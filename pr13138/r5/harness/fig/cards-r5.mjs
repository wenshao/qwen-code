// Round-5 card: head 26de3752 (W1b validates Hosted file history with the live record parser).
import fs from 'node:fs';
const O = '/Users/wenshao/pr13138-rig/out/e2e-r5';
const j = (p) => JSON.parse(fs.readFileSync(`${O}/${p}`, 'utf8'));
const h = j('r5-undo-head.json'); const l = j('r5-undo-legacy.json'); const rb = j('r4-runbook-26d.json');
const st = (s) => !s ? '-' : s.startsWith('state=') ? s.match(/state=\w+/)[0].replace('state=', '') : `refused: ${s}`;
const D = '/Users/wenshao/pr13138-rig/fig/cards-r5';
fs.mkdirSync(D, { recursive: true });
const step = (s) => `${s.status} files=${JSON.stringify(s.filesChanged)} conflict=${s.conflict} -> receipts ${s.receipts}`;
const t1 = [['real undo via POST /session/:id/files/rewind', 'written by head 26de3752', 'written by d8bc703e (before #13144)']];
h.steps.forEach((s, i) => t1.push([s.label, step(s), step(l.steps[i])]));
t1.push(['cold load by a fresh head Harness, then a turn', `++ load ${h.coldLoad.status}, ${h.turnAfterLoad}`, `++ (stack upgraded to head) load ${l.coldLoad.status}, ${l.turnAfterLoad}`]);
t1.push(['W1b capture -> replay -> verify (head CLI)', `++ ${st(h.capture)} -> ${st(h.verify)}, replay identical=${h.replayIdentical}`, `++ ${st(l.capture)} -> ${st(l.verify)}, replay identical=${l.replayIdentical}`]);
const t2 = [['round-4 runbook on 26de3752 artifacts', 'result'],
  ['8 Sessions: Files, Shell, O2 Shell, 1 undo, O1 + S2 deleted via real Java completion', `++ ${st(rb.A.capture)} -> ${st(rb.A.verify)}; replay identical; ${rb.A.tables} authority tables unchanged`],
  ['SIGKILL while assets.ndjson publishes', `++ resume ${st(rb.R130.resume)}`],
  ['six retirement tampers (N1-N6)', `++ ${rb.neg.filter((n) => n.exit !== 0).length}/6 refused; control after revert ${st(rb.negControl)}`]];
fs.writeFileSync(`${D}/01-undo-receipts.json`, JSON.stringify({
  title: '26de3752: the live file-history parser accepts every real undo shape, old and new',
  subtitle: 'Same Ubuntu 24.04 ext4 VM + MySQL 8.4.11; head bundle (W1b chunk HGZLNRBN) + unchanged Java (byte-identical main sources to d8bc703e)',
  blocks: [
    { table: t1 },
    { table: t2 },
    { note: 'Deletion receipts keep the deleted path tracked; a lost-reply retry with the same requestId is idempotent (no duplicate receipt); conflict receipts carry no changed paths; receipts written before #13144 have the same shape. The second conflict row is a rig artifact (the restore wrote a trailing newline).' },
  ] }, null, 1));
console.log('ok');
