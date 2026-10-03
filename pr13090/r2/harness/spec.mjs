// Round-2 cards for PR #13090 @ 02eaf790 (English only).
import fs from 'node:fs';
const D = JSON.parse(fs.readFileSync(new URL('./data.json', import.meta.url), 'utf8'));
const cards = [
{
  name: 'r2-01-gates',
  title: 'Round 2 @ 083a7efc (code = 02eaf790) — base is main; the PR is gates, CI lane, runbook and the OSS factory seam',
  subtitle: 'Local: macOS 26 arm64 · Zulu JDK 21.0.12 · Maven 3.9.16 · MySQL 8.4.7 (UTC) · JVM TZ Asia/Shanghai · host load ~36 · real Aliyun OSS cn-hangzhou (new temporary bucket, deleted)',
  lines: [
    '## merge audit (4b85454c Merge origin/main, by the maintainer account)',
    '++ diff vs main = 17 files, exactly the PR delta; merge-base = fa795e02 (#13225, O4-2 replacement, merged 00:17Z)',
    '++ dropped branch V33__managed_tool_output_collection.sql == main V34 (same blob 8547d72f); 33 versions unique',
    '++ remerge-diff: reliable-close docs + WorkspaceRecoveryStoreTest == main; retention docs = main + O4-3 first paragraph',
    '',
    '## local gates (runbook two-stage entry)',
    '++ default clean verify checkstyle:check: Tests run 527, Failures 0, Errors 0, Skipped 0 · Checkstyle 0',
    '++ -P o4-mysql-gates: surefire 527/527 + O4MySqlGate 40/40, 0 skipped · maven 0 · checker 0 → PASS (282 s)',
    ...D.oss,
    '',
    '## product CI on this head (first Linux execution of the O4 gate)',
    ...D.ci,
  ],
  note: D.note1,
  noteColor: '#3fb950',
},
{
  name: 'r2-02-status',
  title: 'Round-1 findings at 083a7efc',
  subtitle: 'ToolPublicationCollector is byte-identical to the d41914ff build measured in round 1; main\'s V30 still defaults write_evidence to FALSE',
  lines: [
    '## deferred by the author to #12380 (stated in the PR body Risk & Scope, both languages)',
    '!! F1 permanent blockers re-poll every 60 s: still applies (collector unchanged) — 3,000 legacy rows → 38.6 s, ~16.5k SQL/min',
    '!! grace shortened after evaluation keeps the old deadline: still applies (same scheduling code)',
    '!! C3 checker mutant: check-failsafe-reports.js and its test are byte-identical → still survives',
    '-- not recorded on #12380 (body and all 42 comments searched) — only in this PR\'s body',
    '',
    '## new this round',
    '!! runbook "Other blockers … retry after one minute, allowing healthy publications to advance" — F1 caveat only in the PR body',
    '!! K1: buildOss ignoring its credentials argument survives the default suite (527/527); only the two-identity OSS gate pins it',
    '',
    '## resolved since round 1',
    '++ landing path: base is main, no migration added, no Flyway clash; clean trial merge with main 2b15eac8',
    '++ runbook header (EN + zh-CN) was V30/V33 @ main 9478f2873 → fixed in 083a7efc (V30–V34)',
    '++ product CI runs (SDK Java matrix, MariaDB, Hosted + O4 lane, daemon E2E)',
  ],
  note: 'Nothing here blocks merging the gate slice; F1 is a precondition for enabling GC, and the remaining runbook sentence is a one-line fix.',
  noteColor: '#d29922',
},
];
fs.writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards, null, 1));
console.log('cards', cards.length);
