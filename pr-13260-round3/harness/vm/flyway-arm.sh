#!/bin/bash
# inside VM: start a server jar on a fresh DB, report health and the Flyway outcome.  usage: flyway-arm.sh <db> <jar>
set -u
DB=$1; JAR=$2
bash /root/verify/pr13260/rig/vm/reset.sh $DB JAR=$JAR DIST=dist-head > /dev/null 2>&1
systemctl start pr13260-spring.service
for i in $(seq 1 60); do
  h=$(curl -s --noproxy '*' -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18288/actuator/health)
  [ "$h" = 200 ] && break
  [ "$(systemctl is-active pr13260-spring.service)" = active ] || break
  sleep 1
done
echo "[$JAR on fresh $DB] health=$h service=$(systemctl is-active pr13260-spring.service)"
grep -aoE "Found more than one migration with version [0-9]+|Offending migrations:.*|Migrating schema .* to version \"[0-9]+ - [a-z_]+\"|Successfully applied [0-9]+ migrations[^\"]*" /var/lib/pr13260/log/server.log | sort | uniq -c | tail -6
grep -aA3 "Found more than one migration" /var/lib/pr13260/log/server.log | head -4 | cut -c1-300
docker exec pr13260-mysql mysql -uroot -prootpw -N -e "SELECT COUNT(*), IFNULL(MAX(CAST(version AS UNSIGNED)),'-') FROM $DB.flyway_schema_history WHERE success=1" 2>&1 | tail -1
bash /root/verify/pr13260/rig/vm/svc.sh stop
