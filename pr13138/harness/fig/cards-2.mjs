// Card 2: ordinary Workspace content on PR head vs the candidate patch (S2, same DB/fence, CLI child swapped).
import fs from 'node:fs';
const E = '/Users/wenshao/pr13138-rig/out/e2e';
const head = JSON.parse(fs.readFileSync(`${E}/s2-content-head2.json`, 'utf8'));
const cand = JSON.parse(fs.readFileSync(`${E}/s2-content-cand.json`, 'utf8'));
const what = { control: 'nothing added', 'git-repo': 'git init + commit (project/repo)', venv: 'python3 -m venv --without-pip .venv', 'abs-link-inside': 'absolute symlink to a file inside the root', 'rel-link-dir': 'relative symlink to a directory', 'dangling-link': 'relative symlink to a missing target', 'escaping-link': 'relative symlink leaving the root', 'hard-link': 'second hard link (ln / pnpm store / cp -al)', fifo: 'named pipe (mkfifo)', socket: 'unix socket left by a dev server' };
const fmt = (r) => r.exit === 0 ? '++ SEALED' : r.state === 'INVALIDATED' ? `-- INVALIDATED ${r.lastError}` : `++ refused ${r.lastError}`;
const retry = (r) => r.retry === '-' ? '' : r.retry.startsWith('state=SEALED') ? '++ SEALED' : `-- ${r.retry.replace(/^REFUSED /, '').split(':')[0]}`;
const t = [['entry in the stopped source tree', 'PR head 989baf22', 'same UUID after removing it', 'candidate', 'same UUID after removing it']];
for (const h of head) { const c = cand.find((x) => x.id === h.id); t.push([what[h.id] ?? h.id, fmt(h), retry(h), c ? fmt(c) : '-', c ? (h.id === 'venv' && retry(c).includes('source_drift') ? '!! source_drift (rm -rf .venv also removed pinned siblings)' : retry(c)) : '-']); }
const venv = cand.find((x) => x.id === 'venv');
const card = {
  title: 'F1 — a static, unsupported entry is reported as source_drift and burns the recovery UUID',
  subtitle: 'S2: one entry added to the stopped st-a tree per case, fresh cp -a operator copy, new UUID; head vs candidate differ only in the CLI child (dist-head / dist-cand)',
  blocks: [
    { table: t },
    { label: 'What the operator sees on stderr', pre: [
      '-- head:      source_drift: source_drift',
      '              Caused by: …WorkspaceRecoveryStore$RecoveryFailure: Workspace recovery: worker_failed',
      `++ candidate: ${venv?.worker ?? '?'}`,
    ].join('\n') },
    { note: 'Nothing changed while these captures ran. With the candidate, a same-UUID retry seals when the fix touches only unpinned entries; deleting a whole .venv also removes siblings the first attempt had already pinned, which is genuine drift, so that case needs a new UUID. The design says such entries "refuse"; the head maps unsupported_symlink / unsupported_file_type / a dangling realpath to source_drift, invalidates the cut and names no path, so the operator hunts for a writer that does not exist and needs a new UUID. A Python venv (bin/python3 -> /usr/bin/python3) anywhere in a shared storage blocks every capture of that storage.' },
  ],
};
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards/02-f1-unsupported-entries.json', JSON.stringify(card, null, 1));
for (const r of t) console.log(r.join(' | '));
