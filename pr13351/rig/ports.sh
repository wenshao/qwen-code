# VERIFICATION RIG ONLY: per-arm ports.  source ports.sh <head|base|...>
case "$1" in head) O=1;; base) O=2;; *) echo "arm?"; return 1 2>/dev/null || exit 1;; esac
SPRING_PORT=1835$O; BROKER_PORT=1435$O; HARNESS_PORT=1735$O; TAP_PORT=1635$O; MODEL_PORT=1535$O; WIRE_PORT=1935$O; VITE_PORT=535$O
DB=pr13351_$1
