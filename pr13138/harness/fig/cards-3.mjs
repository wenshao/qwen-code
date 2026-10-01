// Card 3: damage to a sealed bundle (S3) and interference during a capture (S4). Values from out/e2e/s3-damage.json, s4-drift.json.
import fs from 'node:fs';
const E = '/Users/wenshao/pr13138-rig/out/e2e';
const s3 = JSON.parse(fs.readFileSync(`${E}/s3-damage.json`, 'utf8'));
const s4 = JSON.parse(fs.readFileSync(`${E}/s4-drift.json`, 'utf8')).rows;
const code = (o) => o.startsWith('REFUSED') ? o.replace(/^REFUSED /, '').split(':')[0] : o.match(/contentVerified=\w+ authorityCompatible=\w+/)?.[0] ?? o.slice(0, 50);
const d3 = [['damage after the seal (fresh verify each time)', 'exit', 'result']];
for (const r of s3) d3.push([r.what.slice(0, 82), String(r.exit), `${r.exit === 0 ? '++ ' : '++ refused '}${code(r.outcome)}`]);
const d4 = [['interference while capture runs (each: new UUID, same fence)', 'state', 'last error', 'same-UUID retry']];
const what4 = { control: 'nothing (baseline: 3,400 entries, 98.6 s)', 'late-create': 'service restarted, public create of a new Session in ws-a1', 'model-commit': 'service + Harness restarted, F1 cold load + text-only Turn', 'escaped-writer': 'append to project/notes.txt before it was compared', 'live-writer': 'Harness left F1 attached (60 s writer lease live) at start', 'fence-lifted': 'another operator runs W1a restore-original' };
for (const r of s4) d4.push([what4[r.id] ?? r.id, r.id === 'live-writer' ? '++ refused at start, no row' : r.state === 'SEALED' || r.state === 'INVALIDATED' ? `++ ${r.state}` : `!! ${r.state} (refused)`, r.id === 'live-writer' ? code(r.outcome.replace('Workspace recovery: ', '')) : String(r.lastError ?? '-'), r.retry === '-' ? '-' : code(r.retry)]);
const card = {
  title: 'Damage to a sealed bundle, interference during a capture',
  subtitle: 'S3: sealed S1 bundle restored from a pristine cp -a copy before every case · S4: 3,400-entry Workspace so each capture lasts ~100 s; nothing may seal',
  blocks: [
    { label: 'S3 — fresh verify operations against the sealed capture', table: d3 },
    { label: 'S4 — the runbook says these processes stay stopped; the fence alone does not stop them', table: d4 },
    { note: 'S3 runs after S1 had advanced the Sessions, so even its control is authorityCompatible=false (S5 shows the compatible -> source-lost transition). Every damage case refuses; losing the original source keeps content verification but drops authority compatibility. No interference case sealed. A public create on the fenced storage succeeds and is caught only at finish, after the whole bundle (including manifest.json) was written; an escaped write that lands before its file is compared is reported as snapshot_source_mismatch and does not invalidate.' },
  ],
};
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards/03-damage-and-drift.json', JSON.stringify(card, null, 1));
for (const t of [d3, d4]) for (const r of t) console.log(r.join(' | '));
