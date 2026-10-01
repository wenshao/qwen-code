#!/bin/bash
# PR #12650 round-2 rig. Runs inside pr12650-rig:r2 (Ubuntu 24.04.4, dash,
# git 2.55, GNU xargs 4.9, file 5.45) natively on x86_64, as root, against a
# workspace owned by github-runner (uid 1001) — the #12647 shape.
set -u
IN=/in
OUT=/out
WS=/home/github-runner/actions-runner-hk3-13/_work/qwen-code/qwen-code
TEMP=/home/github-runner/actions-runner-hk3-13/_work/_temp
export PATH=/opt/node22/bin:$PATH
export XDG_CACHE_HOME=/cache
export RUNNER_TEMP=$TEMP GITHUB_RUN_ID=36770735659 GITHUB_RUN_ATTEMPT=1 GITHUB_JOB=lint_and_static GITHUB_WORKSPACE=$WS
mkdir -p "$OUT" "$TEMP"
c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }

# ---- workspace: the PR head tree, committed by the runner user -------------
if [ ! -d "$WS/.git" ]; then
  mkdir -p "$WS"
  tar -xf "$IN/tree-pr.tar" -C "$WS"
  chown -R 1001:1001 /home/github-runner
  su github-runner -c "cd '$WS' && git init -q && git add -A -f && git -c user.name=r -c user.email=r@x commit -qm tree" || exit 1
fi
echo "tracked files: $(su github-runner -c "git -C '$WS' ls-files | wc -l")" > "$OUT/workspace.txt"
echo "owner: $(stat -c '%U(%u)' "$WS") ; job user: $(id -un)($(id -u)) ; HOME=$HOME" >> "$OUT/workspace.txt"

# One GitHub Actions `run:` step, with the workflow's default bash shell.
step() { # name, command  -> prints, records exit+duration
  local name=$1 cmd=$2 t0 t1 rc
  t0=$(date +%s.%N)
  (cd "$WS" && bash --noprofile --norc -eo pipefail -c "$cmd") >"$OUT/cur.out" 2>"$OUT/cur.err"
  rc=$?
  t1=$(date +%s.%N)
  LAST_RC=$rc
  LAST_SECS=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.2f", b-a}')
}

use_arm() { cp "$IN/lint.$1.js" "$WS/scripts/lint.js"; }

install_shims() { # argv-logging shims first on the lane PATH, exec the real binaries
  mkdir -p "$WS/node_modules/.bin"
  cat > "$WS/node_modules/.bin/shellcheck" <<EOF
#!/bin/sh
n=0; for a in "\$@"; do case "\$a" in --*) ;; *) n=\$((n+1));; esac; done
echo "shellcheck call files=\$n" >> "$OUT/calls.log"
exec "$TEMP/qwen-code-linters/$GITHUB_RUN_ID-1-$GITHUB_JOB/shellcheck/shellcheck" "\$@"
EOF
  cat > "$WS/node_modules/.bin/yamllint" <<EOF
#!/bin/sh
n=0; for a in "\$@"; do case "\$a" in --format|github) ;; *) n=\$((n+1));; esac; done
echo "yamllint call files=\$n" >> "$OUT/calls.log"
exec /usr/local/bin/yamllint "\$@"
EOF
  chmod +x "$WS/node_modules/.bin/"*
}
remove_shims() { rm -rf "$WS/node_modules"; }

lanes() { # scenario-tag arm
  local tag=$1 arm=$2 lane
  use_arm "$arm"
  remove_shims
  step setup "node scripts/lint.js --setup"
  cp "$OUT/cur.out" "$OUT/$tag.$arm.setup.out"; cp "$OUT/cur.err" "$OUT/$tag.$arm.setup.err"
  echo "$LAST_RC $LAST_SECS" > "$OUT/$tag.$arm.setup.rc"
  install_shims
  for lane in shellcheck yamllint; do
    : > "$OUT/calls.log"
    step "$lane" "node scripts/lint.js --$lane"
    cp "$OUT/cur.out" "$OUT/$tag.$arm.$lane.out"; cp "$OUT/cur.err" "$OUT/$tag.$arm.$lane.err"
    cp "$OUT/calls.log" "$OUT/$tag.$arm.$lane.calls"
    echo "$LAST_RC $LAST_SECS" > "$OUT/$tag.$arm.$lane.rc"
  done
  remove_shims
}

reset_gitconfig() { rm -f /root/.gitconfig; }

case "${1:-all}" in
  trigger)   # S1: #12647 — root job, runner-owned workspace, no safe.directory
    reset_gitconfig
    for arm in base pr; do lanes S1 "$arm"; done ;;
  healthy)   # S2: the verbatim ci.yml "Restore workspace ownership" step first
    reset_gitconfig
    (cd "$WS" && bash --noprofile --norc -eo pipefail "$IN/restore-step.sh") > "$OUT/S2.restore.out" 2>&1
    echo "restore rc=$?" >> "$OUT/S2.restore.out"
    git config --global --get-all safe.directory >> "$OUT/S2.restore.out"
    for arm in base pr; do lanes S2 "$arm"; done ;;
  softfail)  # S3: same verbatim step, but HOME is read-only so the add soft-fails
    export HOME=/rohome
    (cd "$WS" && bash --noprofile --norc -eo pipefail "$IN/restore-step.sh") > "$OUT/S3.restore.out" 2>&1
    echo "restore rc=$?" >> "$OUT/S3.restore.out"
    for arm in base pr; do lanes S3 "$arm"; done ;;
  violations) # S4: healthy tree + one duplicate-key YAML and one unparseable script
    reset_gitconfig; git config --global --add safe.directory "$WS"
    printf 'name: dup\nname: dup2\n' > "$WS/zz-dup-key.yml"
    printf '#!/bin/sh\nif [ "$1" = x ]; then\n  echo "unterminated\nfi\n' > "$WS/zz-broken.sh"
    chown 1001:1001 "$WS/zz-dup-key.yml" "$WS/zz-broken.sh"
    su github-runner -c "cd '$WS' && git add zz-dup-key.yml zz-broken.sh"
    for arm in base pr; do lanes S4 "$arm"; done
    su github-runner -c "cd '$WS' && git rm -q --cached zz-dup-key.yml zz-broken.sh"
    rm -f "$WS/zz-dup-key.yml" "$WS/zz-broken.sh" ;;
esac

# S5: surviving unit-test mutants, driven through the real lanes on the healthy tree
if [ "${1:-}" = mutants ]; then
  reset_gitconfig; git config --global --add safe.directory "$WS"
  for arm in m17 m18; do
    use_arm "$arm"; remove_shims
    for lane in setup actionlint shellcheck yamllint; do
      step "$lane" "node scripts/lint.js --$lane"
      cp "$OUT/cur.out" "$OUT/S5.$arm.$lane.out"; cp "$OUT/cur.err" "$OUT/S5.$arm.$lane.err"
      echo "$LAST_RC $LAST_SECS" > "$OUT/S5.$arm.$lane.rc"
    done
  done
  use_arm pr
fi

# S6: follow-up candidate (shellcheck status) vs PR, natively with the pinned x86_64 shellcheck
if [ "${1:-}" = cand ]; then
  reset_gitconfig; git config --global --add safe.directory "$WS"
  SC="$TEMP/qwen-code-linters/$GITHUB_RUN_ID-1-$GITHUB_JOB/shellcheck/shellcheck"
  lanes S6h cand
  printf 'name: dup\nname: dup2\n' > "$WS/zz-dup-key.yml"
  printf '#!/bin/sh\nif [ "$1" = x ]; then\n  echo "unterminated\nfi\n' > "$WS/zz-broken.sh"
  printf '#!/bin/sh\necho $1\n' > "$WS/zz-sc2086.sh"
  chown 1001:1001 "$WS"/zz-*; su github-runner -c "cd '$WS' && git add zz-broken.sh"
  lanes S6err cand
  su github-runner -c "cd '$WS' && git rm -q --cached zz-broken.sh && git add zz-sc2086.sh"
  for arm in pr cand; do lanes S6warn "$arm"; done
  su github-runner -c "cd '$WS' && git rm -q --cached zz-sc2086.sh"; rm -f "$WS"/zz-*
  for arm in pr cand; do
    for kind in missing crash; do
      use_arm "$arm"; remove_shims
      step setup "node scripts/lint.js --setup"
      if [ "$kind" = missing ]; then rm -f "$SC"; else printf '#!/bin/sh\nkill -SEGV $$\n' > "$SC"; chmod +x "$SC"; fi
      step shellcheck "node scripts/lint.js --shellcheck"
      cp "$OUT/cur.out" "$OUT/S6$kind.$arm.shellcheck.out"; cp "$OUT/cur.err" "$OUT/S6$kind.$arm.shellcheck.err"
      echo "$LAST_RC $LAST_SECS" > "$OUT/S6$kind.$arm.shellcheck.rc"
    done
  done
  use_arm pr
fi

if [ "${1:-}" = mutants2 ]; then
  reset_gitconfig; git config --global --add safe.directory "$WS"
  for arm in m11 m16; do lanes S5 "$arm"; done
  use_arm pr
fi
