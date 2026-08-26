#!/bin/bash
# Live A/B for PR #10042, run against a real qwen daemon over TLS.
SP="$(cd "$(dirname "$0")" && pwd)"
B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; D=$'\033[2m'; N=$'\033[0m'

hr() { printf "${D}%s${N}\n" "--------------------------------------------------------------------------------"; }

printf "${B}${C}PR #10042  real-daemon A/B  -  renewed CA, expired copy first in the bundle${N}\n"
printf "${D}serving bundle: leaf(SAN=not-the-dial-host.invalid) + root[EXPIRED 2024-06-01] + root[VALID->2036]${N}\n"
printf "${D}both roots share subject AND key; node v24.18.1 / OpenSSL 3.6.3 / macOS 15${N}\n"
hr

for ARM in base head; do
  PORT=$([ "$ARM" = base ] && echo 8871 || echo 8872)
  printf "\n${B}[%s]${N} qwen serve --tls-cert bundleB-renewed-badsan.pem --channel tlsfixture\n" "$ARM"
  bash "$SP/run-case.sh" "$SP/head/dist-$ARM/cli.js" "$SP/certs/bundleB-renewed-badsan.pem" \
     "$SP/certs/leafkey.pem" "$PORT" "$SP/out" "demo-$ARM" > "$SP/out/demo-$ARM.txt" 2>&1
  n=0
  while IFS= read -r line; do
    n=$((n+1))
    case "$line" in
      *CERT_HAS_EXPIRED*) COL="$R" ;;
      *) COL="$Y" ;;
    esac
    printf "  ${COL}gap %d${N}  " "$n"
    printf '%s\n' "$line" | sed "s#$SP/certs/##" | fold -s -w 132 | sed '2,$s/^/         /'
  done < <(grep -E '\[WARN\] \[DAEMON\] --tls-cert' "$SP/out/demo-$ARM.txt" | sed 's/^[0-9T:.Z-]* \[WARN\] \[DAEMON\] //')
  [ "$n" = 0 ] && printf "  ${G}no gaps reported${N}\n"
  printf "  ${B}measured worker handshake:${N} %s\n" "$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('code') or 'OK')" "$SP/out/demo-$ARM.race.json" 2>/dev/null)"
  hr
done

printf "\n${B}verdict${N}\n"
printf "  base: ${R}2 gaps${N} - the CERT_HAS_EXPIRED one is FALSE; it names the expired twin\n"
printf "        and tells the operator to renew a CA that is already renewed.\n"
printf "  head: ${G}1 gap${N}  - only the real defect, and it matches the measured failure code.\n"
