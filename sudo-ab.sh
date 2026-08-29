#!/usr/bin/env bash
# A/B: root-owned leftover directory in the persistent workspace, with and
# without passwordless sudo for the runner uid.
set -uo pipefail
SCRIPT=/root/git/pr10036-harness/restore.sh
one() {
  local label="$1"
  local base; base="$(mktemp -d /tmp/sudoab-XXXXXX)"
  local rws="$base/work/repo" ws="$base/work/repo/repo"
  mkdir -p "$ws" "$base/temp" "$base/home"; : > "$base/ghenv"
  mkdir -p "$ws/rootdir/inner"; echo secret > "$ws/rootdir/inner/f"
  chown -R 1500:1500 "$base"; chown -R 0:0 "$ws/rootdir"; chmod -R 700 "$ws/rootdir"
  local out rc
  out="$(setpriv --reuid=1500 --regid=1500 --clear-groups \
    env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME="$base/home" \
      GITHUB_WORKSPACE="$ws" RUNNER_WORKSPACE="$rws" RUNNER_TEMP="$base/temp" \
      RUNNER_TOOL_CACHE="$base/tc" GITHUB_ENV="$base/ghenv" \
      bash -e "$SCRIPT" 2>&1)"; rc=$?
  echo "--- $label ---"
  echo "exit=$rc"
  printf '%s\n' "$out" | sed 's/^/    /' | tail -6
  local left; left="$(ls -A "$ws" 2>/dev/null | tr '\n' ' ')"
  echo "    workspace after: [${left:-<empty>}]"
  rm -rf "$base" 2>/dev/null; sudo rm -rf "$base" 2>/dev/null
}
echo "### PR #10036: root-owned leftover directory (mode 700) from a co-resident containerized job"
rm -f /etc/sudoers.d/vrunner
one "WITHOUT passwordless sudo for the runner uid"
echo 'vrunner ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/vrunner; chmod 440 /etc/sudoers.d/vrunner
one "WITH passwordless sudo for the runner uid"
rm -f /etc/sudoers.d/vrunner
