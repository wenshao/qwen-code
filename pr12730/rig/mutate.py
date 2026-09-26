#!/usr/bin/env python3
"""Mutation matrix for PR 12730's new guards. One mutant at a time, full suite
with the real Worker bundle; the source is restored from a pristine copy."""
import glob, json, os, re, shutil, subprocess, sys, time

S = os.path.dirname(os.path.abspath(__file__))
MOD = f"{S}/mut/packages/sdk-java/runtime-broker"
PKG = f"{MOD}/src/main/java/com/alibaba/qwen/code/runtimebroker"
BUNDLE = os.path.expanduser("~/git/qwen-code-pr12730/dist/cli.js")

T = "HttpRuntimeTransport.java"
SVC = "RuntimeBrokerService.java"
LP = "LocalProcessRuntimeProvisioner.java"
MCP = "ManagedContextProtocol.java"

MUTANTS = [
    ("M01", T, "installContext: drop READY state check",
     "if (runtime.getState() != RuntimeBindingRecord.State.READY\n                || lease == null",
     "if (lease == null"),
    ("M02", T, "installContext: drop scope == Session scope",
     "\n                || !request.getScope().equals(session.getScope())", ""),
    ("M03", T, "installContext: drop isolation key == Harness Session",
     "\n                || !java.util.Objects.equals(request.getIsolationKey(),\n                        isolationKey)", ""),
    ("M04", "RuntimeSession.java", "RuntimeSession: accept unpaired surrogates",
     "BrokerValues.requireWellFormed(\n                BrokerValues.requireId(runtimeSessionId, \"runtimeSessionId\"),\n                \"runtimeSessionId\")",
     "BrokerValues.requireId(runtimeSessionId, \"runtimeSessionId\")"),
    ("M05", T, "transport reference identity: accept unpaired surrogates",
     "identity.put(field, BrokerValues.requireWellFormed(\n                    referenceString(reference, field), \"reference \" + field));",
     "identity.put(field, referenceString(reference, field));"),
    ("M06", SVC, "service referenceString: accept unpaired surrogates",
     "return BrokerValues.requireWellFormed(BrokerValues.requireId(\n                    (String) value, \"reference.\" + field),\n                    \"reference.\" + field);",
     "return BrokerValues.requireId((String) value, \"reference.\" + field);"),
    ("M07", MCP, "installation(): drop its own well-formed check",
     "        wellFormed(sessionId);\n", ""),
    ("M08", SVC, "entry: persisted handle no longer blocks relaunch",
     "if (seed == null || (request.isManagedContext()\n                && claimed.getResourceHandle() != null)) {",
     "if (seed == null) {"),
    ("M09", SVC, "deadline: do not block the binding",
     "blocked = request.isManagedContext() && timedOut != null\n                            && blockRecoveryQuietly(timedOut, null);",
     "blocked = false;"),
    ("M10", SVC, "deadline: block but answer retryable timeout",
     "operation.completeExceptionally(blocked\n", "operation.completeExceptionally(false\n"),
    ("M11", SVC, "failure: managed retryable failure not blocked",
     "if (request.isManagedContext() || !retryable) {", "if (!retryable) {"),
    ("M12", SVC, "failure: blocked but answer original retryable error",
     "if (blockRecoveryQuietly(currentClaim, cause)\n                                            && retryable) {",
     "if (blockRecoveryQuietly(currentClaim, cause)\n                                            && false) {"),
    ("M13", "JdbcRuntimeBrokerSchema.java", "schema: rethrow ALTER failure without re-check",
     "if (!hasStorageColumn(statement, table)) {\n                throw failure;",
     "if (true) {\n                throw failure;"),
    ("M14", "JdbcRepositorySupport.java", "request hash: managed rows use legacy hash",
     "if (request.isManagedContext()) {\n            return digest(\"managed-context/1\"",
     "if (false) {\n            return digest(\"managed-context/1\""),
    ("M15", "JdbcRuntimeBindingRepository.java", "binding row: storage_id not written",
     "statement.setString(34, request.getStorageId());", "statement.setString(34, null);"),
    ("M16", "JdbcRuntimeBindingRepository.java", "slot row: storage_id not written",
     "statement.setString(10, request.getStorageId());", "statement.setString(10, null);"),
    ("M17", SVC, "admission: attested storage identity not compared",
     "\n                && java.util.Objects.equals(request.getStorageId(),\n                        attestation.getStorageId())", ""),
    ("M18", T, "context 409 refusals classified as generic failure",
     "if (response.statusCode() == 409 && !body.overflow()",
     "if (false && response.statusCode() == 409 && !body.overflow()"),
    ("M19", T, "accept Content-Encoding on Runtime responses",
     "\n                    || response.headers().firstValue(\"Content-Encoding\").isPresent()", ""),
    ("M20", LP, "managed startup failure reported retryable",
     "\"Managed context startup failed; recovery is blocked.\",\n                        false, exception);",
     "\"Managed context startup failed; recovery is blocked.\",\n                        true, exception);"),
    ("M21", MCP, "ready v2: accept any origin",
     "require(origin.matches() && Integer.parseInt(origin.group(1)) <= 65535);",
     "require(url.startsWith(\"http\"));"),
    ("M22", LP, "ready line: skip CR again (pre-PR behavior)",
     "            if (value == '\\n') {\n                return builder.toString();\n            }\n",
     "            if (value == '\\n') {\n                return builder.toString();\n            }\n            if (value == '\\r') {\n                continue;\n            }\n"),
    ("M23", T, "installContext: receipt not verified",
     "                    ManagedContextProtocol.verify(receipt, expected);\n", ""),
    ("M24", T, "attest v3: response not verified",
     "ManagedContextProtocol.verify(ManagedContextProtocol.parse(bytes),\n                                ManagedContextProtocol.attestationResponse(boot));",
     "ManagedContextProtocol.parse(bytes);"),
    ("M25", SVC, "unplaceable scope: raw IllegalArgumentException",
     "throw new RuntimeBrokerException(400, \"runtime_placement_invalid\",\n                    \"Runtime placement is invalid\", false, exception);",
     "throw exception;"),
    ("M26", "RuntimeProvisionRequest.java", "managed request: scope not validated",
     "            ManagedContextProtocol.validateScope(this);\n", ""),
    ("M27", MCP, "ready v2: managedContext not checked",
     "&& exactNumber(ready.get(\"version\"), 2)\n                && PROTOCOL.equals(ready.get(\"managedContext\")));",
     "&& exactNumber(ready.get(\"version\"), 2));"),
    ("M28", LP, "provisioner ignores the storage resolver",
     "return storageResolver == null\n", "return true\n"),
    ("M29", T, "installContext: drop Session record binding id check",
     "\n                || !runtime.getBindingId().equals(sessionRecord.getBindingId())", ""),
    ("M30", T, "installContext: drop Session record generation check",
     "\n                || runtime.getGeneration() != sessionRecord.getRuntimeGeneration()", ""),
    ("M31", SVC, "block race: loser does not re-read the block",
     "            RuntimeBindingRecord latest = bindingRepository.findById(\n                    claimed.getBindingId());\n            return latest != null && latest.getState()\n                    == RuntimeBindingRecord.State.RECOVERY_BLOCKED;",
     "            return false;"),
    ("M32", SVC, "block write failure escapes instead of keeping the answer",
     "            if (cause != null) {\n                cause.addSuppressed(failure);\n            }\n            return false;",
     "            throw failure;"),
    ("M33", SVC, "acquire: accept unpaired surrogates in Runtime Session ID",
     "String runtimeId = BrokerValues.requireWellFormed(\n                BrokerValues.requireId(runtimeSessionId, \"runtimeSessionId\"),\n                \"runtimeSessionId\");",
     "String runtimeId = BrokerValues.requireId(runtimeSessionId,\n                \"runtimeSessionId\");"),
]


def run_suite():
    started = time.time()
    proc = subprocess.run(
        ["mvn", "-q", "-o", f"-Dqwen.runtime.worker.bundle={BUNDLE}", "clean", "test"],
        cwd=MOD, capture_output=True, text=True)
    failed = []
    total = 0
    for path in glob.glob(f"{MOD}/target/surefire-reports/TEST-*.xml"):
        text = open(path, encoding="utf-8").read()
        total += int(re.search(r'<testsuite[^>]*tests="(\d+)"', text).group(1))
        for match in re.finditer(r'<testcase name="([^"]+)" classname="[^"]*\.([^".]+)"[^>]*?(/>|>(.*?)</testcase>)', text, re.S):
            body = match.group(4) or ""
            if "<failure" in body or "<error" in body:
                failed.append(f"{match.group(2)}.{match.group(1)}")
    compile_error = "COMPILATION ERROR" in proc.stdout + proc.stderr
    return proc.returncode, total, failed, compile_error, time.time() - started


def main():
    only = set(sys.argv[1:])
    results = []
    for mid, name, desc, old, new in MUTANTS:
        if only and mid not in only:
            continue
        path = f"{PKG}/{name}"
        source = open(path, encoding="utf-8").read()
        count = source.count(old)
        if count != 1:
            results.append({"id": mid, "desc": desc, "verdict": f"NOT APPLIED (matches={count})"})
            print(mid, "NOT APPLIED", count, flush=True)
            continue
        backup = path + ".orig"
        shutil.copy(path, backup)
        try:
            open(path, "w", encoding="utf-8").write(source.replace(old, new))
            code, total, failed, compile_error, secs = run_suite()
        finally:
            shutil.move(backup, path)
        if compile_error:
            verdict = "COMPILE ERROR"
        elif code != 0 and failed:
            verdict = "KILLED"
        elif code != 0:
            verdict = "FAILED (no test failure parsed)"
        else:
            verdict = "SURVIVED"
        row = {"id": mid, "file": name, "desc": desc, "verdict": verdict,
               "tests": total, "killedBy": failed[:4], "killers": len(failed), "secs": round(secs)}
        results.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    json.dump(results, open(f"{S}/mutation-results.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
