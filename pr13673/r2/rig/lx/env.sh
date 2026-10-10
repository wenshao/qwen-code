# VERIFICATION RIG ONLY (PR #13673): Linux container side; same absolute rig path is mounted in the container.
RIG=/Users/wenshao/pr13673-rig
NODE=$RIG/lx/node/bin/node
JAVA=/opt/java/openjdk/bin/java
DBHOST=${DBHOST:-pr13673-db}; DBPORT=3306; DBPASS=$(cat $RIG/lx/.dbpass)
SPRING_PORT=18673; BROKER_PORT=14673; HARNESS_PORT=17673; TAP_PORT=16673; MODEL_PORT=15673; STORE_TAP_PORT=16674; BROKER_TAP_PORT=16675
TENANT=t-rig
HTOKEN=rig-13673-harness-token
BTOKEN=rig-13673-broker-token
DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
CREDKEY=jrHJIqrQW6ny5oGksoCujH38Y7F9c7X9sDmNGd/WQz8=
CGROOT=/sys/fs/cgroup/rig-hooks
VAR=/var/rig
DISTROOT=/var/rig/dist
