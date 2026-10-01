#!/bin/bash
# Builds the ANSI transcripts for the figures from the captured rig/host outputs.
O=/root/verify/pr12650/r2/out; H=/root/verify/pr12650/r2/host
B=$'\033[1m'; R=$'\033[0m'; G=$'\033[32m'; RD=$'\033[31m'; Y=$'\033[33m'; C=$'\033[36m'; D=$'\033[2m'; M=$'\033[35m'
rc() { cut -d' ' -f1 "$1"; }; secs() { cut -d' ' -f2 "$1"; }
verdict() { # rc file, good-rc, label
  local r; r=$(rc "$1"); if [ "$r" = "$2" ]; then printf '%s' "$G"; else printf '%s' "$RD"; fi; printf 'exit %s%s  (%ss)%s' "$r" "$3" "$(secs "$1")" "$R"; }
trim_err() { # file, max lines — git's error in red, the lane's own verdict line in bold yellow
  local n; n=$(wc -l < "$1")
  head -n "$2" "$1" | sed -e "/refusing to\|is required/{s/^/$B$Y/;s/\$/$R/;b}" -e "/^fatal:/{s/^/$RD/;s/\$/$R/;b}" -e "s/^/$D/;s/\$/$R/"
  [ "$n" -gt "$2" ] && echo "$D… ($((n-$2)) more usage lines elided)$R"; true; }

pane_trigger() { # tag arm
  local t=$1 a=$2
  echo "${C}\$ node scripts/lint.js --shellcheck${R}"
  grep -v '^$' "$O/$t.$a.shellcheck.out"
  trim_err "$O/$t.$a.shellcheck.err" 6
  local calls; calls=$(cat "$O/$t.$a.shellcheck.calls" 2>/dev/null)
  echo "${M}[argv shim] ${calls:-shellcheck never invoked}${R}"
  if [ "$a" = base ]; then echo "$(verdict "$O/$t.$a.shellcheck.rc" 1 '  ← FALSE GREEN, 0 files linted')"; else echo "$(verdict "$O/$t.$a.shellcheck.rc" 1 '  ← fails on git'"'"'s error')"; fi
  echo
  echo "${C}\$ node scripts/lint.js --yamllint${R}"
  grep -v '^$' "$O/$t.$a.yamllint.out"
  trim_err "$O/$t.$a.yamllint.err" 9
  calls=$(cat "$O/$t.$a.yamllint.calls" 2>/dev/null)
  echo "${M}[argv shim] ${calls:-yamllint never invoked}${R}"
  if [ "$a" = base ]; then echo "$Y$(verdict "$O/$t.$a.yamllint.rc" 1 '  ← fails, but on the usage screen' | sed 's/\x1b\[32m//')$R"; else echo "$(verdict "$O/$t.$a.yamllint.rc" 1 '  ← fails on git'"'"'s error')"; fi
}
pane_trigger S1 base > p1-base.ansi
pane_trigger S1 pr   > p1-pr.ansi
{ echo "${C}\$ bash restore-step.sh   ${D}# verbatim 'Restore workspace ownership' step from ci.yml (#12648), \$HOME read-only${R}"; grep -v '^restore rc' "$O/S3.restore.out" | sed "s/::warning::/${Y}::warning::/;s/\$/$R/"; echo "${G}step exit 0 — the job continues${R}"; } > p3-restore.ansi
{ pane_trigger S3 base; } > p3-base.ansi
{ pane_trigger S3 pr; } > p3-pr.ansi
