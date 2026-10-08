#!/bin/bash
# GreenMail 2.1.14 on loopback: SMTP 35725 (plain, test injection), SMTPS 35726, IMAPS 35727, IMAP 35729.
R=/Users/wenshao/git/pr13572-rig/mail
case "$1" in
start)
  /Users/wenshao/Install/jdk21/bin/java \
    -Dgreenmail.smtp.hostname=127.0.0.1 -Dgreenmail.smtp.port=35725 \
    -Dgreenmail.smtps.hostname=127.0.0.1 -Dgreenmail.smtps.port=35726 \
    -Dgreenmail.imaps.hostname=127.0.0.1 -Dgreenmail.imaps.port=35727 \
    -Dgreenmail.imap.hostname=127.0.0.1 -Dgreenmail.imap.port=35729 \
    -Dgreenmail.users=agent:agentpw@rig.test,alice:alicepw@rig.test,bob:bobpw@rig.test,mallory:mallorypw@rig.test \
    -Dgreenmail.tls.keystore.file=$R/tls/greenmail.p12 -Dgreenmail.tls.keystore.password=rigpass -Dgreenmail.tls.key.password=rigpass \
    -Dgreenmail.api.hostname=127.0.0.1 -Dgreenmail.api.port=35732 -Dgreenmail.verbose -jar $R/greenmail-standalone-2.1.14.jar > $R/greenmail.log 2>&1 &
  echo $! > $R/greenmail.pid; echo "greenmail pid $(cat $R/greenmail.pid)";;
stop) kill "$(cat $R/greenmail.pid)";;
esac
