#!/bin/bash
# M12b: interface-preserving variant of round 3's M12. The original mutation
# reassigned `bytes`, which does not compile at this head ("local variables
# referenced from a lambda expression must be final or effectively final"), so
# it never reached an assertion. This variant digests a re-serialised copy in a
# new local, leaving the submitted bytes untouched.
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
export JAVA_HOME=/root/Install/jdk21
export PATH=/root/Install/jdk21/bin:$PATH
MVN="/root/Install/maven/bin/mvn -B"
W=$A/head/packages/sdk-java/managed-agent-server
TPDS=$W/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationDataStore.java
cd "$W" || exit 9
TESTS='ToolPublicationStoreTest,ToolPublicationControllerTest,ToolPublicationContractTest,ApiExceptionHandlerTest,WorkspaceRuntimeTest'
ORIG=$(sha256sum "$TPDS" | cut -d' ' -f1)
cp "$TPDS" "$TPDS.r4bak"
python3 - "$TPDS" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
a = '"Only a started pending capture can finish");\n        String digest = ToolPublicationContract.sha256(bytes);'
assert a in s, 'M12b anchor not found'
b = ('"Only a started pending capture can finish");\n'
     '        byte[] reserialised = result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);\n'
     '        String digest = ToolPublicationContract.sha256(reserialised);')
open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY
MUT=$(sha256sum "$TPDS" | cut -d' ' -f1)
echo "M12b ORIG=${ORIG:0:12} MUTATED=${MUT:0:12}"
if [ "$MUT" = "$ORIG" ]; then echo "M12b PATCH_NOT_APPLIED"; cp "$TPDS.r4bak" "$TPDS"; exit 9; fi
echo "--- MUTANT M12b finish digests the re-serialised JSON"
$MVN test -Dtest="$TESTS" -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip 2>&1 | grep -E "Tests run:.*(Failures|Errors)|BUILD (SUCCESS|FAILURE)|<<< (FAILURE|ERROR)|error:" | tail -8
cp "$TPDS.r4bak" "$TPDS"; rm -f "$TPDS.r4bak"
BACK=$(sha256sum "$TPDS" | cut -d' ' -f1)
[ "$BACK" = "$ORIG" ] && echo "M12b RESTORED_OK" || echo "M12b RESTORE_FAILED $BACK"
git -C "$A/head" status --porcelain | head -3
echo M12B_DONE
