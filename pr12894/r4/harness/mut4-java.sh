#!/bin/bash
# Round 4 Java mutants: re-measure r3's M11/M12/M13 kills and open finding #4
# (reverting the round-1 B2 LocalDateTime / B4 FOR UPDATE fixes still passes the
# H2 suites, so nothing automated pins them).
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
export JAVA_HOME=/root/Install/jdk21
export PATH=/root/Install/jdk21/bin:$PATH
MVN="/root/Install/maven/bin/mvn -B"
W=$A/head/packages/sdk-java/managed-agent-server
TPS=$W/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java
TPDS=$W/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationDataStore.java
CTL=$W/src/main/java/com/alibaba/qwen/code/managedagent/api/ToolPublicationController.java
cd "$W" || exit 9
TESTS='ToolPublicationStoreTest,ToolPublicationControllerTest,ToolPublicationContractTest,ApiExceptionHandlerTest,WorkspaceRuntimeTest'
run() { $MVN test -Dtest="$TESTS" -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip 2>&1 | grep -E "Tests run:.*(Failures|Errors)|BUILD (SUCCESS|FAILURE)|ERROR.*\.java" | tail -6; }

sha() { sha256sum "$TPS" "$TPDS" "$CTL" | cut -c1-16 | tr '\n' ' '; }
echo "=== ORIG sha: $(sha)"
for f in "$TPS" "$TPDS" "$CTL"; do cp "$f" "$f.orig"; done
echo "=== BASELINE (unmutated)"; run

# M11 (r3: KILLED) - never fence expired OPEN grants
python3 - <<'PY'
p='/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java'
s=open(p,encoding='utf-8').read()
a='" WHERE tenant_key = ? AND state = \'OPEN\' AND expires_at <= ?", tenantKey, writer.now());'
assert a in s, 'M11 anchor not found'
open(p,'w',encoding='utf-8').write(s.replace(a,'" WHERE 1 = 0 AND tenant_key = ? AND state = \'OPEN\' AND expires_at <= ?", tenantKey, writer.now());',1))
PY
echo "--- MUTANT M11 no fence of expired OPEN grants"; run; cp "$TPS.orig" "$TPS"

# M12 (r3: KILLED) - finish digests the re-serialised JSON instead of the submitted bytes
python3 - <<'PY'
p='/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationDataStore.java'
s=open(p,encoding='utf-8').read()
a='"Only a started pending capture can finish");\n        String digest = ToolPublicationContract.sha256(bytes);'
assert a in s, 'M12 anchor not found'
b='"Only a started pending capture can finish");\n        bytes = result.toString().getBytes(StandardCharsets.UTF_8);\n        String digest = ToolPublicationContract.sha256(bytes);'
open(p,'w',encoding='utf-8').write(s.replace(a,b,1))
PY
echo "--- MUTANT M12 finish digests re-serialised JSON"; run; cp "$TPDS.orig" "$TPDS"

# M13 (r3: KILLED) - range bounds not validated as integers
python3 - <<'PY'
p='/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/api/ToolPublicationController.java'
s=open(p,encoding='utf-8').read()
a='if (!offset.isIntegralNumber() || !offset.canConvertToLong()\n                    || !length.isIntegralNumber() || !length.canConvertToInt()) {'
assert a in s, 'M13 anchor not found'
open(p,'w',encoding='utf-8').write(s.replace(a,'if (false) {',1))
PY
echo "--- MUTANT M13 range bounds not checked as integers"; run; cp "$CTL.orig" "$CTL"

# B2R - revert the round-1 B2 fix (LocalDateTime lease value from MySQL)
python3 - <<'PY'
p='/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java'
s=open(p,encoding='utf-8').read()
a='Object leaseValue = head.get("writer_lease_until");\n        Timestamp lease = leaseValue instanceof java.time.LocalDateTime local\n                ? Timestamp.valueOf(local) : (Timestamp) leaseValue;'
assert a in s, 'B2R anchor not found'
open(p,'w',encoding='utf-8').write(s.replace(a,'Timestamp lease = (Timestamp) head.get("writer_lease_until");',1))
PY
echo "--- MUTANT B2R revert LocalDateTime lease conversion"; run; cp "$TPS.orig" "$TPS"

# B4R - revert the round-1 B4 fix (FOR UPDATE on the journal_tx read)
python3 - <<'PY'
p='/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039/head/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java'
s=open(p,encoding='utf-8').read()
a='+ " WHERE tenant_id = ? AND session_id = ? AND journal_revision = ? FOR UPDATE",'
assert a in s, 'B4R anchor not found'
open(p,'w',encoding='utf-8').write(s.replace(a,'+ " WHERE tenant_id = ? AND session_id = ? AND journal_revision = ?",',1))
PY
echo "--- MUTANT B4R revert FOR UPDATE on journal read"; run; cp "$TPS.orig" "$TPS"

for f in "$TPS" "$TPDS" "$CTL"; do rm -f "$f.orig"; done
echo "=== FINAL sha: $(sha)"
cd "$A/head" && git status --porcelain | head
echo JAVA_MUT_DONE
