#!/usr/bin/env bash
# gen.sh <rows> <exit> [delay_s] [mode]
#   rows    : number of 72-char "row NNNNNN ..." lines (mode=line: one line of rows*72 chars)
#   exit    : exit code
#   delay_s : seconds to wait AFTER printing (drives the long-run advisory)
#   mode    : rows | line | hang (hang = print, then block until the tool times out)
rows=$1 code=$2 delay=${3:-0.3} mode=${4:-rows}
pad='abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxy'
if [ "$mode" = line ]; then
  awk -v n="$rows" -v p="$pad" 'BEGIN{for(i=1;i<=n;i++) printf "row %06d %s|", i, p; printf "\n"}'
else
  awk -v n="$rows" -v p="$pad" 'BEGIN{for(i=1;i<=n;i++) printf "row %06d %s\n", i, p}'
fi
if [ "$mode" = hang ]; then
  echo "TAIL-STATUS: still running after row $rows (waiting on upstream lock)"
  exec tail -f /dev/null
fi
if [ "$code" = 0 ]; then
  echo "TAIL-STATUS: OK - $rows rows written, checksum 9f2c"
else
  echo "TAIL-STATUS: FAILED - disk quota exceeded while writing row $((rows + 1))"
fi
perl -e "select(undef,undef,undef,$delay)"
exit "$code"
