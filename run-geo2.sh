#!/usr/bin/env bash
# PR #10036 -- independent geometry matrix, v2.
# Runs AS ROOT to build fixtures (including genuinely root-owned leftovers a
# containerized co-resident job would leave behind), then drops to the
# unprivileged runner uid to execute the byte-identical release.yml step under
# GitHub's real shell invocation (`bash -e <file>`).
set -uo pipefail
SCRIPT="/root/git/pr10036-harness/restore.sh"
RUID=1500; RGID=1500
OUT="/root/git/pr10036-harness/geo/results.tsv"; : > "$OUT"
PASS=0; FAIL=0
UNSET_SENTINEL='@@UNSET@@'

run_case() {
  local id="$1" expect="$2" setup="$3"
  local base; base="$(mktemp -d "/tmp/geo-XXXXXX")"
  local rws="$base/work/repo" ws="$base/work/repo/repo"
  mkdir -p "$ws" "$base/temp" "$base/toolcache/node" "$base/home/.docker" "$base/fakebin"
  : > "$base/ghenv"
  printf '[credential]\n\thelper = !touch /tmp/PWNED_CRED\n[core]\n\tpager = touch /tmp/PWNED_PAGER\n' > "$base/home/.gitconfig"
  printf '{"proxies":{"default":{"httpProxy":"http://attacker"}}}\n' > "$base/home/.docker/config.json"
  WS_OVERRIDE="$UNSET_SENTINEL"; RWS_OVERRIDE="$UNSET_SENTINEL"; EXTRA_PATH=""; SUDOERS=0
  "$setup" "$base" "$rws" "$ws"
  local wsv="$ws" rwsv="$rws"
  [ "$WS_OVERRIDE" != "$UNSET_SENTINEL" ] && wsv="$WS_OVERRIDE"
  [ "$RWS_OVERRIDE" != "$UNSET_SENTINEL" ] && rwsv="$RWS_OVERRIDE"
  # hand the tree to the unprivileged runner uid, but keep root-owned fixtures
  chown -R $RUID:$RGID "$base" 2>/dev/null
  "$setup"_post "$base" "$rws" "$ws" 2>/dev/null || true
  local out rc
  out="$(setpriv --reuid=$RUID --regid=$RGID --clear-groups \
      env -i PATH="${EXTRA_PATH:+$EXTRA_PATH:}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
      HOME="$base/home" \
      GITHUB_WORKSPACE="$wsv" RUNNER_WORKSPACE="$rwsv" \
      RUNNER_TEMP="$base/temp" RUNNER_TOOL_CACHE="$base/toolcache" \
      GITHUB_ENV="$base/ghenv" \
      GIT_CONFIG_GLOBAL="$base/home/.gitconfig" GIT_CONFIG_COUNT=1 \
      GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0='touch /tmp/PWNED_AMBIENT' \
      bash -e "$SCRIPT" 2>&1)"
  rc=$?
  local verdict detail
  case "$expect" in
    wipe|heal)
      if [ "$rc" -ne 0 ]; then verdict=FAIL; detail="exit=$rc  <== FINDING 2: $(printf '%s' "$out" | tail -1 | cut -c1-88)"
      elif [ -n "$(ls -A "$ws" 2>/dev/null)" ]; then verdict=FAIL; detail="workspace not empty: $(ls -A "$ws" | tr '\n' ' ')"
      elif ! grep -q '^GIT_CONFIG_NOSYSTEM=1$' "$base/ghenv"; then verdict=FAIL; detail="no env redirection"
      else verdict=PASS; detail="wiped + env redirected"; fi ;;
    refuse)
      if [ "$rc" -eq 0 ]; then verdict=FAIL; detail="exit=0 want non-zero"
      elif ! printf '%s' "$out" | grep -q '::error::'; then verdict=FAIL; detail="no ::error:: (rc=$rc): $(printf '%s' "$out"|tail -1|cut -c1-120)"
      else verdict=PASS; detail="$(printf '%s' "$out" | grep -o '::error::.*' | head -1 | cut -c1-108)"; fi ;;
    refuse-bare)
      if [ "$rc" -eq 0 ]; then verdict=FAIL; detail="exit=0 want non-zero"
      else verdict=PASS; detail="refused by \${VAR:?} -- $(printf '%s' "$out" | tail -1 | sed 's|.*restore.sh: ||' | cut -c1-70)"; fi ;;
  esac
  [ "$verdict" = PASS ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$expect" "$verdict" "$rc" "$detail" >> "$OUT"
  printf '%-30s %-11s %-4s rc=%-2s %s\n' "$id" "$expect" "$verdict" "$rc" "$detail"
  "$setup"_verify "$base" "$rws" "$ws" 2>/dev/null || true
  rm -rf "$base" 2>/dev/null
}

noop_post() { :; }
s_happy() { local b=$1 r=$2 w=$3
  echo stale > "$w/leftover.txt"; mkdir -p "$w/.git/hooks" "$w/sub/deep"
  printf '[core]\n\tfsmonitor = touch /tmp/PWNED_FSMON\n\thooksPath = %s/.git/hooks\n' "$w" > "$w/.git/config"
  printf '#!/bin/sh\ntouch /tmp/PWNED_HOOK\n' > "$w/.git/hooks/post-checkout"; chmod +x "$w/.git/hooks/post-checkout"
  echo x > "$w/sub/deep/n.txt"; echo x > "$w/.dotleftover"; chmod 000 "$w/sub/deep/n.txt"; }
s_happy_post() { :; }
s_happy_verify() { local b=$1
  local envf="$b/ghenv"
  # prove the redirected git config really neutralizes the planted global config
  local res
  res="$(setpriv --reuid=1500 --regid=1500 --clear-groups env -i \
      PATH=/usr/bin:/bin HOME="$b/home" \
      $(grep -v '^GIT_CONFIG_PARAMETERS=$' "$envf" | tr '\n' ' ') GIT_CONFIG_PARAMETERS= \
      git config --global --get credential.helper 2>&1)"; local grc=$?
  printf '      git config --global --get credential.helper -> rc=%s out=%q\n' "$grc" "$res"; }
s_trailing() { local b=$1 r=$2 w=$3; echo stale > "$w/x"; WS_OVERRIDE="$w///"; RWS_OVERRIDE="$r//"; }
s_trailing_post() { :; }; s_trailing_verify() { :; }
s_wslink_in() { local b=$1 r=$2 w=$3; rmdir "$w"; echo must-survive > "$r/decoy"; ln -s "$r/decoy" "$w"; }
s_wslink_in_post() { :; }
s_wslink_in_verify() { local b=$1 r=$2; [ -f "$r/decoy" ] && echo "      decoy target survived: YES" || echo "      decoy target survived: NO"; }
s_wslink_out() { local b=$1 r=$2 w=$3; rmdir "$w"; echo must-survive > "$b/outside-decoy"; ln -s "$b/outside-decoy" "$w"; }
s_wslink_out_post() { :; }
s_wslink_out_verify() { local b=$1; [ -f "$b/outside-decoy" ] && echo "      outside decoy survived: YES" || echo "      outside decoy survived: NO"; }
s_wsfile() { local b=$1 r=$2 w=$3; rmdir "$w"; echo notadir > "$w"; }
s_wsfile_post() { :; }; s_wsfile_verify() { :; }
s_rwslink() { local b=$1 r=$2 w=$3; mkdir -p "$b/real-rws/repo"; ln -s "$b/real-rws" "$b/link-rws"; RWS_OVERRIDE="$b/link-rws"; WS_OVERRIDE="$b/link-rws/repo"; }
s_rwslink_post() { :; }; s_rwslink_verify() { :; }
s_rwsmid() { local b=$1 r=$2 w=$3; mkdir -p "$b/realmid/rws/repo"; ln -s "$b/realmid" "$b/midlink"; RWS_OVERRIDE="$b/midlink/rws"; WS_OVERRIDE="$b/midlink/rws/repo"; }
s_rwsmid_post() { :; }; s_rwsmid_verify() { :; }
s_wsmid() { local b=$1 r=$2 w=$3; mkdir -p "$r/realsub/repo"; ln -s "$r/realsub" "$r/sublink"; WS_OVERRIDE="$r/sublink/repo"; }
s_wsmid_post() { :; }; s_wsmid_verify() { :; }
s_outside() { local b=$1 r=$2 w=$3; mkdir -p "$b/elsewhere"; echo keep > "$b/elsewhere/keep.txt"; WS_OVERRIDE="$b/elsewhere"; }
s_outside_post() { :; }
s_outside_verify() { local b=$1; [ -f "$b/elsewhere/keep.txt" ] && echo "      outside dir untouched: YES" || echo "      outside dir untouched: NO"; }
s_eq() { local b=$1 r=$2 w=$3; WS_OVERRIDE="$r"; }
s_eq_post() { :; }; s_eq_verify() { :; }
s_home() { local b=$1 r=$2 w=$3; WS_OVERRIDE="/home"; }
s_home_post() { :; }
s_home_verify() { [ -d /home/vrunner ] && echo "      /home intact: YES" || echo "      /home intact: NO"; }
s_slash() { local b=$1 r=$2 w=$3; WS_OVERRIDE="/"; }
s_slash_post() { :; }; s_slash_verify() { :; }
s_dotdot() { local b=$1 r=$2 w=$3; WS_OVERRIDE="$r/repo/../repo/.."; }
s_dotdot_post() { :; }; s_dotdot_verify() { :; }
s_wsempty() { local b=$1 r=$2 w=$3; WS_OVERRIDE=""; }
s_wsempty_post() { :; }; s_wsempty_verify() { :; }
s_rwsempty() { local b=$1 r=$2 w=$3; RWS_OVERRIDE=""; }
s_rwsempty_post() { :; }; s_rwsempty_verify() { :; }
s_norealpath() { local b=$1 r=$2 w=$3; printf '#!/bin/sh\nexit 127\n' > "$b/fakebin/realpath"; chmod +x "$b/fakebin/realpath"; EXTRA_PATH="$b/fakebin"; }
s_norealpath_post() { :; }; s_norealpath_verify() { :; }
s_rootfile() { local b=$1 r=$2 w=$3; echo stale > "$w/rootfile"; }
s_rootfile_post() { local b=$1 r=$2 w=$3; chown 0:0 "$w/rootfile"; chmod 600 "$w/rootfile"; }
s_rootfile_verify() { :; }
s_rootdir() { local b=$1 r=$2 w=$3; mkdir -p "$w/rootdir/inner"; echo x > "$w/rootdir/inner/f"; }
s_rootdir_post() { local b=$1 r=$2 w=$3; chown -R 0:0 "$w/rootdir"; chmod -R 700 "$w/rootdir"; }
s_rootdir_verify() { :; }

echo "=== PR #10036 wipe-geometry matrix v2 ==="
echo "    script sha256 = $(cat /root/git/pr10036-harness/restore.sha256)"
echo "    fixtures built as root; step executed as uid=$RUID with no sudo rights"
echo
run_case happy-path                wipe   s_happy
run_case trailing-slashes          wipe   s_trailing
run_case ws-symlink-inside-rws     heal   s_wslink_in
run_case ws-symlink-target-outside heal   s_wslink_out
run_case ws-is-a-regular-file      heal   s_wsfile
run_case rws-is-a-symlink          refuse s_rwslink
run_case rws-symlinked-component   refuse s_rwsmid
run_case ws-symlinked-component    refuse s_wsmid
run_case ws-outside-rws            refuse s_outside
run_case ws-equals-rws             refuse s_eq
run_case ws-is-slash-home          refuse s_home
run_case ws-is-slash               refuse s_slash
run_case ws-contains-dotdot        refuse s_dotdot
run_case ws-empty-string           refuse-bare s_wsempty
run_case rws-empty-string          refuse-bare s_rwsempty
run_case realpath-unavailable      refuse s_norealpath
run_case root-owned-leftover-file  wipe   s_rootfile
run_case root-owned-leftover-dir   wipe   s_rootdir
echo
echo "PASS=$PASS FAIL=$FAIL"
