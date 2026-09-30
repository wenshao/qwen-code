// Copies the figures, the rig and the per-run evidence into <out>/pr13093 and
// refuses to finish if any copied text file contains a credential value from
// the local settings. Creates files only; never deletes.
// usage: node assemble-bundle.mjs <scratchpad> <outDir>
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const [S, out] = process.argv.slice(2);
const root = path.join(out, 'pr13093');
const copy = (from, to) => {
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
};

for (const name of readdirSync(path.join(S, 'fig'))) {
  if (name.endsWith('.png')) copy(path.join(S, 'fig', name), path.join(root, name));
}
for (const name of readdirSync(path.join(S, 'rig'))) {
  copy(path.join(S, 'rig', name), path.join(root, 'rig', name));
}
copy(path.join(S, 'build-arm.sh'), path.join(root, 'rig', 'build-arm.sh'));
copy(path.join(S, 'build-refresh.sh'), path.join(root, 'rig', 'build-refresh.sh'));
copy(path.join(S, 'cand', 'diagnostic.diff'), path.join(root, 'rig', 'diagnostic-session-store.diff'));
copy(path.join(S, 'logs', 'build-merge.summary'), path.join(root, 'results', 'build-main-3b18cfe5e4-plus-pr.summary'));
copy(path.join(S, 'logs', 'build-merge2.summary'), path.join(root, 'results', 'build-main-3a8fd11711-plus-pr.summary'));
copy(path.join(S, 'logs', 'build-pr.summary'), path.join(root, 'results', 'build-pr-head.summary'));
writeFileSync(
  path.join(root, 'results', 'build-pr-head.flaky-unit-test.excerpt.txt'),
  readFileSync(path.join(S, 'logs', 'build-pr.mvn-server.attempt1.log'), 'utf8')
    .split('\n')
    .slice(1079, 1100)
    .join('\n'),
);

const keep = new Set([
  'RESULT', 'RESULTS', 'env.txt', 'NOTE.txt', 'procs.jsonl', 'invocations.log',
  'public-events.tsv', 'harness-settings-keys.txt', 'harness-home-daemon.log',
  'replacement-harness-home-daemon.log', 'listing.txt', 'stderr.log', 'stdout.log',
]);
for (const entry of readdirSync(path.join(S, 'runs'))) {
  const source = path.join(S, 'runs', entry);
  if (statSync(source).isFile()) {
    if (/\.txt$/.test(entry) && entry !== 'poison-marker.txt') {
      copy(source, path.join(root, 'results', entry));
    }
    continue;
  }
  for (const name of readdirSync(source)) {
    const file = path.join(source, name);
    if (!keep.has(name) || !statSync(file).isFile()) continue;
    if (name === 'stdout.log' && statSync(file).size > 200_000) continue;
    copy(file, path.join(root, 'results', entry, name));
  }
}

const settings = JSON.parse(readFileSync(path.join(homedir(), '.qwen', 'settings.json'), 'utf8'));
const values = [...Object.values(settings.env ?? {}), settings.security?.auth?.apiKey].filter(
  (value) => typeof value === 'string' && value.length >= 8,
);
let files = 0;
let hits = 0;
const walk = (directory) => {
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) {
      walk(file);
      continue;
    }
    files += 1;
    if (file.endsWith('.png')) continue;
    const text = readFileSync(file, 'utf8');
    for (const value of values) {
      if (text.includes(value)) {
        hits += 1;
        console.log(`CREDENTIAL VALUE in ${file}`);
      }
    }
    const patterns = text.match(/sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9_.-]{16,}|LTAI[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|@gmail\.com/g);
    if (patterns) {
      hits += patterns.length;
      console.log(`PATTERN in ${file}: ${[...new Set(patterns)].map((match) => `${match.slice(0, 10)}...`).join(' ')}`);
    }
  }
};
walk(root);
console.log(`files=${files} credentialValuesChecked=${values.length} hits=${hits}`);
if (hits > 0) process.exit(1);
