#!/bin/bash
# Image run scenarios against qmas:<tag>. No port is published to the Mac:
# -p binds the VM's docker0 address (172.17.0.1), which lima does not forward.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8d1d0002-cbf9-486b-a3c9-1d082c3ea9f3/scratchpad
TAG=${1:-head}
IMG=qmas:$TAG
dc() { docker --context colima-pr13344 "$@"; }
vm() { colima ssh -p pr13344 -- env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY "$@"; }
peer() { dc run --rm --network pr13344net --entrypoint curl mysql:8.4.6 "$@"; }
bridgepeer() { dc run --rm --network bridge --entrypoint curl mysql:8.4.6 "$@"; }
export SPRING_DATASOURCE_PASSWORD="$(cat $S/docker/dbpass)"
export QWEN_MANAGED_AGENT_AUTH_SIGNING_KEY="$(cat $S/docker/signkey)"
DBURL='jdbc:mysql://p13344-mysql:3306/qwen_managed_agent'
wait_boot() { # name -> prints STARTED or EXITED(code)
  for i in $(seq 1 90); do
    st=$(dc inspect -f '{{.State.Status}} {{.State.ExitCode}}' $1 2>/dev/null)
    case "$st" in exited*) echo "EXITED(${st#exited })"; return;; esac
    dc logs $1 2>&1 | grep -q 'Started ManagedAgentServerApplication' && { echo STARTED; return; }
    sleep 2
  done; echo TIMEOUT
}
listen() { # LISTEN sockets on :8080 from tcp and tcp6 (Java binds v6 sockets)
  dc exec $1 sh -c 'cat /proc/net/tcp /proc/net/tcp6' | awk '$4=="0A" {print $2}' | while read a; do
    port=$((16#${a##*:})); [ "$port" = 8080 ] || continue; ip=${a%%:*}
    case "$ip" in 0100007F|00000000000000000000000001000000) echo "loopback:$port";; 00000000|00000000000000000000000000000000) echo "any(0.0.0.0/::):$port";; 0000000000000000FFFF00000100007F) echo "loopback(v4-mapped):$port";; *) echo "$ip:$port";; esac
  done | sort -u | tr '\n' ' '; }
probe() { # label cmd...
  out=$("${@:2}" 2>&1); rc=$?; echo "  $1 -> rc=$rc $(echo "$out" | tr '\n' ' ' | cut -c1-200)"; }
for c in r1-plain r2-recipe r3-auto-wide r4-insecure; do dc rm -f $c >/dev/null 2>&1; done
echo "### image $IMG ($(dc image inspect -f '{{.Id}}' $IMG | cut -c1-19))"

echo "## R1 plain run: only the datasource named (README: -p publishes nothing)"
dc run -d --name r1-plain --network pr13344net -p 172.17.0.1:18081:8080 \
  -e SPRING_DATASOURCE_URL="$DBURL" -e SPRING_DATASOURCE_USERNAME=qwen -e SPRING_DATASOURCE_PASSWORD $IMG >/dev/null
echo "  boot: $(wait_boot r1-plain)"
echo "  container listeners: $(listen r1-plain)"
probe "in-container loopback GET /actuator/health" dc exec r1-plain curl -sS -m 5 http://127.0.0.1:8080/actuator/health
probe "via -p (VM -> 172.17.0.1:18081)" vm curl -sS -m 5 http://172.17.0.1:18081/actuator/health
probe "other container on default bridge -> 172.17.0.1:18081 (-p DNAT)" bridgepeer -sS -m 5 http://172.17.0.1:18081/actuator/health
probe "peer container -> r1-plain:8080" peer -sS -m 5 http://r1-plain:8080/actuator/health

echo "## R2 README recipe, fence extracted verbatim (only -p host IP, <db-host>, <image> substituted)"
fence=$(awk '/^```bash$/{f=1;b="";next} /^```$/{if(f&&b~/QWEN_MANAGED_AGENT_AUTH_MODE=signed/){print b; exit} f=0;next} f{b=b $0 "\n"}' $S/wt-head/packages/sdk-java/managed-agent-server/README.md)
echo "$fence" | sed 's/^/  | /'
cmd=$(echo "$fence" | sed -e 's#^docker run -p 8080:8080#docker --context colima-pr13344 run -d --name r2-recipe --network pr13344net -p 172.17.0.1:18082:8080#' -e 's#<db-host>#p13344-mysql#' -e "s#<image>#$IMG#")
bash -c "$cmd" >/dev/null
echo "  boot: $(wait_boot r2-recipe)"
echo "  container listeners: $(listen r2-recipe)"
probe "via -p GET /actuator/health" vm curl -sS -m 5 http://172.17.0.1:18082/actuator/health
probe "other container on default bridge -> 172.17.0.1:18082 (-p DNAT)" bridgepeer -sS -m 5 http://172.17.0.1:18082/actuator/health
probe "via -p unsigned GET /v1/agents/workspaces" vm curl -sS -m 5 -o /dev/null -w '%{http_code}' -H 'X-Qwen-Tenant-Id: t1' -H 'X-Qwen-Actor-Id: a1' http://172.17.0.1:18082/v1/agents/workspaces
sig=$(node $S/docker/sign.mjs GET /v1/agents/workspaces t1 a1 $S/docker/signkey)
probe "via -p signed GET /v1/agents/workspaces" vm curl -sS -m 5 -w ' http=%{http_code}' $sig http://172.17.0.1:18082/v1/agents/workspaces
badsig=$(node $S/docker/sign.mjs GET /v1/agents/workspaces t2 a1 $S/docker/signkey | sed 's/X-Qwen-Tenant-Id:t2/X-Qwen-Tenant-Id:t1/')
probe "via -p signature for t2 replayed as t1" vm curl -sS -m 5 -o /dev/null -w '%{http_code}' $badsig http://172.17.0.1:18082/v1/agents/workspaces
probe "peer container -> r2-recipe:8080 (no -p involved)" peer -sS -m 5 http://r2-recipe:8080/actuator/health
probe "docker run argv in container config (Args)" dc inspect -f '{{json .Args}}' r2-recipe
echo "  signing key present in container Config.Env: $(dc inspect -f '{{range .Config.Env}}{{println .}}{{end}}' r2-recipe | grep -c '^QWEN_MANAGED_AGENT_AUTH_SIGNING_KEY=.\+')"

echo "## R3 wide bind under the shipped auto mode (README: server refuses)"
dc run -d --name r3-auto-wide --network pr13344net -e QWEN_MANAGED_AGENT_SERVER_ADDRESS=0.0.0.0 \
  -e SPRING_DATASOURCE_URL="$DBURL" -e SPRING_DATASOURCE_USERNAME=qwen -e SPRING_DATASOURCE_PASSWORD $IMG >/dev/null
echo "  boot: $(wait_boot r3-auto-wide)"
echo "  refusal: $(dc logs r3-auto-wide 2>&1 | grep -m1 'refuses a non-loopback' | sed 's/.*IllegalStateException: //' | cut -c1-260)"

echo "## R4 deliberately unauthenticated override"
dc run -d --name r4-insecure --network pr13344net -p 172.17.0.1:18084:8080 -e QWEN_MANAGED_AGENT_SERVER_ADDRESS=0.0.0.0 \
  -e QWEN_MANAGED_AGENT_AUTH_ALLOW_INSECURE_BIND=true \
  -e SPRING_DATASOURCE_URL="$DBURL" -e SPRING_DATASOURCE_USERNAME=qwen -e SPRING_DATASOURCE_PASSWORD $IMG >/dev/null
echo "  boot: $(wait_boot r4-insecure)"
probe "via -p unsigned GET /v1/agents/workspaces" vm curl -sS -m 5 -w ' http=%{http_code}' -H 'X-Qwen-Tenant-Id: t1' -H 'X-Qwen-Actor-Id: a1' http://172.17.0.1:18084/v1/agents/workspaces
echo "  warn line: $(dc logs r4-insecure 2>&1 | grep -iE 'insecure|unauthenticated' | head -1 | cut -c1-220)"
echo "## Mac listeners on 1808x (must be none):"; lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':1808[0-9]' || echo "  none"
