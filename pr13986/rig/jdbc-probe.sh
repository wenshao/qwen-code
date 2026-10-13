#!/bin/bash
# Standalone-initializer path on real engines with their DEFAULT collation:
# (1) the embedded upgrader adds idx_tool_execution_harness to a schema the
# base classes created; (2) case-variant Harness ids through the JDBC read,
# 950d757813 (pr) vs f3eeac2865 (pr2).
set -u
cd /root/pr13986-rig
O=out/jdbc-probe; mkdir -p $O; : > $O/steps.log
log() { echo "$(date +%T) $*" | tee -a $O/steps.log; }
for arm in base pr pr2; do
  [ -d lib-$arm ] || { mkdir -p lib-$arm && (cd lib-$arm && unzip -q -j ../server/$arm.jar 'BOOT-INF/lib/*.jar'); }
done
J=./jdk21/bin/java
run() { local arm=$1; shift; $J -cp "lib-$arm/*" Probe.java "$@" 2>&1 | grep -v -E "^WARNING|SLF4J" ; }
runi() { local arm=$1; shift; $J -cp "lib-$arm/*" ProbeInit.java "$@" 2>&1 | grep -v -E "^WARNING|SLF4J" ; }
docker rm -f pr13986-my84 >/dev/null 2>&1
docker run -d --name pr13986-my84 -p 127.0.0.1:13987:3306 -e MYSQL_ROOT_PASSWORD=r13986 --memory 2g docker.m.daocloud.io/library/mysql:8.4 >/dev/null
for i in $(seq 1 90); do docker exec pr13986-my84 mysql -uroot -pr13986 -e 'SELECT 1' >/dev/null 2>&1 && break; sleep 2; done
for engine in mariadb mysql84; do
  if [ $engine = mariadb ]; then
    M() { mysql --socket=db/s.sock -uroot -pr13986 -N -B -e "$1"; }; HP=127.0.0.1:13986
  else
    M() { docker exec pr13986-my84 mysql -uroot -pr13986 -N -B -e "$1" 2>/dev/null; }; HP=127.0.0.1:13987
  fi
  log "== $engine $(M 'SELECT VERSION(), @@collation_server' | tr '\t' ' ')"
  for db in up a950 af3e; do M "DROP DATABASE IF EXISTS jp_$db; CREATE DATABASE jp_$db;"; done
  U() { echo "jdbc:mysql://$HP/jp_$1?useSSL=false&allowPublicKeyRetrieval=true"; }
  log "upgrade: base initialize -> $(runi base init "$(U up)" | tr '\n' ' ')"
  log "upgrade: pr2 initialize  -> $(runi pr2 init "$(U up)" | tr '\n' ' ')"
  log "upgrade: pr2 again       -> $(runi pr2 init "$(U up)" | tr '\n' ' ')"
  runi pr init "$(U a950)" >/dev/null; runi pr2 init "$(U af3e)" >/dev/null
  log "alias 950d757813: $(run pr alias "$(U a950)")"
  log "alias f3eeac2865: $(run pr2 alias "$(U af3e)")"
done
docker rm -f pr13986-my84 >/dev/null
log DONE
