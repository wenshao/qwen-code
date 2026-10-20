// Drives every scenario on one arm. Usage: node drive.mjs <arm> [only]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeTopicStore, writeFixedLineStore, handWrittenIndex } from './fixtures.mjs';

const [arm, only] = process.argv.slice(2);
const H = '/root/verify/pr14841/harness';
const SCEN = '/root/verify/pr14841/scen';

function run(scen, prompt, script = []) {
  const out = execFileSync('node', [`${H}/run-scenario.mjs`, arm, scen, prompt, JSON.stringify(script)], { encoding: 'utf8', timeout: 240000 });
  return JSON.parse(out.trim().split('\n').at(-1));
}
function extract(wireDir) {
  return JSON.parse(execFileSync('node', [`${H}/extract.mjs`, wireDir], { encoding: 'utf8' }));
}
function fresh(name) {
  const scen = path.join(SCEN, `${name}-${arm}`);
  fs.rmSync(scen, { recursive: true, force: true });
  fs.mkdirSync(path.join(scen, 'home'), { recursive: true });
  fs.mkdirSync(path.join(scen, 'proj'), { recursive: true });
  execFileSync('git', ['init', '-q', path.join(scen, 'proj')]);
  // Probe run scaffolds the managed memory dir; locate it.
  run(scen, 'hi');
  const found = execFileSync('find', [path.join(scen, 'home'), '-type', 'd', '-path', '*/projects/*', '-name', 'memory'], { encoding: 'utf8' }).trim().split('\n')[0];
  if (!found) throw new Error('memory dir not found for ' + scen);
  return { scen, memDir: found };
}
function writeCall(memDir, rel, fm) {
  return { tool: { name: 'write_file', args: { file_path: path.join(memDir, rel), content: fm } } };
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
function indexStats(memDir) {
  const f = path.join(memDir, 'MEMORY.md');
  const t = fs.readFileSync(f, 'utf8');
  const lines = t.split('\n');
  return { sha: sha(f), length: t.length, entryLines: lines.filter((l) => l.startsWith('- [')).length,
    endsWithWriterNotice: t.trimEnd().endsWith('only part of it was written. Keep index entries concise and move detail into topic files.'),
    longestLine: Math.max(...lines.map((l) => l.length)) };
}
const results = {};
const want = (n) => !only || only.split(',').includes(n);

// S1: hand-written, every entry legal, count overflow (author's fixture).
if (want('s1')) {
  const { scen, memDir } = fresh('s1-hand-count');
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), handWrittenIndex(170, 150).join('\n') + '\n');
  results.s1 = extract(run(scen, 'hi').outDir);
}
// S2 / S3 / S4: real writer path. Seed topic files, let the model save one more
// memory via write_file (qwen's post-write refresh rebuilds MEMORY.md), then a
// fresh session reads it.
const newFact = (title, desc, type = 'project') => ['---', `name: ${title}`, `description: ${desc}`, `type: ${type}`,
  'category: workflow', 'keywords:', '  - "staging vpn"', 'usage_scenarios:', '  - "deploying to staging"', '---', '', 'Staging deploy needs the VPN.', ''].join('\n');
function writerScenario(key, name, seed, rel, fm) {
  const { scen, memDir } = fresh(name);
  seed(memDir);
  const topicCount = Number(execFileSync('bash', ['-c', `find '${memDir}' -mindepth 2 -name '*.md' | wc -l`], { encoding: 'utf8' }).trim());
  // Clear the probe-run scaffold so a non-empty MEMORY.md proves the writer ran.
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '');
  const save = JSON.parse(execFileSync('node', [`${H}/run-tui.mjs`, arm, scen, 'Remember that the staging deploy needs the VPN.',
    JSON.stringify([writeCall(memDir, rel, fm), { text: 'Saved.' }]), path.join(memDir, 'MEMORY.md')], { encoding: 'utf8', timeout: 200000 }).trim().split('\n').at(-1));
  const savedExists = fs.existsSync(path.join(memDir, rel));
  const idx = indexStats(memDir);
  const capture = extract(run(scen, 'hi').outDir);
  results[key] = { topicFilesBeforeSave: topicCount, save, savedExists, writerIndex: idx, capture };
}
if (want('s2')) writerScenario('s2', 's2-writer-realistic', (m) => writeTopicStore(m, 200), 'project/staging-vpn.md',
  newFact('staging deploy needs vpn', 'Deploying to the staging cluster only works from inside the corporate VPN; the gateway rejects public egress'));
if (want('s3')) writerScenario('s3', 's3-writer-147', (m) => writeFixedLineStore(m, 180, 147), 'project/fixed-999.md',
  newFact('Fixed 999', ('d999 ' + 'x'.repeat(400)).slice(0, 147 - '- [Fixed 999](project/fixed-999.md) — '.length)));
if (want('s4')) writerScenario('s4', 's4-writer-longlink', (m) => {
  writeTopicStore(m, 200);
  // One memory whose FILE PATH is long: the writer never shortens a link, so its line runs past 150.
  const rel = 'reference/' + 'kubernetes-staging-cluster-ingress-controller-certificate-rotation-runbook-for-the-shared-gateway-and-its-fallback-path.md';
  fs.writeFileSync(path.join(m, rel), newFact('cert rotation runbook', 'How to rotate the ingress certificate', 'reference'));
}, 'project/staging-vpn.md', newFact('staging deploy needs vpn', 'Deploying to the staging cluster only works from inside the corporate VPN'));
// S5: hand-written, dropped entry title has an astral char straddling the 60-unit name cut.
if (want('s5')) {
  const { scen, memDir } = fresh('s5-hand-surrogate');
  const name = (i) => (i >= 165 ? `${'A'.repeat(58)}😀 deploy notes ${i}` : `Topic ${i}`);
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), handWrittenIndex(170, 150, name).join('\n') + '\n');
  results.s5 = extract(run(scen, 'hi').outDir);
}
// S7: hand-written, line cap AND char budget both exceeded.
if (want('s7')) {
  const { scen, memDir } = fresh('s7-hand-lines-and-chars');
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), handWrittenIndex(250, 150).join('\n') + '\n');
  results.s7 = extract(run(scen, 'hi').outDir);
}
// S6: in-budget control.
if (want('s6')) {
  const { scen, memDir } = fresh('s6-control');
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), handWrittenIndex(3, 120).join('\n') + '\n');
  results.s6 = extract(run(scen, 'hi').outDir);
}
fs.writeFileSync(path.join(SCEN, `results-${arm}${only ? '-' + only.replace(/,/g, '_') : ''}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
