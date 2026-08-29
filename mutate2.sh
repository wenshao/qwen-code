#!/usr/bin/env bash
# Mutation probe v2 -- runs as root (so git restore works), executes vitest as
# the unprivileged runner uid so the behavioural wipe suite is not skipped.
set -uo pipefail
cd /root/git/pr10036
WF=.github/workflows/release.yml
DF=Dockerfile
run_tests() {
  setpriv --reuid=1500 --regid=1500 --clear-groups \
    env HOME=/home/vrunner PATH="$PATH" \
    ./node_modules/.bin/vitest run scripts/tests/release-workflow.test.js \
      --reporter=json --outputFile=/tmp/mut.json >/dev/null 2>&1
  node -e '
    const r=require("/tmp/mut.json");
    const a=r.testResults.flatMap(f=>f.assertionResults);
    const failed=[...new Set(a.filter(x=>x.status==="failed").map(x=>x.title))];
    console.log(failed.length ? ("RED   "+failed.length+" test(s): "+failed.map(t=>t.slice(0,46)).join(" ; ")) : "GREEN survives");
  ' 2>/dev/null || echo "RED  (suite crashed)"
}
restore() { git checkout -- "$WF" "$DF"; }
probe() { local id="$1"; shift; restore; if "$@"; then printf '%-44s %s\n' "$id" "$(run_tests)"; else printf '%-44s %s\n' "$id" "SKIP (mutation could not be applied)"; fi; restore; }

m_demote() { python3 - <<'PY'
import sys
p='.github/workflows/release.yml'; s=open(p).read()
alias="      - *restore_release_workspace\n\n"
co="      - name: 'Checkout'\n        uses: 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10' # v6.0.3\n"
i=s.find(alias+co)
if i<0: sys.exit(1)
end=s.find("\n\n", i+len(alias)+len(co))
block=s[i+len(alias):end+2]
s=s[:i]+block+alias+s[end+2:]
open(p,'w').write(s); sys.exit(0)
PY
}
m_drop_wipe()  { grep -q 'find "\$WS" -mindepth 1' "$WF" && sed -i 's|find "\$WS" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +|: # wipe removed|' "$WF"; }
m_wipe_noop()  { sed -i 's|find "\$WS" -mindepth 1 -maxdepth 1|find "$WS" -mindepth 2 -maxdepth 1|' "$WF"; }
m_drop_gate()  { python3 - <<'PY'
import sys
p='.github/workflows/release.yml'; s=open(p).read()
t="""      - &restore_release_workspace
        name: 'Restore workspace ownership'
        if: "${{ runner.environment == 'self-hosted' }}"
"""
if t not in s: sys.exit(1)
open(p,'w').write(s.replace(t,"""      - &restore_release_workspace
        name: 'Restore workspace ownership'
""",1)); sys.exit(0)
PY
}
m_publish_ecs() { python3 - <<'PY'
import sys
p='.github/workflows/release.yml'; s=open(p).read()
t="""    # Publishing carries release credentials, so keep it off the shared pool
    # that also executes pull-request code.
    runs-on: 'ubuntu-latest'
"""
if t not in s: sys.exit(1)
ecs="""    runs-on: '${{ (github.repository == ''QwenLM/qwen-code'' && vars.MAINTAINER_ECS_RUNNER_DISABLED != ''true'') && fromJSON(''["self-hosted", "linux", "x64", "ecs-qwen"]'') || fromJSON(''["ubuntu-latest"]'') }}'
"""
open(p,'w').write(s.replace(t,ecs,1)); sys.exit(0)
PY
}
m_docker_warn() { python3 - <<'PY'
import sys
p='.github/workflows/release.yml'; s=open(p).read()
t="""            printf '%s\\n' "$docker_info_output"
            exit 1
"""
if t not in s: sys.exit(1)
open(p,'w').write(s.replace(t,"""            printf '%s\\n' "$docker_info_output"
""",1)); sys.exit(0)
PY
}
m_unpin()   { sed -i 's|@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5||g' "$DF"; }
m_timeout() { python3 - <<'PY'
import sys
p='.github/workflows/release.yml'; s=open(p).read()
t="    timeout-minutes: 120\n    needs: 'prepare'\n"
if t not in s: sys.exit(1)
open(p,'w').write(s.replace(t,"    timeout-minutes: 360\n    needs: 'prepare'\n",1)); sys.exit(0)
PY
}
m_drop_component() { python3 - <<'PY'
import re,sys
p='.github/workflows/release.yml'; s=open(p).read()
t = """          if [ "$RWS" != "$RWS_LEX" ]; then
            echo "::error::refusing to wipe: runner workspace resolves through a symlinked component: ${RWS_LEX} resolves to ${RWS}"
            exit 1
          fi
"""
if t not in s: sys.exit(1)
open(p,'w').write(s.replace(t,"",1)); sys.exit(0)
PY
}
m_drop_denylist() { python3 - <<'PY'
import sys
p='.github/workflows/release.yml'; s=open(p).read()
t = """          case "$WS" in
            /|/home|/root|/usr*|/etc*|/var|"") echo "::error::refusing to wipe suspicious workspace path: ${WS}"; exit 1 ;;
          esac
"""
if t not in s: sys.exit(1)
open(p,'w').write(s.replace(t,"",1)); sys.exit(0)
PY
}
m_drop_containment() { python3 - <<'PY'
import sys
p='.github/workflows/release.yml'; s=open(p).read()
t = """          case "$WS" in
            "$RWS"/*) ;;
            *) echo "::error::refusing to wipe workspace outside the runner workspace: ${WS} (runner workspace: ${RWS})"; exit 1 ;;
          esac
"""
if t not in s: sys.exit(1)
open(p,'w').write(s.replace(t,"",1)); sys.exit(0)
PY
}
m_drop_heal() { python3 - <<'PY'
import re,sys
p='.github/workflows/release.yml'; s=open(p).read()
i=s.find('          if [ -L "$WS" ] || [ ! -d "$WS" ]; then')
if i<0: sys.exit(1)
j=s.find('          # Heal only guarantees the LEAF is real', i)
if j<0: sys.exit(1)
open(p,'w').write(s[:i]+s[j:]); sys.exit(0)
PY
}
m_notify_ecs() { python3 - <<'PY'
import sys
p='.github/workflows/release.yml'; s=open(p).read()
t="""    runs-on: 'ubuntu-latest'
    timeout-minutes: 10
"""
if t not in s: sys.exit(1)
ecs="""    runs-on: '${{ (github.repository == ''QwenLM/qwen-code'' && vars.MAINTAINER_ECS_RUNNER_DISABLED != ''true'') && fromJSON(''["self-hosted", "linux", "x64", "ecs-qwen"]'') || fromJSON(''["ubuntu-latest"]'') }}'
    timeout-minutes: 10
"""
open(p,'w').write(s.replace(t,ecs,1)); sys.exit(0)
PY
}

restore
echo "=== baseline (no mutation) ==="
printf '%-44s %s\n' "(unmutated PR head)" "$(run_tests)"
echo
echo "=== mutants (RED = a test catches it) ==="
probe "M1  restore step demoted below checkout"      m_demote
probe "M2  wipe line deleted"                        m_drop_wipe
probe "M3  wipe made a no-op (mindepth 1 -> 2)"      m_wipe_noop
probe "M4  self-hosted 'if' gate removed"            m_drop_gate
probe "M5  publish routed onto the ECS pool"         m_publish_ecs
probe "M6  notify_failure routed onto the ECS pool"  m_notify_ecs
probe "M7  docker preflight degraded to a warning"   m_docker_warn
probe "M8  Dockerfile base digest un-pinned"         m_unpin
probe "M9  quality timeout 120 -> 360"               m_timeout
probe "M10 symlinked-component refusal removed"      m_drop_component
probe "M11 suspicious-path denylist removed"         m_drop_denylist
probe "M12 runner-workspace containment removed"     m_drop_containment
probe "M13 symlink heal block removed"               m_drop_heal
restore
echo
git status --short || true
