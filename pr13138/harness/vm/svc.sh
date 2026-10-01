#!/bin/bash
# inside VM: svc.sh [KEY=VALUE ...] start|stop|restart|status   (edits /etc/qwen-w1b.env, waits for health)
set -u
ACTION=""
for a in "$@"; do
  case "$a" in
    *=*) k=${a%%=*}; v=${a#*=}; sudo sed -i "s|^$k=.*|$k=$v|" /etc/qwen-w1b.env ;;
    *) ACTION=$a ;;
  esac
done
health() { curl -s --noproxy '*' -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/actuator/health 2>/dev/null; }
stop() { sudo systemctl stop qwen-w1b.service 2>/dev/null || true; sudo systemctl reset-failed qwen-w1b.service 2>/dev/null || true; }
start() {
  sudo systemctl start qwen-w1b.service
  for i in $(seq 1 120); do
    [ "$(health)" = 200 ] && break
    [ "$(systemctl is-active qwen-w1b.service)" = active ] || { echo "SERVICE-NOT-ACTIVE: $(systemctl is-active qwen-w1b.service)"; tail -5 /var/log/qwen-w1b/server.log | cut -c1-400; return 1; }
    sleep 1
  done
  echo "health=$(health) $(grep -a '^=== ' /var/log/qwen-w1b/server.log | tail -1)"
}
case "$ACTION" in
  stop) stop ;;
  start) start ;;
  restart) stop; start ;;
  status) echo "active=$(systemctl is-active qwen-w1b.service) health=$(health)"; cat /etc/qwen-w1b.env ;;
  "") cat /etc/qwen-w1b.env ;;
esac
