## Maintainer verification: PR #13296 @ `2b4deacb7f` (round 1)

**Verdict: ready to merge.** I ran the real collector at its production cadence against real MySQL 8.4, and the PR does what it says. After the first traversal, rows behind the four stable protections are not evaluated again until the next day, and their bytes, quota, catalog rows and objects all stay in place. Every other blocker keeps its one-minute retry. I also reproduced the #13285 starvation on `main`: publications that had just become due waited **58.2 s** behind the protected backlog. On the PR they waited **4.0 s**, which is the floor for five publications at one per tick. The full module suite, the O4 MySQL gate and the report checker all pass, both at the head and merged onto current `main`. I found nothing blocking. Two optional test additions and one optional runbook sentence are listed at the end.

### How I tested

- **Trees.** Detached worktrees at head `2b4deac` and merge base `576689d`, plus `origin/main 2007925` with the head merged in. The merge is clean. Since the merge base, `main` changed `ToolPublicationStore` (#13217), so §5 tests the merged tree as well.
- **Environment.** JDK 21 (`eclipse-temurin:21-jdk`, CI parity), Maven 3.9.9 with a private local repository, MySQL 8.4.11 (REPEATABLE-READ, binlog off, tmpfs), Linux x86-64.
- **Independent harness.** `harness/BackoffHarness.java` sits in the module's package and is compiled against the built classes; no PR file is modified. It drives the real `ToolPublicationCollector` against a fresh Flyway V34 schema, and every publication has a real file in a filesystem object store.
- **Fixtures use production code paths wherever one exists:**
  - legacy rows take the V30 `write_evidence` default;
  - quarantine goes through `quarantineResource()`;
  - recovery protection comes from `retire()` over a `BLOCKED_RESOURCE` journal head;
  - readers hold real `read()` leases;
  - unresolved PUTs come from `put()` with a lost response.
- **SQL is counted twice:** client side through a JDBC proxy, and server side through `performance_schema` digests.
- **Two arms, one build.** The base arm is the head build with only `ToolPublicationCollector.class` recompiled from the merge base. A `diff` of the two sources shows exactly the 6-line switch, so everything else under test is byte-identical.
- **Time travel.** I did not wait 24 hours of wall clock; like the PR's own tests, I move stored deadlines. The 61 s wait is real wall clock.

### 1. The fix works, and the starvation it targets is real on `main`

![A/B on real MySQL 8.4](./fig1-ab.png)

- **Second sweep.** After a real 61 s wait I made 100 back-to-back `runOnce()` calls:
  - protected re-evaluations went from **2,795 → 0**;
  - client SQL went from **22,251 → 782** (server side 30,720 → 908);
  - tenant-row locks went from 2,823 → 42.
- **Steady state** (100 s at the production cadence): **7,242 → 133** client statements per minute (server side 9,993 → 137).
- **A healthy publication whose grace deadline is now** (5 of them) was collected after **58.2 s / 57 ticks → 4.0 s / 5 ticks**.
- **Minute-retry blockers are delayed on `main` too.** I closed the reader leases before the wait. Within the next 100 calls, `main` collected only 13 of those 20 publications; the PR collected 20/20.
- **First traversal.** It takes 114 ticks in both arms: 3,000 protected evaluations on the PR, and 3,030 on `main`, where rows evaluated early came due again before the sweep ended. So the PR does not change first-sweep cost, as its body says.
- **Integrity, both arms.** All 3,000 protected rows stay `RETIRING` with 9,000,000 held / 369,000 used bytes, live catalog rows and files on disk; 0 protected keys were deleted. The unresolved PUT keeps its 60 s retry.

![raw harness output](./fig2-harness.png)

### 2. The shipped 24 h grace combined with the 24 h recheck (round-3 deferred item 1)

![grace combination](./fig3-grace.png)

- **While grace runs**, three of the protections are stored as `grace_period` with a deadline of `retired_at + 24 h` in both arms. The grace override still takes precedence.
- **`recovery_protected` is checked before grace** in `candidate()`. On `main` such a session was therefore rechecked every 60 s for the whole grace day (about 1,440 times per row). On the PR it is rechecked once a day.
- **After grace has elapsed**, the four protections go to +24 h on the PR and +60 s on `main`, and healthy rows are collected in both arms. On the PR, no stored deadline was earlier than `retired_at + grace`.

### 3. One day later

![day boundary](./fig5-day.png)

- **With the first sweep's spacing kept**, the re-sweep keeps pace with the due times. At most 96 rows were waiting at any tick, and a healthy publication that became due mid-re-sweep was collected in 4.0 s.
- **If every row is overdue at once**, the re-sweep arrives as a single burst. This happens after GC was disabled, or every instance was down, for longer than the original sweep took. A healthy publication then waited 80.2 s, roughly the remaining backlog divided by 32 per tick.
  - This is the same first-traversal cost the PR already documents.
  - Afterwards the deadlines are spread again (+23.97 h … +24.00 h), so the burst does not recur the next day.
  - On `main` the equivalent cost applies all the time (§1).

### 4. Two collector instances

Two collectors with distinct owners ran for 150 s at the production cadence over 600 protected and 10 healthy publications.

- On the PR, each protected row was evaluated **exactly once** across both instances (600 evaluations); `main` evaluated 1,800.
- `ER_LOCK_DEADLOCK` delta was 0 in both arms, and 10/10 healthy publications were collected.
- Every deferred deadline on the PR landed at +23.96 h.

### 5. Gates and mutants

![gates and mutation matrix](./fig4-gates.png)

- **PR head.** `clean verify checkstyle:check` passed **559/559** with 0 skipped, 0 Checkstyle violations and 0 SpotBugs bugs. The Linux-only `RuntimeBrokerDefaultOnTest`, which the author's macOS run skipped, ran and passed here.
  - That test needs `/etc/machine-id`, which the bare temurin container lacks, so I mounted it. This was a problem with my rig, not with the PR.
- **PR head, O4 profile.** `-Po4-mysql-gates` on MySQL 8.4 passed **48/48**, and `check-failsafe-reports.js o4-mysql` exited 0. `O4MySqlGate` extends `ToolPublicationCollectorTest`, so every new collector case also ran on real MySQL.
- **Merged onto `main`.** The module suite passed **647/647** and the O4 gate **48/48**, with the checker at exit 0 and Checkstyle and SpotBugs both at 0.
- **Report checker.** `check-failsafe-reports.test.js` passed 14/14. Three checker mutants were all killed:
  - counting only `<skipped>` → 4 tests failed;
  - ignoring `<error>` → 2 failed;
  - no longer stripping CDATA → 4 failed.
- **Collector mutants: 12 of 14 killed.** The two that survive are exactly the deferred round-3 items 2 and 3; see the optional follow-ups below.
- **Runbook query.** The new read-only query runs on MySQL 8.4 and shows the next-day deadline per protection:

```text
| retention_state | gc_blocker                    | publications | no_delay_publications | earliest_retry_epoch_ms | earliest_retry_db_time   |
| RETIRING        | recovery_protected            |            5 |                     0 |           1791259953724 | 2026-10-06 04:12:33.7240 |
| RETIRING        | quarantined                   |            5 |                     0 |           1791259953655 | 2026-10-06 04:12:33.6550 |
| RETIRING        | legacy_write_evidence_missing |            5 |                     0 |           1791259953642 | 2026-10-06 04:12:33.6420 |
| RETIRING        | not_accepted_complete         |            5 |                     0 |           1791259953668 | 2026-10-06 04:12:33.6680 |
```

(DB time 2026-10-05 04:12:33.97; `@@time_zone = SYSTEM`.)

### 6. The premise that these four protections cannot clear after retirement

I read the code at the head and re-checked it on the merged tree.

- `write_evidence` is written only by the `INSERT` in `ToolPublicationStore`.
- `quarantined` is only ever set to `TRUE`.
- `recovery_protected` is written once, by the retirement-root `INSERT` in `retire()`.
- The only writer of `accepted_complete` / `REFERENCED` is `ToolPublicationAdmissionStore`, and it runs under `lockPublicationWriter` → `requireWriter`. `requireWriter` needs an `ACTIVE` head, and `retire()` sets the head to `DELETED` and clears the writer. `acquireWriter` also calls `requireLive`.

So no production path clears these protections after retirement. If a future repair path does, the cost is up to 24 h of detection latency, never an early delete: every due attempt re-runs `candidate()` under the locks, and a mutant that trusts the stored blocker instead is killed.

### Optional follow-ups (non-blocking)

1. **Pin the two bookkeeping writes the review deferred.** These mutants survive the 58 collector and retention-store cases:
   - removing `gc_blocker = NULL` from the DELETING transition;
   - not persisting `reader_active` as the blocker.

   Both only change what the runbook's blocker query shows, not deletion safety. The harness observed the correct behaviour today: collected rows carry `NULL`, and reader-held rows carry `reader_active`. Two one-line DB assertions in the existing fixtures would pin them.
2. **Runbook sentence (optional).** Something like: "after GC has been disabled, or all instances were down, for longer than the original traversal, the daily recheck of a protected backlog arrives as one burst (about N/32 ticks) once, then spreads out again." §3 measures exactly this case.

### Not verified

- Real OSS, and the full Hosted foreground Shell / L4 lifecycle. These are the same limits the PR states.
- Windows and macOS locally. CI ran the Java jobs on both, and they are green at this head.
- An actual 24-hour wall-clock wait. Deadlines were moved instead, as described above.

Evidence: this directory (`harness/`, `data/`, `render/`).
