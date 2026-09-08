#!/usr/bin/env bash
set -uo pipefail
WT=/root/git/pr11406; H=/root/git/h11406; OUT="$H/runs"; mkdir -p "$OUT"
printf "%-24s %-38s %-14s %s\n" "ARM / MUTANT" "RESULT" "RED AT" "FIRST ERROR"
printf "%-24s %-38s %-14s %s\n" "------------------------" "--------------------------------------" "--------------" "-----------------------------------"
for m in "head" "$@"; do
  cd "$WT"; git checkout HEAD -- packages/web-shell/client/App.test.tsx packages/web-shell/client/App.tsx
  [ "$m" != "head" ] && { python3 "$H/mutate.py" "$m" >/dev/null || { echo "SKIP $m"; continue; }; }
  cd "$WT/packages/web-shell"
  npx vitest run --config vitest.config.ts App.test.tsx -t "does not rerender App for other split sessions" > "$OUT/$m.log" 2>&1
  s=$(grep -E "^ +Tests +[0-9]" "$OUT/$m.log" | tail -1 | sed 's/^ *//;s/ | 794 skipped (796)//')
  l=$(grep -oE "App\.test\.tsx:[0-9]+:[0-9]+" "$OUT/$m.log" | sort -u | head -1 | sed 's/App.test.tsx://;s/:.*//')
  e=$(grep -oE "(AssertionError|ReferenceError|TypeError): .{0,46}" "$OUT/$m.log" | head -1)
  printf "%-24s %-38s %-14s %s\n" "$m" "${s:-<no summary>}" "${l:+line $l}" "$e"
done
cd "$WT" && git checkout HEAD -- packages/web-shell/client/App.test.tsx packages/web-shell/client/App.tsx
