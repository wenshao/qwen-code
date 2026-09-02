#!/usr/bin/env bash
# Direct probe: what does heartbeat.log actually hold when the post-fix gate
# times out? Runs the loop the same way the test does (failing mint), for the
# pristine script and for the pulse-death mutant, and prints the log the
# assertion message does NOT show.
set -uo pipefail
SRC=/rig/src
for mutant in none dieonskip; do
  work="$(mktemp -d /tmp/probe.XXXXXX)"
  cp "$SRC/autofix-status-heartbeat.sh" "$work/hb.sh"
  if [ "$mutant" = dieonskip ]; then
    python3 - "$work/hb.sh" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='''      echo "$(date -u +%FT%TZ) gh config mint failed; skipping this tick"
      continue'''
new='''      echo "$(date -u +%FT%TZ) gh config mint failed; skipping this tick"
      exit 0'''
assert s.count(old)==1
open(p,'w').write(s.replace(old,new))
PY
  fi
  mkdir -p "$work/wd" "$work/bin"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$work/bin/gh"; chmod +x "$work/bin/gh"
  env -i PATH="$work/bin:/usr/local/bin:/usr/bin:/bin" TRUSTED_PATH="$work/bin:/usr/local/bin:/usr/bin:/bin" \
      GITHUB_TOKEN=fake HB_REPO=octo/repo HB_COMMENT_ID=777 HB_ROUND=2 HB_CAP=100 \
      HB_URL=https://example.test/run HB_WORKDIR="$work/wd" \
      HB_START_EPOCH="$(date +%s)" HB_INTERVAL_SECONDS=1 \
      RUNNER_TEMP="$work/no-such-runner-temp" \
      setsid bash "$work/hb.sh" loop &
  loop=$!
  sleep 8
  kill -9 -"$loop" 2>/dev/null; kill -9 "$loop" 2>/dev/null
  echo "======== script=${mutant} — heartbeat.log after 8s (the post-fix gate's whole budget) ========"
  cat "$work/wd/heartbeat.log"
  echo "-------- skip lines: $(grep -c 'skipping this tick' "$work/wd/heartbeat.log") --------"
  echo
  rm -rf "$work"
done
