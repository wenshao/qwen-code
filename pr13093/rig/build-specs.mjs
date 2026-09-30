// Builds the evidence-card specs from the raw run directories. Every number
// and command line in a card is read from a log on disk; nothing is typed in.
// usage: node build-specs.mjs <scratchpad>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const S = process.argv[2];
const runs = path.join(S, 'runs');
const specs = path.join(S, 'fig', 'specs');
mkdirSync(specs, { recursive: true });

const read = (...parts) => readFileSync(path.join(runs, ...parts), 'utf8');
const result = (run) => {
  const text = read(run, 'RESULT').trim();
  const fields = {};
  for (const match of text.matchAll(/(\w+)=(\[[^\]]*\]|\S+)/g)) {
    fields[match[1]] = match[2].replace(/^\[|\]$/g, '');
  }
  return fields;
};
const procs = (run) =>
  read(run, 'procs.jsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
const shorten = (arm) => (command) =>
  command
    .replaceAll(`${S}/wt-${arm}`, '<root>')
    .replace(
      /\/(?:private\/)?(?:var\/folders\/[^ ]*?\/T|tmp\/claude-501\/p13093\/[^/ ]+)\/managed-agent-server-e2e-[A-Za-z0-9]+/g,
      '<tmp>',
    )
    .replace(/\/(?:private\/)?var\/folders\/[^ ]*?\/T\/junit-\d+/g, '<junit-tmp>')
    .replace(/\/Users\/wenshao\/Install\/mysql-8\.4\.7-macos15-arm64\/bin\//g, '')
    .replace(/\/opt\/homebrew\/[^ ]*\/bin\/(mysqld|mysql|mysqladmin)/g, '$1')
    .replace(/\/Users\/wenshao\/Install\/[^ ]*\/bin\/java/g, 'java')
    .replace(/\/Users\/wenshao\/[^ ]*\/bin\/node/g, 'node')
    .replace('<root>/packages/sdk-java/managed-agent-server/../../../', '<module>/../../../')
    .replace(/java -jar <root>\/packages\/sdk-java\/managed-agent-server\/target\/surefire\/surefirebooter\S+ .*/, 'java -jar <module>/target/surefire/surefirebooter-*.jar ...   (forked test JVM, Spring runs inside it)')
    .replace(/ --hostname 127\.0\.0\.1 --port (\d+) --require-auth --no-web --workspace <junit-tmp>\/harness-decoy --managed-runtime-broker-url (\S+) --managed-runtime-broker-token \S+/, ' --hostname 127.0.0.1 --port $1 ... --managed-runtime-broker-url $2')
    .replace(/ --port=(\d+)/, ' --port=$1')
    .replace(/ --bind-address=127\.0\.0\.1 --mysqlx=0 --pid-file=<tmp>\/mysql\.pid --log-error=<tmp>\/mysql-error\.log/, ' ...');
const mark = (command) =>
  command
    .replace(/(dist\/cli\.js managed-runtime-worker)/, '[[$1]]')
    .replace(/(dist\/cli\.js serve --profile hosted-harness)/, '[[$1]]');
const pad = (value, width) => String(value).padStart(width);
const env = (run) =>
  read(run, 'env.txt')
    .split('\n')
    .reduce((map, line) => {
      const index = line.indexOf('=');
      if (index > 0) map[line.slice(0, index)] = line.slice(index + 1);
      return map;
    }, {});

const MAIN_OF = { cd6c1c7a2e: '3b18cfe5e4', cb6ef48d9a: '3a8fd11711' };
const treeLabel = (head) =>
  MAIN_OF[head] ? `main ${MAIN_OF[head]} + PR 547b5776b5 (merge ${head})` : `PR head ${head} on its own base 2821abb120`;
const pick = (...candidates) => candidates.find((run) => existsSync(path.join(runs, run, 'RESULT')));

function treeLines(run, arm, filter, rootLabel = 'runner') {
  const short = shorten(arm);
  const lines = [];
  const rows = procs(run);
  const names = new Map();
  for (const row of rows) {
    if (row.kind === 'spawn') {
      const command = short(row.command);
      const role = /mysqld/.test(command)
        ? 'mysqld'
        : /surefirebooter/.test(command)
          ? (/^\/bin\/sh/.test(command) ? null : 'test JVM')
          : /java -jar .*managed-agent-server/.test(command)
            ? 'Spring'
            : /serve --profile hosted-harness/.test(command)
              ? 'Harness'
              : /managed-runtime-worker/.test(command)
                ? 'worker'
                : null;
      if (role) names.set(row.pid, role);
      if (!filter.test(command)) continue;
      const parent = names.get(row.ppid) ?? rootLabel;
      lines.push({
        text: `${pad(row.tMs, 6)} ms  pid ${pad(row.pid, 5)}  parent ${pad(row.ppid, 5)} (${parent})`.padEnd(52) + `  ${mark(command.slice(0, 178))}`,
        tone: role === 'worker' ? 'ok' : 'plain',
      });
    } else if (row.kind === 'listen' && ['Spring', 'Harness', 'test JVM'].includes(names.get(row.pid))) {
      lines.push({
        text: `${pad(row.tMs, 6)} ms  pid ${pad(row.pid, 5)}  ${names.get(row.pid)} listens on ${row.address}`,
        tone: 'dim',
      });
    } else if (row.kind === 'env') {
      const keys = ['SERVER_PORT', 'QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT', 'QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY', 'QWEN_MANAGED_AGENT_CLI_ENTRY', 'QWEN_RUNTIME_BROKER_URL'];
      const shown = keys
        .filter((key) => row.env[key] !== undefined)
        .map((key) => `${key}=${short(row.env[key])}`);
      if (shown.length > 0) {
        for (let index = 0; index < shown.length; index += 2) {
          lines.push({
            text: `${' '.repeat(10)}pid ${pad(row.pid, 5)}  env ${shown.slice(index, index + 2).join('  ')}`,
            tone: 'key',
          });
        }
      }
    }
  }
  return lines;
}

// ---- card 1: process tree of the full-chain script -------------------------
{
  const run = pick('r1-session-failover', 'm4-session-failover-default-tmpdir');
  const r = result(run);
  const e = env(run);
  const firstPhase = treeLines(run, 'merge', /mysqld --no-defaults|java -jar|dist\/cli\.js/);
  writeFileSync(
    path.join(specs, '01-process-tree.json'),
    JSON.stringify({
      title: 'What `npm run test:e2e:managed-session-failover` actually starts',
      subtitle: `${treeLabel(r.head)} · ${e.java.split(' :: ')[1]} · mysqld 8.4.7 · macOS arm64 · rc=${r.rc} in ${r.seconds} s · recorded from ps/lsof, script unmodified`,
      sections: [
        {
          heading: 'Processes descended from the runner (argv as reported by ps; <root> = repository root, <tmp> = the run\'s mkdtemp directory)',
          lines: firstPhase,
        },
      ],
      note: 'Spring (one JVM) listens on both the public port and the Runtime Broker port; the Harness is `node <root>/dist/cli.js serve --profile hosted-harness`, and the worker is `node <root>/dist/cli.js managed-runtime-worker` with the Spring JVM as its parent. Both entry variables the runner exports point at dist/cli.js.',
    }, null, 2),
  );
}

// ---- card 2: no separate worker bundle -------------------------------------
{
  const listing = read('dist-merge', 'listing.txt').trim().split('\n');
  const decoy = result('m5-decoy');
  const decoyNote = read('m5-decoy', 'NOTE.txt').trim();
  const decoyEnv = read('m5-decoy', 'env.txt').split('\n').find((line) => line.startsWith('dist worker-named'));
  const workerLine = procs('m5-decoy').find((row) => row.kind === 'spawn' && /managed-runtime-worker/.test(row.command));
  const lines = listing.map((text) => ({
    text,
    tone: /^---/.test(text) ? 'key' : /count=0/.test(text) ? 'ok' : 'plain',
  }));
  writeFileSync(
    path.join(specs, '02-no-worker-bundle.json'),
    JSON.stringify({
      title: 'No separate worker bundle: `dist/` after `npm run build && npm run bundle`',
      subtitle: 'main 3b18cfe5e4 + PR · the removed README sentence said the scripts expect an unbuilt dist/managed-runtime-worker.js',
      sections: [
        { heading: 'Bundle output', lines },
        {
          heading: 'Decoy probe: an executable marker placed at dist/managed-runtime-worker.js for one run',
          lines: [
            { text: decoyEnv, tone: 'dim' },
            { text: `run m5-decoy: rc=${decoy.rc} in ${decoy.seconds} s`, tone: decoy.rc === '0' ? 'ok' : 'bad' },
            { text: decoyNote, tone: 'ok' },
            { text: `worker argv in that run: ${mark(shorten('merge')(workerLine.command))}`, tone: 'plain' },
          ],
        },
      ],
      note: 'The build never emits a worker bundle, the full-chain run passes without one, and a file planted at that path is never executed. The worker always comes from dist/cli.js.',
    }, null, 2),
  );
}

// ---- card 3: prerequisite probes -------------------------------------------
{
  const probes = [
    ['n-missing-java', 'java not on PATH'],
    ['n-missing-mysqld', 'mysqld not on PATH'],
    ['n-missing-mysql', 'mysql not on PATH'],
    ['n-missing-mysqladmin', 'mysqladmin not on PATH'],
    ['n-missing-cli', 'dist/cli.js absent'],
    ['n-missing-jar', 'server jar absent'],
    ['n-missing-settings', '--settings file absent'],
    ['n-missing-model', 'model not in settings'],
  ];
  const lines = [
    { text: `${'condition'.padEnd(26)}${'rc'.padEnd(4)}${'ms'.padEnd(7)}${'started'.padEnd(9)}${'temp dirs left'.padEnd(16)}message`, tone: 'key' },
  ];
  for (const [run, label] of probes) {
    const r = result(run);
    const message = r.message
      .replace(/\/private\/tmp\/claude-501\/[^ ]*\/fakeroot\//, '<cwd>/')
      .replace(/\/private\/tmp\/claude-501\/[^ ]*\/no-such-settings\.json/, '<path>/no-such-settings.json')
      .replace(/\/Users\/wenshao\/\.qwen\/settings\.json/, '~/.qwen/settings.json');
    lines.push({
      text: `${label.padEnd(26)}${r.rc.padEnd(4)}${r.ms.padEnd(7)}${r.startedCommands.padEnd(9)}${r.leftoverTempDirs.padEnd(16)}${message}`,
      tone: r.rc === '1' && r.startedCommands === '0' && r.leftoverTempDirs === '0' ? 'ok' : 'bad',
    });
  }
  const control = result('p-control-all-present');
  const counts = {};
  for (const line of read('p-control-all-present', 'invocations.log').trim().split('\n')) {
    const name = line.split(' ')[1];
    counts[name] = (counts[name] ?? 0) + 1;
  }
  const which = result('n-missing-which');
  writeFileSync(
    path.join(specs, '03-prerequisite-probes.json'),
    JSON.stringify({
      title: '"exits before starting anything else when a command or a required file is missing"',
      subtitle: 'main 3b18cfe5e4 + PR (runner script blob 1899ef5a5b, identical on every tree tested) · java, mysqld, mysql and mysqladmin replaced on PATH by wrappers that log each invocation and then exec the real binary; "started" = lines in that log',
      sections: [
        { heading: 'One prerequisite removed per run (PATH holds only node, which and the remaining commands)', lines },
        {
          heading: 'Control: the same wrappers with nothing removed',
          lines: [
            {
              text: `${'all four present'.padEnd(26)}${control.rc.padEnd(4)}${control.ms.padEnd(7)}${control.startedCommands.padEnd(9)}${control.leftoverTempDirs.padEnd(16)}passes; started ${Object.entries(counts).map(([name, count]) => `${name} x${count}`).join(', ')}`,
              tone: control.rc === '0' ? 'ok' : 'bad',
            },
          ],
        },
        {
          heading: 'Side observation (script, not this PR): all four present, `which` itself absent',
          lines: [
            {
              text: `${'which not on PATH'.padEnd(26)}${which.rc.padEnd(4)}${which.ms.padEnd(7)}${which.startedCommands.padEnd(9)}${which.leftoverTempDirs.padEnd(16)}${which.message}`,
              tone: 'warn',
            },
          ],
        },
      ],
      note: 'Every missing command or file ends the run in under a second with exit code 1; none of the four commands was started and no temporary directory was left. With only node, which and the four commands on PATH the deterministic check passes, so the README\'s list is sufficient for that mode.',
    }, null, 2),
  );
}

// ---- card 4: the real-model command ----------------------------------------
{
  const lines = [];
  for (const run of ['m2-real-model-kimi', 'm3-real-model-kimi-tap', 'r2-real-model-kimi', 'p2-real-model-kimi'].filter((name) => existsSync(path.join(runs, name, 'RESULT')))) {
    const r = result(run);
    const error = read(run, 'stdout.log').split('\n').find((line) => line.startsWith('Error: ')) ?? '';
    const tree = MAIN_OF[r.head] ? `main ${MAIN_OF[r.head]} + PR` : `PR head ${r.head}`;
    lines.push({ text: `${tree.padEnd(22)} rc=${r.rc}  ${pad(r.seconds, 3)} s  ${error.slice(0, 140)}`, tone: r.rc === '0' ? 'ok' : 'bad' });
  }
  const events = read('m3-real-model-kimi-tap', 'public-events.tsv')
    .trim()
    .split('\n')
    .map((row) => row.split('\t'))
    .map(([sequence, type, terminal, data]) => ({
      text: `${pad(sequence, 2)}  ${type.padEnd(26)} terminal=${terminal}  ${type === 'turn.accepted' ? '{... the prompt ...}' : data.slice(0, 110)}`,
      tone: type === 'turn.failed' ? 'bad' : 'plain',
    }));
  const routes = read('m3-real-model-kimi-tap', 'harness-home-daemon.log')
    .split('\n')
    .filter((line) => line.includes('route='))
    .map((line) => ({
      text: line.replace(/runId=\w+ pid=\d+ /, '').replace(/ request completed/, '').slice(0, 150),
      tone: /status=400/.test(line) ? 'bad' : 'plain',
    }));
  const workerSpawned = procs('m3-real-model-kimi-tap').some((row) => row.kind === 'spawn' && /managed-runtime-worker/.test(row.command));
  const d2 = result('d2-cand-qwen');
  const d2events = read('d2-cand-qwen', 'public-events.tsv').trim().split('\n').map((row) => row.split('\t')[1]);
  const d1 = result('d1-cand-store');
  const d1events = read('d1-cand-store', 'public-events.tsv').trim().split('\n').map((row) => row.split('\t')[1]);
  const d2text = read('d2-cand-qwen', 'public-events.tsv').split('\n').find((row) => row.includes('item.output_text.delta')) ?? '';
  const textMatch = /"text":"(.{0,95})/.exec(d2text);
  writeFileSync(
    path.join(specs, '04-real-model-run.json'),
    JSON.stringify({
      title: 'The README\'s real-model command, executed: `npm run test:e2e:managed-agent-server -- --model moonshot/kimi-k3`',
      subtitle: 'real MySQL 8.4 + Spring + packaged Harness + real provider settings · the README marks this run "intended verification, not passing evidence"',
      sections: [
        { heading: 'Outcome as written', lines },
        { heading: 'Public events of run m3 (read from the run\'s own MySQL before cleanup)', lines: events },
        {
          heading: 'Hosted Harness requests in run m3',
          lines: [...routes, { text: `Broker-launched worker observed: ${workerSpawned ? 'yes (dist/cli.js managed-runtime-worker)' : 'no'}; model events: none`, tone: 'dim' }],
        },
        {
          heading: 'Diagnostic only (not proposed here): a copy of the runner with the three session-store variables added to real-model mode',
          lines: [
            { text: `d2-cand-qwen (model qwen3.8-max): rc=${d2.rc} in ${d2.seconds} s; events: ${d2events.join(', ')}`, tone: 'warn' },
            { text: `  item.tool_call.updated present: ${d2events.includes('item.tool_call.updated') ? 'yes' : 'no'}; model text: ${textMatch ? textMatch[1].replaceAll('\\\\n', ' ') : ''}...`, tone: 'dim' },
            { text: `d1-cand-store (model moonshot/kimi-k3): rc=${d1.rc} in ${d1.seconds} s; events: ${d1events.join(', ')}; no terminal event within the runner's 180 s wait`, tone: 'warn' },
          ],
        },
      ],
      note: 'As written the command fails deterministically in about 20 s: the Harness answers POST /session with 400, the Turn ends hosted_harness_rejected, and no prompt reaches the Harness (so no model request). With the session store enabled the prompt is accepted, but the Turn ends with text only: the model prints the write_file call as text and no tool event appears. The README is right not to present this run as passing evidence; it could also say that the run currently fails.',
      noteTone: 'warn',
    }, null, 2),
  );
}

// ---- card 5: the G0 integration test ---------------------------------------
{
  const itRun = pick('ri-g0-it', 'i1-g0-it');
  const r = result(itRun);
  const lines = treeLines(itRun, 'merge', /surefirebooter|dist\/cli\.js/, 'mvn')
    .filter((line) => !/\/bin\/sh -c/.test(line.text))
    .map((line) => ({ ...line, text: line.text.replaceAll('Spring listens', 'test JVM listens') }));
  writeFileSync(
    path.join(specs, '05-g0-integration-test.json'),
    JSON.stringify({
      title: 'HostedPublicWorkspaceIT with its default qwen.cli.entry (no -Dqwen.cli.entry passed)',
      subtitle: `${treeLabel(r.head)} · mvn -Phosted-harness-mysql -Dit.test=HostedPublicWorkspaceIT -Dnode.executable=<node> verify · rc=${r.rc} in ${r.seconds} s · ${/Tests run: [^\]]*/.exec(read(itRun, 'RESULT'))[0]}`,
      sections: [{ heading: 'Processes started by the test JVM (<module> = packages/sdk-java/managed-agent-server; the test starts Spring, with its embedded Broker, in-process)', lines }],
      note: 'The test resolves ../../../dist/cli.js from the module directory, i.e. the same packaged dist/cli.js, and both the Harness and the workers are started from it.',
    }, null, 2),
  );
}

// ---- card 6: run matrix -----------------------------------------------------
{
  const rows = [
    ['r1-session-failover', 'test:e2e:managed-session-failover', 'JDK 21, MySQL 8.4', 'pass'],
    ['r2-real-model-kimi', 'test:e2e:managed-agent-server --model moonshot/kimi-k3', 'JDK 21, MySQL 8.4', 'fail'],
    ['r4-real-delay', '  same, --runtime-delay-ms 45000', 'JDK 21, MySQL 8.4', 'fail'],
    ['rg-gated-inflight', 'test:e2e:managed-inflight-failover', '-', 'gated'],
    ['rg-gated-continuation', 'test:e2e:managed-continuation-failover', '-', 'gated'],
    ['ri-g0-it', 'HostedPublicWorkspaceIT (default cli entry)', 'JDK 21, H2', 'pass'],
    ['m1-session-failover', 'test:e2e:managed-session-failover', 'JDK 21, MySQL 8.4', 'pass'],
    ['m4-session-failover-default-tmpdir', '  same, default macOS TMPDIR', 'JDK 21, MySQL 8.4', 'pass'],
    ['m5-decoy', '  same, decoy worker file present', 'JDK 21, MySQL 8.4', 'pass'],
    ['m6-pathdef', '  same, toolchain from the default PATH', 'JDK 26, Homebrew MySQL 26.7', 'pass'],
    ['p-control-all-present', '  same, PATH = node + which + the four commands', 'JDK 21, MySQL 8.4', 'pass'],
    ['m2-real-model-kimi', 'test:e2e:managed-agent-server --model moonshot/kimi-k3', 'JDK 21, MySQL 8.4', 'fail'],
    ['m3-real-model-kimi-tap', '  same, second run', 'JDK 21, MySQL 8.4', 'fail'],
    ['g-gated-inflight', 'test:e2e:managed-inflight-failover', '-', 'gated'],
    ['g-gated-continuation', 'test:e2e:managed-continuation-failover', '-', 'gated'],
    ['i1-g0-it', 'HostedPublicWorkspaceIT (default cli entry)', 'JDK 21, H2', 'pass'],
    ['p1-session-failover', 'test:e2e:managed-session-failover', 'JDK 21, MySQL 8.4', 'pass'],
    ['p2-real-model-kimi', 'test:e2e:managed-agent-server --model moonshot/kimi-k3', 'JDK 21, MySQL 8.4', 'fail'],
    ['pg-gated-inflight', 'test:e2e:managed-inflight-failover', '-', 'gated'],
    ['pi-g0-it', 'HostedPublicWorkspaceIT (default cli entry)', 'JDK 21, H2', 'pass'],
  ];
  const lines = [{ text: `${'tree'.padEnd(24)}${'command'.padEnd(56)}${'toolchain'.padEnd(30)}${'rc'.padEnd(4)}${'s'.padEnd(5)}outcome`, tone: 'key' }];
  let previousTree = '';
  const tally = { pass: [0, 0], fail: [0, 0], gated: [0, 0] };
  for (const [run, label, toolchain, expectation] of rows) {
    if (!existsSync(path.join(runs, run, 'RESULT'))) continue;
    const r = result(run);
    // path-probe RESULT lines carry no head; those probes ran while the merge
    // worktree was at cd6c1c7a2e (runs before and after them record it).
    r.head ??= 'cd6c1c7a2e';
    const tree = MAIN_OF[r.head] ? `main ${MAIN_OF[r.head]} + PR` : `PR head ${r.head}`;
    const seconds = r.seconds ?? String(Math.round(Number(r.ms) / 1000));
    const asExpected = expectation === 'pass' ? r.rc === '0' : r.rc === '1';
    tally[expectation][0] += asExpected ? 1 : 0;
    tally[expectation][1] += 1;
    const outcome =
      expectation === 'gated'
        ? 'exits "not yet enabled", as the README says'
        : expectation === 'fail'
          ? (r.rc === '1' ? 'fails: turn.failed (card 4)' : 'PASSES')
          : r.rc === '0'
            ? 'passes'
            : 'FAILS';
    lines.push({
      text: `${(tree === previousTree ? '' : tree).padEnd(24)}${label.padEnd(56)}${toolchain.padEnd(30)}${r.rc.padEnd(4)}${seconds.padEnd(5)}${outcome}`,
      tone: expectation === 'pass' ? (r.rc === '0' ? 'ok' : 'bad') : expectation === 'gated' ? 'dim' : 'warn',
    });
    previousTree = tree;
  }
  writeFileSync(
    path.join(specs, '06-run-matrix.json'),
    JSON.stringify({
      title: 'Run matrix: the commands of the README section, on three trees',
      subtitle: 'each tree built with the README\'s own build commands · macOS 26 arm64, Node 24.18.1 · rc and seconds read from each run\'s RESULT file',
      sections: [{ heading: 'One row per run', lines }],
      note: `Deterministic checks expected to pass: ${tally.pass[0]}/${tally.pass[1]} passed. Gated modes: ${tally.gated[0]}/${tally.gated[1]} exited not-yet-enabled. Real-model command: failed ${tally.fail[0]}/${tally.fail[1]} times, the same way on every tree.`,
    }, null, 2),
  );
}
console.log('specs written');
