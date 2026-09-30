#!/bin/bash
# inside VM: what happens to a database already migrated by this PR (V19 -> V21, V20 unused) when a later build
# also carries another open PR's migrations. Uses the PR head jar plus -Dloader.path=<dir with db/migration/...>.
set -u
cd /rig/vm
sudo cp run-server.sh /opt/w1a/run-server.sh
grep -q LOADER_EXTRA /etc/qwen-w1a.env || echo "LOADER_EXTRA=" | sudo tee -a /etc/qwen-w1a.env > /dev/null
bash reset.sh w1n_flyway VERIFIED=false JAR=head-server.jar DIST=dist-head DURABLE=true HARNESS=false > /dev/null
bash svc.sh LOADER_EXTRA= start | cut -c1-60; bash svc.sh stop
hist() { docker exec w0e3-db mysql -uroot -prootpw -N -B w1n_flyway -e "SELECT GROUP_CONCAT(CONCAT('V',version) ORDER BY installed_rank SEPARATOR ' ') FROM flyway_schema_history WHERE installed_rank > 18" 2>/dev/null; }
echo "database migrated by the PR head: ... $(hist)"
for probe in v20only v21dup; do
  : > /var/log/qwen-w1a/server.log
  out=$(bash svc.sh LOADER_EXTRA=/rig/flyway-probe/$probe start 2>&1 | head -1 | cut -c1-80)
  echo "--- $probe ($(ls /rig/flyway-probe/$probe/db/migration/)): $out"
  grep -a -E "FlywayValidateException|Found more than one migration|Detected resolved migration not applied|Validate failed|Migrating schema|Successfully applied|Started ManagedAgentServerApplication" /var/log/qwen-w1a/server.log | sed -E 's/^.*(FlywayValidateException|Found more|Detected resolved|Validate failed|Migrating schema|Successfully applied|Started Managed)/\1/' | sort -u | head -4 | cut -c1-260
  bash svc.sh stop
  echo "    history now: ... $(hist)"
done
bash svc.sh LOADER_EXTRA= > /dev/null
