#!/bin/bash
# suite.sh <arm> <m2> <db-tag> <jdbc-host:port> [extra mvn args...]
# Full managed-agent-server `clean verify checkstyle:check` with the MySQL IT,
# as the CI MariaDB lane runs it, against the given database server.
set -uo pipefail
ARM=$1; export M2=$2; DB=$3; HP=$4; shift 4
cd /Users/wenshao/git/pr13347-$ARM/packages/sdk-java/managed-agent-server
echo "== $ARM @ $(git rev-parse --short HEAD) db=$DB on $HP start $(date -u +%T)"
/Users/wenshao/git/pr13347-rig/mvn.sh -B --no-transfer-progress -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://$HP/managed_agent_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=runtime-broker "$@" clean verify checkstyle:check
rc=$?
echo "== $ARM rc=$rc end $(date -u +%T)"
exit $rc
