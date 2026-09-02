#!/usr/bin/env bash
# xshot.sh <ansi-file> <out.png> [cols] [fontsize]
# Real xterm on an Xvfb display, captured with ImageMagick `import`, then trimmed.
set -u
f="$1"; out="$2"; cols="${3:-auto}"; fs="${4:-12}"
lines="$(wc -l < "$f")"; rows=$(( lines + 1 )); [ "$rows" -gt 60 ] && rows=60
if [ "$cols" = auto ]; then
  w="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$f" | awk '{ if (length($0) > m) m = length($0) } END { print m }')"
  cols=$(( w + 2 )); [ "$cols" -lt 60 ] && cols=60; [ "$cols" -gt 170 ] && cols=170
fi
disp=":$((RANDOM % 900 + 100))"
Xvfb "$disp" -screen 0 2400x1800x24 -nolisten tcp >/dev/null 2>&1 &
xpid=$!
sleep 0.8
DISPLAY="$disp" xterm -geometry "${cols}x${rows}+0+0" -bg '#101418' -fg '#e6e6e6' -fa 'DejaVu Sans Mono' -fs "$fs" \
  -e bash -c "cat '$f'; sleep 60" >/dev/null 2>&1 &
tpid=$!
sleep 2.5
DISPLAY="$disp" import -window root "$out" 2>/dev/null
convert "$out" -trim +repage -bordercolor '#101418' -border 12 "$out" 2>/dev/null
kill $tpid $xpid 2>/dev/null; wait $tpid $xpid 2>/dev/null
echo "$out: $(identify -format '%wx%h' "$out" 2>/dev/null) rows=$rows cols=$cols"
