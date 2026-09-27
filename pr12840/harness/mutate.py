# Mutants the PR's author did not list, run against the PR's own Java unit
# suite (mvn test, H2). Each mutant must match exactly once; the source is
# restored with git checkout and recompiled before the next one.
import subprocess, sys, json, os, time

SP = "/path/to/scratchpad"
WT = f"{SP}/wt-mut"
MOD = f"{WT}/packages/sdk-java/managed-agent-server"
J = "src/main/java/com/alibaba/qwen/code/managedagent/"
MUTANTS = [
    ("M1", J + "service/ManagedAgentService.java", "if (afterSequence < window.floorSequence()) {", "if (afterSequence <= window.floorSequence()) {", "a cursor equal to the floor counts as expired"),
    ("M2", J + "service/ManagedAgentService.java", "boolean hasMore = rows.size() > limit;", "boolean hasMore = rows.size() >= limit;", "has_more off by one (true on an exactly full last page)"),
    ("M3", J + "service/ManagedAgentService.java", "if (requested <= 0 || requested > 1000) {", "if (requested <= 0 || requested > 100) {", "event/transcript limit stays at 100"),
    ("M4", J + "service/ManagedAgentService.java", "new SessionCapabilities(true, true, false, true);", "new SessionCapabilities(true, false, false, false);", "Sessions stop advertising snapshots and resync"),
    ("M5", J + "service/ManagedAgentService.java", "session.lastSequence(), session.replayFloorSequence(),", "session.lastSequence(), 0,", "Session reports replay_floor_sequence 0 again"),
    ("M6", J + "service/ReplayCursorExpired.java", "                        window.snapshotThroughSequence()));", "                        0L));", "409 envelope reports snapshot_through_sequence 0"),
    ("M7", J + "service/ManagedEventStreamService.java", "emitter.send(SseEmitter.event().name(RESYNC).data(frame));", "emitter.send(SseEmitter.event().id(\"0\").name(RESYNC).data(frame));", "resync frame carries an id"),
    ("M8", J + "store/ManagedAgentStore.java", "        long floor = Math.min(floorSequence,\n                window.snapshotThroughSequence());", "        long floor = floorSequence;", "floor may rise above the Snapshot"),
    ("M9", J + "store/ManagedAgentStore.java", "        if (floor <= window.floorSequence()) {", "        if (floor == window.floorSequence()) {", "floor may move down"),
    ("M10", J + "store/EventIdentity.java", "                && itemId.equals(previous.itemId())\n", "", "a delta continues a Part of another Item"),
    ("M11", J + "store/EventIdentity.java", "                && type.equals(previous.type())\n", "", "a reasoning delta continues an output_text Part"),
    ("M12", J + "store/ManagedAgentStore.java", "findIdentity(tenantId, sessionId, sequence, type));", "findIdentity(tenantId, sessionId, sequence - 1, type));", "single append reads the wrong previous event"),
    ("M13", J + "store/ManagedAgentStore.java", "                : findIdentity(tenantId, sessionId, next,", "                : findIdentity(tenantId, sessionId, next - 1,", "batch append reads the wrong previous event"),
    ("M14", "src/main/java/db/migration/V15__managed_event_identity.java", "previousSequence == sequence - 1 ? previous : null);", "previous);", "backfill ignores holes in the sequence"),
    ("M15", J + "service/ManagedEventStreamService.java", "    static final String RESYNC_ACTION = \"reload_snapshot\";", "    static final String RESYNC_ACTION = \"reload\";", "resync action is not reload_snapshot"),
    ("M16", J + "service/ManagedAgentService.java", "        return replayableEvents(session, afterSequence, STREAM_PAGE);", "        return store.findEvents(session.tenantId(), session.sessionId(),\n                afterSequence, STREAM_PAGE);", "stream catch-up skips the floor check (JSON still checks)"),
    ("M17", "src/main/java/db/migration/V15__managed_event_identity.java", "            read = 0;\n", "            read = 0;\n            previous = null;\n", "V15 forgets the previous event at a page boundary"),
    ("M18", "src/main/java/db/migration/V15__managed_event_identity.java", "        } while (read == PAGE_SIZE);", "        } while (false);", "V15 reads only the first page of a Session"),
]
only = sys.argv[1:]
env = dict(os.environ, JAVA_HOME="$HOME/Install/jdk21", PATH="$HOME/Install/jdk21/bin:$HOME/Install/maven/bin:" + os.environ["PATH"])
MVN = ["mvn", "--batch-mode", "--no-transfer-progress", "-s", f"{SP}/settings.xml", f"-Dmaven.repo.local={SP}/m2", "-o"]
results = []
for mid, rel, old, new, what in MUTANTS:
    if only and mid not in only:
        continue
    path = f"{MOD}/{rel}"
    src = open(path).read()
    n = src.count(old)
    if n != 1:
        results.append({"id": mid, "what": what, "error": f"anchor matched {n} times"})
        print(mid, "ANCHOR", n, flush=True)
        continue
    open(path, "w").write(src.replace(old, new))
    t0 = time.time()
    log = f"{SP}/logs/mut-{mid}.log"
    rc = subprocess.run(MVN + ["test"], cwd=MOD, env=env, stdout=open(log, "w"), stderr=subprocess.STDOUT).returncode
    text = open(log).read()
    failing = sorted({l.split("<<<")[0].split("--")[-1].strip() for l in text.splitlines() if "<<< FAIL" in l or "<<< ERROR" in l})
    compile_error = "COMPILATION ERROR" in text
    subprocess.run(["git", "checkout", "--", rel], cwd=MOD, check=True)
    verdict = "compile-error" if compile_error else ("killed" if rc != 0 else "SURVIVED")
    results.append({"id": mid, "what": what, "verdict": verdict, "failing": failing[:6], "secs": round(time.time() - t0)})
    print(mid, verdict, what, failing[:4], flush=True)
subprocess.run(MVN + ["-q", "test-compile"], cwd=MOD, env=env, check=True)
json.dump(results, open(f"{SP}/out/mutants.json", "w"), indent=2)
print(json.dumps({r["id"]: r.get("verdict", r.get("error")) for r in results}))
