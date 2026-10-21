#!/usr/bin/env bash
# Runs a cell list for one arm; writes one log per cell and a DONE marker.
set -uo pipefail
ARM=$1
HELPER=$2
OUTDIR=$3
shift 3
rm -f "${OUTDIR}/DONE-${ARM}"
for cell in "$@"; do
  OUT="${OUTDIR}/${cell}-${ARM}.log"
  : >"${OUT}"
  ARM="${ARM}" HELPER="${HELPER}" CELL="${cell}" OUT="${OUT}" \
    bash "$(dirname "$0")/cells.sh"
  printf 'runner_exit=%s cell=%s arm=%s\n' "$?" "${cell}" "${ARM}" >>"${OUT}"
done
printf 'done %s\n' "${ARM}" >"${OUTDIR}/DONE-${ARM}"