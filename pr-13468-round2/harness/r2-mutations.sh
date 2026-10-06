#!/usr/bin/env bash
# Round 2: targeted mutants against the test-only commit 1a02ab1a5d.
# Each mutant edits one production file (new inode via cp+sed), runs the
# relevant test, then restores the file and checks it byte-for-byte vs HEAD.
set -u
W=/root/verify/pr13468/head; OUT=/root/verify/pr13468/r2-mut; mkdir -p $OUT
cd $W
S=packages/cli/src/serve/routes/session.ts
G=packages/cli/src/acp-integration/ssh-workspace-guards.ts
restore() { git show HEAD:$1 > $1; cmp -s <(git show HEAD:$1) $1 && echo "  restored $1"; }
run_server() { (cd packages/cli && timeout 600 npx vitest run src/serve/server.test.ts -t 'adopts a UUID legacy Conversations restore through the standalone service' > $OUT/$1.log 2>&1; echo "  exit=$?"; grep -E "Tests |Expected|Received|^\s+[-+] +\"(route|sessionId)\"" $OUT/$1.log | head -12); }
run_ssh() { (cd packages/cli && timeout 600 npx vitest run src/acp-integration/acpAgent.test.ts -t 'rejects SSH workspace relocation and local runtime mutations before dispatch' > $OUT/$1-acp.log 2>&1; echo "  acpAgent exit=$?"; grep -E "Tests |AssertionError|resolved instead|rejects" $OUT/$1-acp.log | head -6; timeout 600 npx vitest run src/acp-integration/ssh-workspace-guards.test.ts > $OUT/$1-guards.log 2>&1; echo "  guards exit=$?"; grep -E "Tests " $OUT/$1-guards.log); }

echo "== M0 control (unmutated)"; run_server m0; run_ssh m0
echo "== M1 swap args at owner-wrapper call site (side-task)"
L=$(grep -n "sendStandaloneActionUnsupported(res, route, sessionId);" $S | head -1 | cut -d: -f1); echo "  line $L"
cp $S $S.tmp && sed "${L}s/sendStandaloneActionUnsupported(res, route, sessionId);/sendStandaloneActionUnsupported(res, sessionId, route);/" $S.tmp > $S && rm $S.tmp
run_server m1; restore $S
echo "== M2 swap args at restricted-wrapper call site (branch/cd)"
L=$(grep -n "sendStandaloneActionUnsupported(res, route, sessionId);" $S | tail -1 | cut -d: -f1); echo "  line $L"
cp $S $S.tmp && sed "${L}s/sendStandaloneActionUnsupported(res, route, sessionId);/sendStandaloneActionUnsupported(res, sessionId, route);/" $S.tmp > $S && rm $S.tmp
run_server m2; restore $S
echo "== M3 drop sessionSideTask from the SSH deny-list"
cp $G $G.tmp && grep -v "^  SERVE_CONTROL_EXT_METHODS.sessionSideTask,$" $G.tmp > $G && rm $G.tmp; git diff --stat -- $G | tail -1
run_ssh m3; restore $G
git status --porcelain
