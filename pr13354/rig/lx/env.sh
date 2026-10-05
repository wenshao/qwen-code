# VERIFICATION RIG ONLY (PR #13354): Linux container side; same absolute rig path is mounted in the container.
RIG=/Users/wenshao/pr13354-rig
NODE=$RIG/lx/node/bin/node
JAVA=/opt/java/openjdk/bin/java
DBHOST=pr13354-db; DBPORT=3306; DBPASS=<redacted>
SPRING_PORT=18154; BROKER_PORT=14154; HARNESS_PORT=17154; TAP_PORT=16154; MODEL_PORT=15154
TENANT=t-rig
HTOKEN=<redacted>
BTOKEN=<redacted>
DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
CREDKEY=<redacted>
VAR=/var/rig
