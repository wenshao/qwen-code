#!/usr/bin/env bash
# Figure 3: several Broker JVMs on one real MySQL 8.4 — what the PR gets right.
H=/root/verify/pr12438-harness; L=$H/logs
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; RD=$'\e[31m'; Y=$'\e[33m'; D=$'\e[2m'; X=$'\e[0m'
strip() { sed -E 's/\x1b\[[0-9;]*m//g'; }
short() { sed -E 's/async RuntimeBrokerException\(503 ([a-z_]+), retryable=true\)/\1 (503, retryable)/'; }
echo "${B}${C}PR #12438 @ 054159f — several Broker JVMs sharing one MySQL 8.4.11 (JdbcRuntimeBinding/SessionRepository from #12390)${X}"
echo "${D}BrokerNode = RuntimeBrokerService + JDBC binding/session repositories; the fake provisioner logs every physical call to a MySQL table.${X}"
echo
for s in M1 M2 M3 M4; do
  f=$L/$s.ansi
  head -1 $f | strip | sed -E "s/^(M[0-9])  /${B}\1${X}  /"
  case $s in
    M1) strip < $f | short | awk '
          /\[broker-[0-9]\]/ { b=$2; t=$1
            if ($0 ~ /provisioner called/) prov[b]=t
            if ($0 ~ /warm attempt 1 ->/) { sub(/.*-> /,""); first[b]=$0; ft[b]=t }
            if ($0 ~ /final after/) { n=$0; sub(/.*final after /,"",n); sub(/ attempt.*/,"",n); att[b]=n; l=$0; sub(/.*: /,"",l); last[b]=l; lt[b]=t } }
          END { for (b in first) {
            if (b in prov) printf "    %s %s provisioned; warm -> %s at %s\n", prov[b], b, last[b], lt[b]
            else printf "    %s %s first warm -> %s; after %s attempts -> %s\n", ft[b], b, first[b], att[b], last[b] } }' | sort ;;
    *)  sed -n '2,$p' $f | command grep -vE '^\+|^\|' | strip | short | command grep -v 'warm attempt' | sed 's/^/    /' ;;
  esac
  pl=$(awk '/lease_id/{p=1;next} p&&/^\| broker/{print $2}' $f | paste -sd, -)
  row=$(command grep -E '^\| +1 \| (READY|PROVISIONING)|^\| rs-1' $f | tail -1 | tr -s ' ')
  echo "    ${D}SQL: provision log = [$pl]; row = $row${X}"
  echo
done
