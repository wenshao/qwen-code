# Runs each arm through the step's run block, extracted verbatim, under the
# same shell flags Actions uses for `shell: bash`.
set -u
mkdir -p probe-out
arm() {
  local name=$1 script=$2 mutation=$3
  git checkout -- integration-tests
  rm -f integration-tests/hosted-process-suite.json
  if [ "$mutation" != none ]; then
    node probe/mutate.mjs "$mutation" || return
    git diff --stat -- integration-tests
  fi
  local t0 t1 rc
  t0=$(date +%s)
  bash --noprofile --norc -eo pipefail "$script" > "probe-out/$name.txt" 2>&1
  rc=$?
  t1=$(date +%s)
  tail -n 25 "probe-out/$name.txt"
  node probe/summarize.mjs "$name" "$rc" "$((t1 - t0))" "$mutation" | tee -a probe-out/summary.txt
  cp integration-tests/hosted-process-suite.json "probe-out/$name.json" 2>/dev/null || true
}
arm head-1 probe/pr-step.sh none
arm head-2 probe/pr-step.sh none
arm head-3 probe/pr-step.sh none
arm main-step probe/main-step.sh none
arm head-skip-on-win32 probe/pr-step.sh skip-on-win32
arm main-step-skip-on-win32 probe/main-step.sh skip-on-win32
arm head-name-filter probe/pr-step.sh name-filter
git checkout -- integration-tests
