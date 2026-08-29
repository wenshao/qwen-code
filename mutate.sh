#!/usr/bin/env bash
# Mutation check: does the PR's own test suite catch a break in the new fence?
set -uo pipefail
T=/Users/wenshao/git/qwen-10300
CORE=$T/packages/core/src/services
CLI=$T/packages/cli/src/serve/server
BK=$(mktemp -d)
cp "$CORE/session-writer-lease.ts" "$BK/lease.ts"
cp "$CORE/sessionService.ts" "$BK/svc.ts"
cp "$CLI/session-archive.ts" "$BK/arch.ts"
restore() {
  cp "$BK/lease.ts" "$CORE/session-writer-lease.ts"
  cp "$BK/svc.ts" "$CORE/sessionService.ts"
  cp "$BK/arch.ts" "$CLI/session-archive.ts"
}
trap restore EXIT

run_pr_tests() {
  local ok=0
  (cd "$T/packages/core" && npx vitest run --coverage.enabled=false \
     src/services/session-writer-lease.test.ts src/services/sessionService.test.ts \
     src/services/sessionService.corruption.test.ts >/dev/null 2>&1) || ok=1
  (cd "$T/packages/cli" && npx vitest run --coverage.enabled=false \
     src/serve/server/session-archive.test.ts \
     src/serve/conversations/standalone-session-service.test.ts >/dev/null 2>&1) || ok=1
  echo $ok
}

report() { # name applied killed
  if [ "$2" != "1" ]; then echo "  $1 :: MUTATION NOT APPLIED (pattern miss)";
  elif [ "$3" = "1" ]; then echo "  $1 :: KILLED";
  else echo "  $1 :: SURVIVED"; fi
}

echo "PR #10300 mutation checks (PR's own tests only)"

# M1 - assertCleanupOwned no longer compares the lock inode identity
restore
python3 - "$CORE/session-writer-lease.ts" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="""    const current = this.readVerifiedLockIdentity();
    if (current.dev !== expected.dev || current.ino !== expected.ino) {
      throw new SessionWriterLostError();
    }"""
new="""    this.readVerifiedLockIdentity();"""
assert old in s, "M1 pattern miss"
open(p,"w").write(s.replace(old,new))
PY
A1=$?; K=$(run_pr_tests); report "M1 assertCleanupOwned skips the dev/ino comparison" $([ $A1 = 0 ] && echo 1 || echo 0) "$K"

# M2 - lock identity check no longer compares the raw record bytes
restore
python3 - "$CORE/session-writer-lease.ts" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="""        record.owner_id !== this.ownerId ||
        raw !== this.lockRecordRaw
      ) {
        throw new SessionWriterLostError();
      }
      assertPathMatchesDescriptor();
      return { dev: stat.dev, ino: stat.ino };"""
new="""        record.owner_id !== this.ownerId
      ) {
        throw new SessionWriterLostError();
      }
      assertPathMatchesDescriptor();
      return { dev: stat.dev, ino: stat.ino };"""
assert old in s, "M2 pattern miss"
open(p,"w").write(s.replace(old,new))
PY
A2=$?; K=$(run_pr_tests); report "M2 lock identity ignores the raw record bytes" $([ $A2 = 0 ] && echo 1 || echo 0) "$K"

# M3 - sidecar move no longer checks ownership before the worktree sidecar
restore
python3 - "$CORE/sessionService.ts" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="""    assertCleanupOwned?.();
    try {
      this.moveOptionalFile(sourceWorktree, destinationWorktree);"""
new="""    try {
      this.moveOptionalFile(sourceWorktree, destinationWorktree);"""
assert old in s, "M3 pattern miss"
open(p,"w").write(s.replace(old,new))
PY
A3=$?; K=$(run_pr_tests); report "M3 worktree sidecar move drops its ownership fence" $([ $A3 = 0 ] && echo 1 || echo 0) "$K"

# M4 - post-commit delete cleanup falls back to the generation fence
restore
python3 - "$CORE/sessionService.ts" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="""    const assertCleanupOwned =
      options.assertCleanupOwned ?? options.assertCanMutate;
    assertCleanupOwned?.();
    this.removeWorktreeSidecars(sessionId);"""
new="""    const assertCleanupOwned = options.assertCanMutate;
    assertCleanupOwned?.();
    this.removeWorktreeSidecars(sessionId);"""
assert old in s, "M4 pattern miss"
open(p,"w").write(s.replace(old,new))
PY
A4=$?; K=$(run_pr_tests); report "M4 delete cleanup reverts to the generation fence" $([ $A4 = 0 ] && echo 1 || echo 0) "$K"

# M5 - restore the early alreadyArchived return that skipped the lease
restore
python3 - "$CLI/session-archive.ts" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="""              if (lockedLocation === 'conflict' && !resolveConflicts) {
                throw sessionLocationError(sessionId);
              }
              const result = await service.archiveSessions([sessionId], {"""
new="""              if (lockedLocation === 'archived') {
                return {
                  value: 'alreadyArchived' as const,
                  mutationApplied: false,
                };
              }
              if (lockedLocation === 'conflict' && !resolveConflicts) {
                throw sessionLocationError(sessionId);
              }
              const result = await service.archiveSessions([sessionId], {"""
assert old in s, "M5 pattern miss"
open(p,"w").write(s.replace(old,new,1))
PY
A5=$?; K=$(run_pr_tests); report "M5 archive restores the pre-lease alreadyArchived return" $([ $A5 = 0 ] && echo 1 || echo 0) "$K"

restore
echo "done"
