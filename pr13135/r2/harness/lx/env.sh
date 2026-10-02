# VERIFICATION RIG ONLY (PR #13135): Linux container side. Same absolute rig path is mounted in the container.
RIG=/Users/wenshao/pr13135-rig
NODE=$RIG/lx/node/bin/node
JAVA=/opt/java/openjdk/bin/java
DBHOST=192.168.5.2; DBPORT=33135; DBPASS=rig13135
SPRING_PORT=18136; BROKER_PORT=14136; HARNESS_PORT=17136; TAP_PORT=16136; MODEL_PORT=15136
TENANT=t-rig
HTOKEN=rig-13135-harness-token
BTOKEN=rig-13135-broker-token
DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
CREDKEY=<rig-throwaway-key>
VAR=/var/rig
