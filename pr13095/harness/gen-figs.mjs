// Writes the evidence-card specs. Every number below is copied from results/LEDGER.txt (the run logs).
import { writeFileSync, mkdirSync } from 'node:fs';
const out = '/Users/wenshao/pr13095-rig/fig';
mkdirSync(out, { recursive: true });
const save = (name, spec) => writeFileSync(`${out}/${name}.json`, JSON.stringify(spec, null, 1));

save('01-mutation-matrix', {
  title: 'PR #13095 - guard mutation matrix, two lanes, real runs',
  subtitle: 'fast lane = full managed-agent-server surefire suite on H2 (ad80a75d, 199 tests; base 356262d8, 198 tests)  |  IT lane = HostedPublicWorkspaceIT on MySQL 8.4.7, bundled CLI, Node 22.23.2',
  blocks: [
    { heading: 'ManagedAgentStore.insertWorkspaceSessionCommand guards - one clause removed per mutant', lines: [
      '== mutant  clause removed             fast lane, base      fast lane, PR head                 IT lane, PR head (MySQL)',
      'M1      policy-ref             -- survived 198/0       ++ killed  [ws-policy]  :578          -- survived (no such fixture in the IT)',
      'M2      mount tenant           -- survived 198/0       ++ killed  [ws-tenant]  :578          -- survived (no such fixture in the IT)',
      'M8      mount storage-id       -- survived 198/0       ++ killed  [ws-tenant]  :578          ++ killed  :175 unmounted     409 -> 202',
      'M4      whole mount clause     -- survived 198/0       ++ killed  [ws-tenant]  :578          ++ killed  :175 unmounted     409 -> 202',
      'M5      config-ref             == not run               !! survived 199/0                    ++ killed  :184 unsupported   409 -> 202',
      'M6      agent-id               == not run               !! survived 199/0                    ++ killed  :166 other agent   409 -> 202',
      'M7      files opt-in (store)   == not run               !! survived 199/0                    !! survived',
    ] },
    { heading: 'Refusal error code changed, HTTP 409 kept (#13053)', lines: [
      '== mutant  literal changed            IT lane, base        IT lane, PR head (MySQL)                                    fast lane, PR head',
      'C1      registry non-ACTIVE    -- survived 1/0         ++ killed :171  expected "workspace_unavailable"            ++ killed (2 tests)',
      '                                                          but was "workspace_draining_mutated"',
      'C2      store execution        -- survived 1/0         ++ killed :166  expected "workspace_unavailable"            ++ killed (2 tests)',
      '                                                          but was "workspace_execution_mutated"',
    ] },
    { heading: 'What the fast-lane kill prints at ad80a75d (M1) - the label now survives', lines: [
      'java.lang.AssertionError:',
      '## [ws-policy]',
      'Expecting actual not to be null',
      '  at ...ManagedWorkspaceAdmissionTest.enabledCreationRefusesPolicyDriftAndAnotherTenantsMount(ManagedWorkspaceAdmissionTest.java:578)',
      '== at 6a602cde the same mutant printed only "Expecting code to raise a throwable." for both M1 and M2',
    ] },
  ],
  note: 'Every guard clause is killed by at least one lane except M7, which sits behind the service-level gate. The two clauses #13046 names (M1, M2) went from unguarded to killed, and each refusal in the IT is flipped by exactly its own clause. IT lane measured at 6a602cde; the IT file and the production tree are byte-identical at ad80a75d.',
});

save('02-tmpdir-real-child', {
  title: 'PR #13095 - #13045: what the Hosted Harness child really receives',
  subtitle: 'the IT is run with -Dnode.executable pointing at a transparent wrapper that logs the child environment, then execs the real Node 22.23.2',
  blocks: [
    { heading: 'macOS, role=harness (dist/cli.js serve --profile hosted-harness ...)', lines: [
      '## base 356262d8',
      'env names: HOME OPENAI_API_KEY OPENAI_BASE_URL PATH PWD QWEN_CODE_* QWEN_HOME QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST QWEN_RUNTIME_DIR QWEN_SERVER_TOKEN SHLVL USERPROFILE _',
      '-- TMPDIR=<unset>   TMP=<unset>   TEMP=<unset>',
      '-- os.tmpdir()=/tmp                      realpath=/private/tmp            (shared OS directory)',
      '## PR head',
      'env names: HOME ... SHLVL TEMP TMP TMPDIR USERPROFILE _',
      '++ TMPDIR=TMP=TEMP=/private/var/folders/cn/.../T/junit-16620884714723666387',
      '++ os.tmpdir()=/private/var/folders/cn/.../T/junit-16620884714723666387   (the test-owned @TempDir)',
    ] },
    { heading: 'Linux container (Ubuntu 24.04, JDK 21.0.9): /tmp watched with inotify; the JVMs use java.io.tmpdir=/jvmtmp', lines: [
      '## base 356262d8 - Tests run: 1, Failures: 0',
      '   /tmp events:  rename node-compile-cache',
      '                 rename node-compile-cache/v22.23.2-arm64-2b4477fa-0',
      '-- /tmp after the test:  /tmp/hsperfdata_root  /tmp/node-compile-cache  /tmp/node-compile-cache/v22.23.2-arm64-2b4477fa-0',
      '## PR head - Tests run: 1, Failures: 0',
      '   /tmp events:  (none besides the JVM hsperfdata)',
      '++ /tmp after the test:  /tmp/hsperfdata_root',
      '++ /jvmtmp events:       rename junit-*/node-compile-cache   rename junit-*/node-compile-cache/v22.23.2-arm64-2b4477fa-0',
    ] },
    { heading: 'Not changed by the PR: Runtime Broker workers (dist/cli.js managed-runtime-worker), both arms', lines: [
      '!! TMPDIR=/var/folders/cn/.../T/   HOME=/Users/<developer>   plus the whole environment of the test JVM',
    ] },
  ],
  note: 'Before the PR the Harness wrote Node\'s module compile cache into the shared /tmp and left it there. With the PR the same directory is created inside the JUnit @TempDir and removed with it. Issue #13045 expected no observable leak; there was one.',
});

save('03-diagnostics-only-on-failure', {
  title: 'PR #13095 - #13049: diagnostics are built only on failure',
  subtitle: 'MySQL general log counts the fixture\'s statements; JFR jdk.FileRead (threshold 0) counts reads of harness.log by the test JVM. 3 runs per arm, MySQL 8.4.7',
  blocks: [
    { heading: 'Successful run', lines: [
      '== run      status polls   Turn dump SELECT   event dump SELECT   harness.log read() calls   bytes read from harness.log',
      'base-1        76              -- 38                -- 38                 -- 88                       -- 71,318',
      'base-2        74              -- 37                -- 37                 -- 89                       -- 69,670',
      'base-3        60              -- 30                -- 30                 -- 69                       -- 54,970',
      'head-1       112              ++ 0                 ++ 0                  ++ 0                        ++ 0',
      'head-2        94              ++ 0                 ++ 0                  ++ 0                        ++ 0',
      'head-3        70              ++ 0                 ++ 0                  ++ 0                        ++ 0',
      '== harness.log is at most 1,994 bytes; base re-reads it on every poll of both waits (startHarness and the Turn wait)',
    ] },
    { heading: 'Injected failure 1: the model endpoint answers 400, so the Turn really becomes FAILED (hosted_turn_failed)', lines: [
      'base   Tests run: 1, Errors: 1, Time elapsed: 10.89 s   org.awaitility.core.TerminalFailureException',
      '       [Turn: [{status=FAILED, error_code=hosted_turn_failed}]; events: [{event_type=session.created, ...',
      'head   Tests run: 1, Errors: 1, Time elapsed: 11.92 s   org.awaitility.core.TerminalFailureException',
      '       Turn failed. Turn: [{status=FAILED, error_code=hosted_turn_failed}]; events: [{event_type=session.created, ...',
      '++ both arms: fail fast (35 s budget not used); message carries Turn, events, model requests and the Harness log',
    ] },
    { heading: 'Injected failure 2: the Harness process exits 7 before listening', lines: [
      'base   Tests run: 1, Errors: 1, Time elapsed: 35.41 s   org.awaitility.core.ConditionTimeoutException   [PROBE-FAULT: simulated Hosted Harness startup crash (exit 7) ...',
      'head   Tests run: 1, Errors: 1, Time elapsed: 36.03 s   org.awaitility.core.ConditionTimeoutException   Hosted Harness exited: PROBE-FAULT: simulated Hosted Harness startup crash (exit 7)',
      '!! both arms wait out the full 30 s startup budget although the process is already dead (unchanged by the PR)',
      '== optional +2/-1 candidate (failFast): 8.95 s, org.awaitility.core.TerminalFailureException, same message',
    ] },
  ],
  note: 'The success path no longer builds diagnostics: 60-76 diagnostic SELECTs and 55-71 kB of log re-reads per run drop to zero. Both failure branches behave as before and keep their diagnostics.',
});

save('04-real-databases-and-merge', {
  title: 'PR #13095 - real databases, and the tree that will land on main',
  subtitle: 'macOS 26.6.2 arm64, JDK 21.0.12, Maven 3.9.16, Node 22.23.2, bundled dist/cli.js; MySQL 8.4.7 (native), MariaDB 10.11.18 (container); Linux arm64 container for H2',
  blocks: [
    { heading: 'Fast lane - mvn test, managed-agent-server (H2)', lines: [
      'base   356262d8                              Tests run: 198, Failures: 0, Errors: 0, Skipped: 0',
      '++ head   ad80a75d                              Tests run: 199, Failures: 0, Errors: 0, Skipped: 0',
      '++ merge  ad80a75d + main 3a8fd117 (9eb5ca40)   Tests run: 243, Failures: 0, Errors: 0, Skipped: 0',
      '-- commit 1 (0aa2f82b) test file               Tests run: 18, Failures: 1   IllegalStateException: Workspace resolution requires a creation transaction',
    ] },
    { heading: 'HostedPublicWorkspaceIT - real Spring + bundled Hosted Harness + Runtime Broker workers', lines: [
      '== tree                             database              runs    result',
      '++ head 6a602cde                    MySQL 8.4.7            12     12 x Tests run: 1, Failures: 0, Errors: 0   (13.3-27.1 s)',
      '++ head ad80a75d                    MySQL 8.4.7             2      2 x Tests run: 1, Failures: 0, Errors: 0',
      '++ head 6a602cde / ad80a75d         MariaDB 10.11.18      2 / 1    3 x Tests run: 1, Failures: 0, Errors: 0',
      '++ head 6a602cde                    H2 (macOS)              1      1 x Tests run: 1, Failures: 0, Errors: 0',
      '++ head 6a602cde                    H2 (Linux container)    1      1 x Tests run: 1, Failures: 0, Errors: 0',
      '++ merge ad80a75d + main 3a8fd117   MySQL 8.4.7             2      2 x Tests run: 1, Failures: 0, Errors: 0   (23 Flyway migrations)',
      '++ merge ad80a75d + main 3a8fd117   MariaDB 10.11.18        2      2 x Tests run: 1, Failures: 0, Errors: 0',
      '== base 356262d8                    MySQL / MariaDB       4 / 1    5 x Tests run: 1, Failures: 0, Errors: 0',
    ] },
    { heading: 'Rows the IT left in MySQL (run head-mysql-1)', lines: [
      'sessions 2   turns COMPLETED 2   tool executions 6   registry rows 3   flyway migrations 19',
    ] },
  ],
  note: 'The IT the author could not run is green on real MySQL and MariaDB at both heads, and stays green after merging the two commits main gained during this run (#12946, #13108). The HostedPublicWorkspaceIT file and the production tree are byte-identical between 6a602cde and ad80a75d.',
});

save('05-optional-candidates', {
  title: 'PR #13095 - optional candidates (not required for merge)',
  subtitle: 'candidate A: +33/-7 in ManagedWorkspaceAdmissionTest, measured on ad80a75d  |  candidate B: +2/-1 in HostedPublicWorkspaceIT (file identical at 6a602cde and ad80a75d)',
  blocks: [
    { heading: 'Candidate A - three more cases in the same test (config drift, another agent, files opt-in off with mounts)', lines: [
      '++ unmutated:  class Tests run: 18, Failures: 0   full suite Tests run: 199, Failures: 0',
      '== mutant  clause removed          PR head as is              with candidate A',
      'M1      policy-ref             killed [ws-policy]         ++ killed [ws-policy]',
      'M2      mount tenant           killed [ws-tenant]         ++ killed [ws-tenant]',
      'M4      whole mount clause     killed [ws-tenant]         ++ killed [ws-tenant]',
      'M8      mount storage-id       killed [ws-tenant]         ++ killed [ws-tenant]',
      'M5      config-ref             !! survived                ++ killed [ws-config]',
      'M6      agent-id               !! survived                ++ killed [another-agent]',
      'M7      files opt-in (store)   !! survived                ++ killed [files-disabled]',
    ] },
    { heading: 'Candidate B - startup wait fails fast when the Harness has exited', lines: [
      'PR head       dead Harness   Time elapsed: 36.03 s   ConditionTimeoutException',
      '++ candidate B   dead Harness   Time elapsed: 8.951 s   TerminalFailureException: Hosted Harness exited: PROBE-FAULT: simulated ... (exit 7)',
      '++ candidate B   normal run     Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 17.75 s (MySQL 8.4.7)',
    ] },
  ],
  note: 'Both are follow-up material. M7 survives both lanes today; candidate A kills it: the store-level opt-in guard is observable only with the opt-in off, mounts configured and valid refs.',
});
console.log('specs written');
