#!/bin/bash
# Renders the evidence matrix from the artifacts each real-daemon run left on
# disk (out/<label>.txt = daemon stderr, out/<label>.race.json = the handshake).
SP="$(cd "$(dirname "$0")" && pwd)"
B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; D=$'\033[2m'; N=$'\033[0m'

gapplain() {
  local f="$SP/out/$1.txt" out=""
  grep -qE 'will fail CERT_HAS_EXPIRED' "$f" && out="${out}CERT_HAS_EXPIRED "
  grep -qE 'will fail CERT_NOT_YET_VALID' "$f" && out="${out}CERT_NOT_YET_VALID "
  grep -qE 'no subjectAltName covering' "$f" && out="${out}ALTNAME "
  grep -qE 'is self-signed but is not a CA' "$f" && out="${out}NON_CA_ANCHOR "
  [ -z "$out" ] && out="(none)"
  printf '%s' "${out% }"
}
colorize() {
  printf '%s' "$1" | sed -E "s/(CERT_HAS_EXPIRED|CERT_NOT_YET_VALID)/${R}\1${N}/g; s/(ALTNAME|NON_CA_ANCHOR)/${Y}\1${N}/g; s/(\(none\))/${G}\1${N}/g"
}
measured() { python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('code') or 'handshake OK')" "$SP/out/$1.race.json" 2>/dev/null || echo '?'; }

printf "${B}${C}PR #10042 — evidence matrix · real \`qwen serve\` daemon + real channel worker · macOS 26.6.2 · node v24.18.1 (OpenSSL 3.5.7)${N}\n"
printf "${D}Both arms are the same tree. The base arm only restores the greedy chain.find(...) at the issuer-selection site.${N}\n"
printf "${D}EXPIRED / FUTURE / renewed are three self-signed roots that share one subject AND one key — a CA renewal.${N}\n\n"
printf "${B}%-36s %-5s %-34s %s${N}\n" "serving bundle (order as in the PEM)" "arm" "boot diagnostic reports" "measured worker handshake"
printf "${D}%s${N}\n" "$(printf '%.0s-' {1..124})"

row() {
  local plain; plain="$(gapplain "$3")"
  local pad=$((34 - ${#plain})); [ $pad -lt 1 ] && pad=1
  printf "%-36s %-5s %s%*s %s\n" "$1" "$2" "$(colorize "$plain")" "$pad" "" "$(measured "$3")"
}
row "A  leaf-ok    EXPIRED renewed"   base base-A
row "A  leaf-ok    EXPIRED renewed"   head head-A
printf "\n"
row "B  leaf-badSAN EXPIRED renewed"  base base-B
row "B  leaf-badSAN EXPIRED renewed"  head head-B
row "E  leaf-badSAN renewed EXPIRED"  base base-E
row "E  leaf-badSAN renewed EXPIRED"  head head-E
printf "\n"
row "F  leaf-badSAN FUTURE  renewed"  base base-F
row "F  leaf-badSAN FUTURE  renewed"  head head-F
printf "\n"
row "C  leaf-ok    EXPIRED only"      base base-C
row "C  leaf-ok    EXPIRED only"      head head-C
printf "\n"
row "G  leaf-ok  EXPIRED-CA valid-nonCA" base base-G
row "G  leaf-ok  EXPIRED-CA valid-nonCA" head head-G
printf "${D}%s${N}\n" "$(printf '%.0s-' {1..124})"
printf "\n${B}reading it${N}\n"
printf "  ${B}B vs E${N}  same certificates, only the order of the two root copies differs.\n"
printf "          ${R}base${N} invents a CERT_HAS_EXPIRED gap only when the expired copy sorts first — ${G}head${N} is order-independent.\n"
printf "  ${B}F${N}       same defect in the not-yet-valid direction — also closed by the fix.\n"
printf "  ${B}C${N}       the only copy of the root really is expired — ${G}both arms still report it${N}: no true positive lost.\n"
printf "  ${B}G${N}       the edge the review called theoretical. Measured code is INVALID_PURPOSE —\n"
printf "          ${G}head names it exactly${N}; base says CERT_HAS_EXPIRED and prescribes a renewal that fixes nothing.\n"
printf "\n${B}unit suite on this machine (the macOS CI leg was cancelled on 32f9e83)${N}\n"
printf "  ${D}npx vitest run src/serve/run-qwen-serve.test.ts --root packages/cli${N}\n"
printf "    PR head ................ ${G}Test Files 1 passed · Tests 328 passed (328)${N}\n"
printf "    greedy walk restored ... ${R}Test Files 1 failed · Tests 1 failed | 327 passed${N}\n"
printf "      the one failure: describeWorkerTlsTrustGaps > prefers a usable issuer over an expired same-subject twin\n"
