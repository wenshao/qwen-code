#!/bin/bash
# Passed to the IT as -Dnode.executable. It is a transparent wrapper around the real Node 22 binary that
#  (1) records, per invocation, the environment the child REALLY received and what os.tmpdir() resolves to in it;
#  (2) optionally injects a fault for the Hosted Harness process only (mode read from probe/ctl, because the
#      IT clears the child environment):
#        harness-dead  the Harness prints a line and exits 7 before listening
#        model-400     the Harness's model endpoint is repointed at a server that answers 400 (non-retryable)
# The production processes are otherwise untouched: the wrapper execs the same node with the same argv.
RIG=/Users/wenshao/pr13095-rig
REAL=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
[ -f /rig-linux ] && { RIG=/rig; REAL=$(PATH=/usr/local/bin:/usr/bin:$PATH command -v node); }
CTL=$RIG/probe/ctl; LOG=; FAULT=; BAD_MODEL=
[ -f "$CTL" ] && . "$CTL"
ROLE=other
case " $* " in *" serve "*"hosted-harness"*) ROLE=harness;; *worker*|*runtime*) ROLE=worker;; esac
if [ -n "$LOG" ]; then
  {
    echo "=== $(date -u +%H:%M:%S) role=$ROLE pid=$$ ppid=$PPID"
    echo "argv: $(echo "$*" | cut -c1-160)"
    echo "env names: $(env | cut -d= -f1 | sort | tr '\n' ' ')"
    echo "TMPDIR=${TMPDIR-<unset>}"; echo "TMP=${TMP-<unset>}"; echo "TEMP=${TEMP-<unset>}"; echo "HOME=${HOME-<unset>}"
    echo "os.tmpdir()=$("$REAL" -p 'require("os").tmpdir()')"
    echo "fs.realpathSync(os.tmpdir())=$("$REAL" -p 'require("fs").realpathSync(require("os").tmpdir())')"
  } >> "$LOG" 2>&1
fi
if [ "$ROLE" = harness ]; then
  case "$FAULT" in
    harness-dead)
      echo "PROBE-FAULT: simulated Hosted Harness startup crash (exit 7)"; exit 7;;
    model-400)
      # settings.json is the fixture's own file under the fixture's own QWEN_HOME
      "$REAL" -e 'const fs=require("fs");const f=process.env.QWEN_HOME+"/settings.json";const s=JSON.parse(fs.readFileSync(f,"utf8"));s.modelProviders.openai[0].baseUrl=process.argv[1];fs.writeFileSync(f,JSON.stringify(s));' "$BAD_MODEL"
      export OPENAI_BASE_URL="$BAD_MODEL"
      echo "PROBE-FAULT: model endpoint repointed to $BAD_MODEL";;
  esac
fi
exec "$REAL" "$@"
