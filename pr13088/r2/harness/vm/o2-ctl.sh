#!/bin/bash
# inside VM: the OSS double for O2 remote Shell publication (TLS :443, admin 127.0.0.1:18994). usage: o2-ctl.sh up|down|status
set -u
PIDF=/var/lib/qwen-w1a/fake-oss.pid; DATA=/var/lib/qwen-w1a/oss-data; LOG=/var/log/qwen-w1a/fake-oss.log
case "$1" in
  up)
    [ -f $PIDF ] && kill -0 $(cat $PIDF) 2>/dev/null && { echo "fake OSS already running pid=$(cat $PIDF)"; exit 0; }
    rm -rf $DATA; mkdir -p $DATA
    OSS_DATA=$DATA nohup /opt/qwen/node /opt/w1a/o2/fake-oss.mjs > $LOG 2>&1 &
    echo $! > $PIDF
    for i in $(seq 1 50); do curl -s --noproxy '*' -m 1 http://127.0.0.1:18994/state > /dev/null 2>&1 && break; sleep 0.2; done
    echo "fake OSS pid=$(cat $PIDF): $(curl -s --noproxy '*' -m 2 http://127.0.0.1:18994/state | cut -c1-120)"
    ;;
  down) [ -f $PIDF ] && kill $(cat $PIDF) 2>/dev/null; rm -f $PIDF ;;
  status) [ -f $PIDF ] && kill -0 $(cat $PIDF) 2>/dev/null && echo "running pid=$(cat $PIDF)" || echo stopped ;;
esac
