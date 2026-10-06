#!/bin/bash
# inside VM: svc.sh [KEY=VALUE ...] start|stop|restart|status   (edits /opt/pr13260/rig.env, waits for health)
set -u
ACTION=""
for a in "$@"; do
  case "$a" in
    *=*) k=${a%%=*}; v=${a#*=}; sed -i "s|^$k=.*|$k=$v|" /opt/pr13260/rig.env ;;
    *) ACTION=$a ;;
  esac
done
health() { curl -s --noproxy '*' -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18288/actuator/health 2>/dev/null; }
stop() { systemctl stop pr13260-spring.service 2>/dev/null || true; systemctl reset-failed pr13260-spring.service 2>/dev/null || true; }
start() {
  systemctl start pr13260-spring.service
  for i in $(seq 1 120); do
    [ "$(health)" = 200 ] && break
    [ "$(systemctl is-active pr13260-spring.service)" = active ] || { echo "SERVICE-NOT-ACTIVE: $(systemctl is-active pr13260-spring.service)"; tail -5 /var/lib/pr13260/log/server.log | cut -c1-400; return 1; }
    sleep 1
  done
  echo "health=$(health) $(grep -a '^=== ' /var/lib/pr13260/log/server.log | tail -1)"
}
case "$ACTION" in
  stop) stop ;;
  start) start ;;
  restart) stop; start ;;
  status) echo "active=$(systemctl is-active pr13260-spring.service) health=$(health)"; cat /opt/pr13260/rig.env ;;
  "") cat /opt/pr13260/rig.env ;;
esac
