// Mutation runner for the PR's guard: mutate BrokerValues.java into a scratch
// copy, javac only that class into target/classes, run surefire on the given
// tests, parse the XML reports; finally recompile the original and compare the
// class hash with the one recorded before the run.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const [, , root, mdir, testsArg] = process.argv;
const tests = testsArg || 'BrokerValuesTest';
const srcFile = path.join(root, 'src/main/java/com/alibaba/qwen/code/runtimebroker/BrokerValues.java');
const classes = path.join(root, 'target/classes');
const cp = classes + ':' + fs.readFileSync(path.join(mdir, 'cp.txt'), 'utf8').trim();
const original = fs.readFileSync(srcFile, 'utf8');
const env = { ...process.env, JAVA_HOME: process.env.HOME + '/Install/jdk21', PATH: process.env.HOME + '/Install/jdk21/bin:' + process.env.PATH };

const NEG = `(decimal.scale() > MAXIMUM_DECIMAL_SCALE
                        || decimal.scale() < -MAXIMUM_DECIMAL_SCALE)`;
const mutants = [
  ['M1', 'drop the negative clause (base behaviour)', NEG, '(decimal.scale() > MAXIMUM_DECIMAL_SCALE)'],
  ['M2', 'negative bound off by one inward (< becomes <=)', '< -MAXIMUM_DECIMAL_SCALE)', '<= -MAXIMUM_DECIMAL_SCALE)'],
  ['M3', 'negative bound off by one outward (-2049 accepted)', '< -MAXIMUM_DECIMAL_SCALE)', '< -MAXIMUM_DECIMAL_SCALE - 1)'],
  ['M4', 'Math.abs(scale) > 2048 (overflows at MIN_VALUE)', NEG, '(Math.abs(decimal.scale()) > MAXIMUM_DECIMAL_SCALE)'],
  ['M5', '-scale > 2048 (negation overflows at MIN_VALUE)', 'decimal.scale() < -MAXIMUM_DECIMAL_SCALE)', '-decimal.scale() > MAXIMUM_DECIMAL_SCALE)'],
  ['M6', '|| becomes && (never rejects)', `MAXIMUM_DECIMAL_SCALE
                        || decimal.scale() <`, `MAXIMUM_DECIMAL_SCALE
                        && decimal.scale() <`],
  ['M7', 'positive bound off by one inward (> becomes >=)', 'decimal.scale() > MAXIMUM_DECIMAL_SCALE\n', 'decimal.scale() >= MAXIMUM_DECIMAL_SCALE\n'],
  ['M8', 'constant 2048 -> 2047', 'MAXIMUM_DECIMAL_SCALE = 2048;', 'MAXIMUM_DECIMAL_SCALE = 2047;'],
  ['M9', 'constant 2048 -> 2049', 'MAXIMUM_DECIMAL_SCALE = 2048;', 'MAXIMUM_DECIMAL_SCALE = 2049;'],
  ['M10', 'negative bound at the reader limit (-9999)', '< -MAXIMUM_DECIMAL_SCALE)', '< -9999)'],
  ['M11', 'list items skip the guard', 'copy.add(immutableValue(item));', 'copy.add(item);'],
  ['M12', 'nested maps skip the guard', 'return immutableMap(nested);', 'return Collections.unmodifiableMap(new LinkedHashMap<>(nested));'],
  ['M13', 'message text changed', '"JSON number scale must be within ±"', '"JSON number scale out of range: ±"'],
];

function compile(source, tag) {
  const dir = path.join(mdir, 'src', tag, 'com/alibaba/qwen/code/runtimebroker');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'BrokerValues.java');
  fs.writeFileSync(file, source);
  execFileSync('javac', ['--release', '21', '-parameters', '-g', '-encoding', 'UTF-8', '-d', classes, '-cp', cp, file], { env, stdio: 'pipe' });
}

function runTests() {
  const reports = path.join(root, 'target/surefire-reports');
  fs.rmSync(reports, { recursive: true, force: true });
  spawnSync('mvn', ['-o', '-q', 'surefire:test', '-Dtest=' + tests, '-Dsurefire.failIfNoSpecifiedTests=false'], { cwd: root, env, encoding: 'utf8' });
  const failed = [];
  let total = 0;
  for (const f of fs.existsSync(reports) ? fs.readdirSync(reports) : []) {
    if (!f.startsWith('TEST-') || !f.endsWith('.xml')) continue;
    const xml = fs.readFileSync(path.join(reports, f), 'utf8');
    for (const m of xml.matchAll(/<testcase name="([^"]+)" classname="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      total++;
      if (m[4] && /<(failure|error)/.test(m[4])) failed.push(m[2].split('.').pop() + '.' + m[1]);
    }
  }
  return { total, failed };
}

const results = [];
for (const [id, desc, from, to] of mutants) {
  if (!original.includes(from)) { results.push({ id, desc, verdict: 'NOT-APPLIED' }); continue; }
  compile(original.replace(from, to), id);
  const r = runTests();
  results.push({ id, desc, tests: tests, run: r.total, verdict: r.failed.length ? 'KILLED' : 'SURVIVED', killedBy: r.failed });
  console.log(JSON.stringify(results.at(-1)));
}
compile(original, 'original');
const sha = execFileSync('shasum', ['-a', '256', path.join(classes, 'com/alibaba/qwen/code/runtimebroker/BrokerValues.class')]).toString().split(' ')[0];
const expected = fs.readFileSync(path.join(mdir, 'original-class.sha'), 'utf8').split(' ')[0];
const baseline = runTests();
console.log(JSON.stringify({ restored: sha === expected, sha, baselineRun: baseline.total, baselineFailed: baseline.failed }));
fs.writeFileSync(path.join(mdir, 'results-' + tests.replace(/[^A-Za-z]+/g, '_') + '.json'), JSON.stringify(results, null, 2));
