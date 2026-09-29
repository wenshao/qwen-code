#!/bin/bash
# inside VM: point the service back at the S4 database (no reset) and watch ws-c for 2 minutes under the trusted scan.
set -u
sudo sed -i "s/^DB=.*/DB=op12977_s4/; s/^TRUSTED=.*/TRUSTED=true/; s/^JAR=.*/JAR=pr12977-server.jar/" /etc/qwen-w0e3.env
sudo systemctl restart qwen-w0e3.service
for i in $(seq 1 90); do [ "$(curl -s --noproxy '*' -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/actuator/health)" = 200 ] && break; sleep 1; done
echo "$(date -u +%T) service up on op12977_s4 trusted=true; boot $(cat /proc/sys/kernel/random/boot_id)"
Q() { docker exec w0e3-db mysql -uroot -prootpw -N -B op12977_s4 -e "$1" 2>/dev/null; }
for t in 0 30 60 90 120; do
  [ $t -gt 0 ] && sleep 30
  echo "$(date -u +%T) t+${t}s ws-c: $(Q "SELECT binding_state, record_version FROM qwen_runtime_binding WHERE storage_id='st-c' ORDER BY runtime_generation DESC LIMIT 1" | tr '\t' ' ') holder=$(Q "SELECT IFNULL(LEFT(holder_key,12),'<none>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-c'),256)") audit_completed=$(Q "SELECT IF(completed_at IS NULL,'no','yes') FROM managed_workspace_operator_recovery")"
done
