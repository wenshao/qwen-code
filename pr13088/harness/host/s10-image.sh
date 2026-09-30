#!/bin/bash
# macOS host: the Dockerfile's runtime base image (eclipse-temurin:21-jre, USER 10001) with the PR head fat jar.
IMG=docker.m.daocloud.io/library/eclipse-temurin:21-jre
DK=/rig/dk.sh
J='-cp /app/qwen-managed-agent-server.jar -Dloader.main=com.alibaba.qwen.code.managedagent.store.WorkspaceStorageRegistrationMain org.springframework.boot.loader.launch.PropertiesLauncher'
ENVS=(-e "W1_JDBC_URL=jdbc:mysql://127.0.0.1:3306/w1n_s10?allowPublicKeyRetrieval=true&useSSL=false" -e W1_JDBC_USER=root -e W1_JDBC_PASSWORD=rootpw)
$DK run --rm $IMG sh -c '. /etc/os-release; echo "image: $PRETTY_NAME; /etc/machine-id: $(ls -la /etc/machine-id 2>&1 | cut -c1-60) content=[$(cat /etc/machine-id 2>/dev/null)]; mvn: $(command -v mvn || echo absent)"'
echo "--- no machine-id mount (the image as built by the Dockerfile):"
$DK run --rm --network host -u 10001 -v /opt/w1a/head-server.jar:/app/qwen-managed-agent-server.jar:ro -v /srv/w1a:/srv/w1a "${ENVS[@]}" $IMG sh -c "echo \"inspect d (registered on the host): \$(java $J inspect t-w1a st-d /srv/w1a/d 2>&1 | tail -1)\"; java $J register t-w1a st-c /srv/w1a/c \$(cat /proc/sys/kernel/random/uuid) --offline-confirmed > /tmp/o 2>&1; echo \"register c: exit=\$? \$(grep -E 'verified|RuntimeBrokerException' /tmp/o | head -1 | cut -c1-160)\""
echo "--- with -v /etc/machine-id:/etc/machine-id:ro:"
$DK run --rm --network host -u 10001 -v /opt/w1a/head-server.jar:/app/qwen-managed-agent-server.jar:ro -v /srv/w1a:/srv/w1a -v /etc/machine-id:/etc/machine-id:ro "${ENVS[@]}" $IMG sh -c "echo \"inspect d: \$(java $J inspect t-w1a st-d /srv/w1a/d 2>&1 | tail -1)\"; stat -c 'root d seen in the container: dev=%d ino=%i' /srv/w1a/d; java $J register t-w1a st-c /srv/w1a/c \$(cat /proc/sys/kernel/random/uuid) --offline-confirmed > /tmp/o 2>&1; echo \"register c as uid 10001: exit=\$? \$(grep -E 'verified|RuntimeBrokerException' /tmp/o | head -1 | cut -c1-160)\"; ls -ld /srv/w1a/c | cut -c1-60"
colima ssh -p pr12869 -- stat -c 'root d seen on the host:          dev=%d ino=%i' /srv/w1a/d
