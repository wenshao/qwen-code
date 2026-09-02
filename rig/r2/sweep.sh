#!/usr/bin/env bash
# Fork-latency sweep of the single failed-mint test: sweep.sh <variant> "<lat list>" <repeats>
set -uo pipefail
variant="$1"; lats="$2"; reps="${3:-1}"
for lat in $lats; do bash /rig/ab.sh "sweep-${variant}-${lat}" "$variant" none "$lat" "$reps"; done
