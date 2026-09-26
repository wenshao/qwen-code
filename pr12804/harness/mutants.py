#!/usr/bin/env python3
"""Mutation matrix for PR #12804 (FG5 context-installation fault gates).

Each mutant is applied alone to a fresh copy of the runtime-broker module
(Java mutants) or of dist/ (bundled-worker mutants), then the named gates run
under -Pfault-gates. Every replacement asserts its exact match count first, so
a mutant that silently fails to apply cannot be read as "survived".
"""
import json
import os
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

SP = os.environ["SP"]
WT = f"{SP}/wt"
MOD = f"{WT}/packages/sdk-java/runtime-broker"
PKG = "src/main/java/com/alibaba/qwen/code/runtimebroker"
TPKG = "src/test/java/com/alibaba/qwen/code/runtimebroker"
CHUNK = "chunks/managed-runtime-attestation-worker-MVO2FRSY.js"
FG5 = "ContextInstallationFaultGateTest"
RESULTS = f"{SP}/harness/results.jsonl"
JDK = os.path.expanduser("~/Install/jdk21")

J = lambda f: ("java", f"{PKG}/{f}")
T = lambda f: ("java", f"{TPKG}/{f}")
W = ("dist", CHUNK)

MUTANTS = {
    # ---- the PR's own mutation table: Java (production) ----
    "J1-acquire-failure-marks-ready": [J("RuntimeBrokerService.java"), [(
        """                    .handle((ignored, error) -> {
                        if (error != null) {
                            throw new CompletionException(unwrap(error));
                        }
                        RuntimeSessionRecord ready =""",
        """                    .handle((ignored, error) -> {
                        if (false && error != null) {
                            throw new CompletionException(unwrap(error));
                        }
                        RuntimeSessionRecord ready =""")]],
    "J2-install-lost-answer-is-installed": [J("HttpRuntimeTransport.java"), [(
        """                    ManagedContextProtocol.verify(receipt, expected);
                    return receipt;
                });""",
        """                    ManagedContextProtocol.verify(receipt, expected);
                    return receipt;
                }).exceptionally(error -> expected);""")]],
    "J3-activation-ignores-failure": [J("HttpRuntimeTransport.java"), [(
        """                .thenAccept(bytes -> ManagedContextProtocol.verify(
                        ManagedContextProtocol.parse(bytes), expected));""",
        """                .thenAccept(bytes -> ManagedContextProtocol.verify(
                        ManagedContextProtocol.parse(bytes), expected))
                .exceptionally(error -> null);""")]],
    "J4-managed-startup-not-blocked-on-retryable": [J("RuntimeBrokerService.java"), [(
        "if (request.isManagedContext() || !retryable) {",
        "if (!retryable) {")]],
    "J5-resource-handle-no-longer-blocks-restart": [J("RuntimeBrokerService.java"), [(
        """        if (seed == null || (request.isManagedContext()
                && claimed.getResourceHandle() != null)) {""",
        """        if (seed == null) {""")]],
    # ---- the PR's own mutation table: bundled worker ----
    "W1-runs-without-context-in-mount-root": [W, [
        ('const isActive=__name(()=>!requiresActivation||activations.isActive(reference.sessionId),"isActive");if(!isActive()){return void 0}const binding=installations.installed(reference.sessionId);const directory=binding&&await mount.resolve(binding.cwdRelative);if(directory===void 0){return void 0}',
         'const isActive=__name(()=>true,"isActive");const binding=installations.installed(reference.sessionId);const directory=(binding&&await mount.resolve(binding.cwdRelative))??boot.mountRoot;')]],
    "W2-every-session-activated": [W, [
        ("isActive(sessionId){return this.sessions.get(sessionId)===true}",
         "isActive(sessionId){return true}")]],
    "W3-verifies-again-instead-of-replay": [W, [
        ("const earlier=this.#match(request);if(earlier){return earlier}const verified=await verify(request.binding);return this.#match(request)??(verified?this.#record(request):CONTEXT_UNAVAILABLE)",
         "const verified=await verify(request.binding);if(!verified){return CONTEXT_UNAVAILABLE}const earlier=this.#match(request);if(earlier){return earlier}return this.#match(request)??this.#record(request)")]],
    "W4-installs-without-verifying": [W, [
        ("const verified=await verify(request.binding);",
         "const verified=true;")]],
    "W5-refuses-with-another-409-code": [W, [
        ('code="managed_context_unavailable"};var ADMITTED_TOOL_NAMES',
         'code="managed_context_conflict"};var ADMITTED_TOOL_NAMES')]],
    # ---- extra probes (mine) ----
    # The shared-rig edits: are they load-bearing, and for which gates?
    "T1-awaitReply-reverted": [T("BrokerProcess.java"), [(
        "            String line = awaitReply(op);",
        """            String line = output.poll(CALL_TIMEOUT.toMillis(),
                    TimeUnit.MILLISECONDS);
            if (line == null) {
                throw new AssertionError("Broker " + name + " did not answer "
                        + op + ": " + logTail());
            }""")]],
    "T2-createRequest-not-forwarded": [T("RecoverableProcessProvisioner.java"), [(
        """    @Override
    public RuntimeProvisionRequest createRequest(RuntimeScope scope,
            String isolationKey) {
        return local.createRequest(scope, isolationKey);
    }
""", "")]],
    # Author's R3 note: the MANAGED release branch is never exercised.
    "T3-release-does-not-close-gate": [T("FaultGateTransport.java"), [(
        """        return runtime.activateWorkspace(bindings.findById(
                record.getBindingId()), record, context, false)
                .thenApply(ignored -> true);""",
        """        return CompletableFuture.completedFuture(true);""")]],
    # Pin flip control: emulate the fix the design names ("settles the
    # refusal as not_started", the W0c-3 local-refusal shape). The pin gate
    # must fail; every other FG5 gate must stay green.
    "P1-refusal-settles-not_started": [J("RuntimeBrokerService.java"), [(
        """                    invocations.remove(executing.getExecutionCallId());
                    if (error != null || result == null) {""",
        """                    invocations.remove(executing.getExecutionCallId());
                    if (error != null && unwrap(error) instanceof RuntimeBrokerException refusal
                            && "managed_context_unavailable".equals(refusal.getCode())) {
                        result = java.util.Map.of("executionStatus", "not_started",
                                "responseParts", java.util.List.of(), "error",
                                java.util.Map.of("type", refusal.getCode(),
                                        "message", "refused before start"));
                        error = null;
                    }
                    if (error != null || result == null) {""")]],
}


def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, check=True, **kw)


def apply(path, edits):
    text = open(path).read()
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            raise SystemExit(f"{path}: expected 1 match, found {n}: {old[:80]!r}")
        text = text.replace(old, new)
    open(path, "w").write(text)


def module_copy(name):
    dest = f"{WT}/packages/sdk-java/rb-{name}"
    if os.path.exists(dest):
        shutil.rmtree(dest)
    sh(f"cp -Rc '{MOD}' '{dest}'")
    shutil.rmtree(f"{dest}/target", ignore_errors=True)
    return dest


def run(name, module, tests, cli=None, extra_env=None, tag=None):
    tag = tag or name
    log = f"{SP}/harness/logs/{tag}.log"
    os.makedirs(os.path.dirname(log), exist_ok=True)
    args = ["mvn", "-B", "-o", "-s", f"{SP}/settings.xml",
            f"-Dmaven.repo.local={SP}/m2repo", "-Pfault-gates",
            "-Dsurefire.failIfNoSpecifiedTests=false"]
    if tests:
        args.append(f"-Dtest={tests}")
    if cli:
        args.append(f"-Dqwen.cli.entry={cli}")
    args.append("test")
    env = dict(os.environ, JAVA_HOME=JDK,
               PATH=f"{JDK}/bin:" + os.environ["PATH"])
    if extra_env:
        env.update(extra_env)
    start = time.time()
    with open(log, "w") as out:
        rc = subprocess.run(args, cwd=module, env=env, stdout=out,
                            stderr=subprocess.STDOUT).returncode
    elapsed = time.time() - start
    cases = []
    rep = f"{module}/target/surefire-reports"
    for f in sorted(os.listdir(rep)) if os.path.isdir(rep) else []:
        if not (f.startswith("TEST-") and f.endswith(".xml")):
            continue
        root = ET.parse(f"{rep}/{f}").getroot()
        cls = root.get("name").rsplit(".", 1)[-1]
        for tc in root.findall("testcase"):
            bad = tc.find("failure")
            if bad is None:
                bad = tc.find("error")
            msg = "" if bad is None else (bad.get("message") or bad.get("type") or "")
            cases.append({"cls": cls, "test": tc.get("name"),
                          "time": float(tc.get("time") or 0),
                          "ok": bad is None, "msg": msg.splitlines()[0][:220] if msg else ""})
    rec = {"mutant": tag, "rc": rc, "elapsed": round(elapsed, 1),
           "run": len(cases), "failed": [c for c in cases if not c["ok"]],
           "cases": cases}
    with open(RESULTS, "a") as fh:
        fh.write(json.dumps(rec) + "\n")
    failed = rec["failed"]
    print(f"{tag}: rc={rc} {elapsed:.0f}s run={len(cases)} failed={len(failed)}", flush=True)
    for c in failed:
        print(f"    FAIL {c['cls']}.{c['test']}: {c['msg'][:160]}", flush=True)
    return rec


def mutate_and_run(name, tests):
    (kind, rel), edits = MUTANTS[name]
    if kind == "java":
        module = module_copy(name)
        apply(f"{module}/{rel}", edits)
        return run(name, module, tests)
    dist = f"{WT}/dist-{name}"
    if os.path.exists(dist):
        shutil.rmtree(dist)
    sh(f"cp -Rc '{WT}/dist' '{dist}'")
    apply(f"{dist}/{rel}", edits)
    module = f"{WT}/packages/sdk-java/rb-worker"
    if not os.path.exists(module):
        module = module_copy("worker")
    return run(name, module, tests, cli=f"{dist}/cli.js")


if __name__ == "__main__":
    tests = os.environ.get("TESTS", FG5)
    for name in sys.argv[1:]:
        mutate_and_run(name, "" if tests == "ALL" else tests)
