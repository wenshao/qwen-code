#!/bin/bash
# VERIFICATION RIG ONLY: which approval mode / timeout combinations the server accepts at startup (Workspace files enabled).
# usage: startup-matrix.sh <jar-label>
cd /rig; L=$1; DB=d6val_$L; mkdir -p out/$DB; : > out/$DB/startup-matrix.log
while read -r mode tmo; do
  out=$(./spring.sh $L $DB $mode $tmo 2>&1 | tail -1)
  log=$(ls -t run/$DB/spring-*.log | head -1)
  why=$(grep -h "Caused by: java.lang.IllegalStateException" $log | tail -1 | sed 's/.*IllegalStateException: //' | cut -c1-110)
  [ -z "$why" ] && why=$(grep -h "Caused by: \|APPLICATION FAILED\|Reason:" $log | tail -1 | cut -c1-140)
  if echo "$out" | grep -q "spring up"; then r="STARTS "; why=""; ./stop.sh $DB spring > /dev/null; else r="REFUSES"; fi
  printf '%s  mode=%-10s timeout=%-8s %s\n' "$r" "$mode" "$tmo" "$why" | tee -a out/$DB/startup-matrix.log
done <<LIST
absent absent
yolo absent
default absent
auto-edit absent
DEFAULT absent
plan absent
auto absent
bogus absent
default 999ms
default 1s
default 24h
default 86401s
yolo 0s
LIST
