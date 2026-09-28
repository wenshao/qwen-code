#!/bin/bash
# Final evidence pass: every scenario with the JVM on UTC, as CI runs it.
cd "$(dirname "$0")"
export JVM_OPTS="-Duser.timezone=UTC"
mkdir -p final
run() { local name=$1; shift; echo "=== $name $(date -u +%H:%M:%S)"; node "$@" > final/$name.txt 2>&1; echo "rc=$? $(tail -1 final/$name.txt | cut -c1-160)"; }
run s0-base-mysql s0-base.mjs base mysql
run s1-pr-mysql s1-plan.mjs pr mysql
run s1-pr-mariadb s1-plan.mjs pr mariadb
run s5-upgrade-mysql s5-upgrade.mjs mysql
run s5-upgrade-mariadb s5-upgrade.mjs mariadb
run s2-race-mysql s2-race.mjs mysql 30
run s3-takeover-mysql s3-takeover.mjs mysql
run s4-multiserver-mysql s4-multiserver.mjs mysql 8
run s6-latch-mysql s6-latch.mjs mysql 180
run s6-latch-mariadb s6-latch.mjs mariadb 120
run s7-extra-mariadb s7-extra.mjs mariadb
run s7b-sse-mysql s7b-sse.mjs pr mysql
echo ALL_DONE
