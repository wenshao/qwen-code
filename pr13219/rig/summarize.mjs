// Key numbers per run, straight from result.json -> assets/results.tsv
import fs from 'node:fs';
const R = '/Users/wenshao/pr13219-rig/runs';
const load = (n) => { try { return JSON.parse(fs.readFileSync(`${R}/${n}/result.json`, 'utf8')); } catch { return null; } };
const rows = [['run', 'commit', 'key facts']];
const add = (n, f) => { const r = load(n); if (!r) { rows.push([n, '-', 'MISSING']); return; } rows.push([n, r.commit, r.error ? `ERROR ${r.error.slice(0, 80)}` : f(r)]); };
for (const a of ['base', 'head']) {
  add(`${a}-turn-budget`, (r) => `prompt attempts=${r.promptAttempts}; terminal=${r.terminal ? `${r.terminal.status}/${r.terminal.code} after ${r.terminal.retries} retries at ${(r.terminal.atMs / 1000).toFixed(1)}s` : 'none in 60s'}; follow-up=${r.followup.status}`);
  add(`${a}-refusal-budget`, (r) => { const c = {}; for (const x of r.requests) c[x] = (c[x] ?? 0) + 1; return `terminal=${r.terminal ? `${r.terminal.status}/${r.terminal.code} at ${(r.terminal.atMsAfterRestart / 1000).toFixed(1)}s after restart` : 'none in 60s'}; requests=${JSON.stringify(c)}; public=${JSON.stringify(r.publicTerminal.map((e) => e.data?.message))}`; });
  add(`${a}-protocol-poison`, (r) => `turn1=${r.turn1.status}/${r.turn1.code}; ` + r.steps.map((s) => `${s.label}: accepted=${s.accepted} ${s.row ? `${s.row.status}/${s.row.code}` : 'not terminal in 60s'} prompts=${s.promptRequestsSent}`).join('; '));
  add(`${a}-gap-mid`, (r) => `deleted=${r.deleted}; progressEnd=${r.progressEnd.replace('\t', '/')}; throws=${r.logCounts.gapThrows}; heal=${JSON.stringify(r.logCounts.healLines.map((l) => l.replace(/.*(missingSequences=\S+ nextEvent=\S+).*/, '$1')))}; items=${r.itemRows.map((l) => l.split('\t').slice(1, 3).join(':')).join(',')}`);
  add(`${a}-gap-terminal`, (r) => `deleted=${r.deleted}; progressEnd=${r.progressEnd.replace('\t', '/')}; throws=${r.logCounts.gapThrows}; heal=${JSON.stringify(r.logCounts.healLines.map((l) => l.replace(/.*(missingSequences=\S+ nextEvent=\S+).*/, '$1')))}; items=${r.itemRows.map((l) => l.split('\t').slice(1, 3).join(':')).join(',')}`);
  add(`${a}-poison-backoff`, (r) => `failure lines=${r.failureLines}; stuck ERROR=${r.stuckLines.length}; log bytes=${r.springLogBytes}; offsets=${r.failureOffsets.length > 20 ? r.failureOffsets.slice(0, 6).join(',') + ',...' : r.failureOffsets.join(',')}; session B caught up ${r.sessionB.caughtUpMsAfterTerminal}ms; A caught up ${r.sessionA.caughtUpMsAfterRepair}ms after repair`);
  add(`${a}-close-harness-down`, (r) => `end of 60s: ${r.samples.at(-1).op} sess=${r.samples.at(-1).sess}; after Spring restart: ${r.samplesAfterSpringRestart.at(-1).op.join(' + ')} sess=${r.samplesAfterSpringRestart.at(-1).sess}; new close=${r.freshAfterSpringRestart.status} ${r.freshAfterSpringRestart.body?.error?.code ?? r.freshAfterSpringRestart.body?.status ?? ''}; delete=${r.deleteAfter.status} ${r.deleteAfter.body?.error?.code ?? r.deleteAfter.body?.status ?? ''}; final sess=${r.samplesDelete.at(-1).sess}`);
  add(`${a}-close-live-writer`, (r) => `end of 25s fault: ${r.samples.at(-1).op} writer=${r.samples.at(-1).head}; after clear: ${r.samplesAfterClear.at(-1).op} sess=${r.samplesAfterClear.at(-1).sess} writer=${r.samplesAfterClear.at(-1).head}`);
  add(`${a}-action-budget`, (r) => r.responds.map((x) => `${x.label}: ${x.status} ${x.body?.status ?? x.body?.error?.code ?? ''}${x.body?.replayed ? ' replayed' : ''}`).join('; ') + ' || ' + r.snaps.filter((s, i) => i === 1 || /before any retry|retry \+1s/.test(s.label)).map((s) => `${s.label}: op=${s.op} action=${s.action} turn=${s.turn} resolves=${s.resolves} file=${s.file}`).join('; '));
  add(`${a}-seal-once`, (r) => `closed at ${r.closedAtMs}ms; store=${r.storeCalls.join(', ')}; DELETE=${r.deletes.map((d) => d.split(' ').slice(0, 2).join(' ')).join(', ')}`);
  add(`${a}-seal-always-default`, (r) => `last=${r.samples.at(-1).op} at ${(r.samples.at(-1).t / 1000).toFixed(0)}s writer=${r.samples.at(-1).head}; store=${r.storeCalls.join(', ')}`);
  add(`${a}-boot`, (r) => r.boot.map((b) => `${b.label}: ${b.up ? 'UP' : 'REFUSED'}`).join('; '));
}
add('head-turn-poison', (r) => `turn1=${r.turn1.status}/${r.turn1.code} prompts=${r.turn1.promptRequests}; ` + r.steps.map((s) => `${s.label}: ${s.row ? `${s.row.status}/${s.row.code}` : 'not terminal'} prompts=${s.promptRequestsSent}`).join('; '));
add('cand-turn-poison', (r) => `turn1=${r.turn1.status}/${r.turn1.code} prompts=${r.turn1.promptRequests}; ` + r.steps.map((s) => `${s.label}: ${s.row ? `${s.row.status}/${s.row.code}` : 'not terminal'} prompts=${s.promptRequestsSent}`).join('; '));
add('cand-protocol-poison', (r) => `turn1=${r.turn1.status}/${r.turn1.code}; ` + r.steps.map((s) => `${s.label}: ${s.row ? `${s.row.status}/${s.row.code}` : 'not terminal'} prompts=${s.promptRequestsSent}`).join('; '));
for (const a of ['base', 'head', 'cand']) add(`${a}-ambiguous-admitted`, (r) => `turn1=${r.turn1.status ?? 'not terminal'}/${r.turn1.code ?? ''} model calls=${r.model.length}; A=${r.followupA.accepted} ${r.followupA.row ? `${r.followupA.row.status}/${r.followupA.row.code}` : ''}; B=${r.followupB ? `${r.followupB.accepted} ${r.followupB.row ? `${r.followupB.row.status}/${r.followupB.row.code}` : ''}` : 'n/a'}`);
add('head-turn-budget-default', (r) => `defaults; prompt attempts=${r.promptAttempts}; terminal=${r.terminal ? `${r.terminal.status}/${r.terminal.code} after ${r.terminal.retries} retries at ${(r.terminal.atMs / 1000).toFixed(1)}s` : 'none'}`);
const tsv = rows.map((r) => r.join('\t')).join('\n') + '\n';
fs.mkdirSync('/Users/wenshao/pr13219-rig/assets', { recursive: true });
fs.writeFileSync('/Users/wenshao/pr13219-rig/assets/results.tsv', tsv);
console.log(tsv);
