# source with ARM=obs|adm
ARM="${ARM:-obs}"
export R=<scratch>/r3/rig
export WTROOT=/root/verify/pr12250-r3
case "$ARM" in
  obs) export DIST=$WTROOT/dist-obs PORT=4790 MOCK_PORT=18790 ;;
  adm) export DIST=$WTROOT/dist-adm PORT=4791 MOCK_PORT=18791 ;;
  *) echo "bad ARM $ARM"; return 1 ;;
esac
export ARM TOKEN=T0KEN12250R3
export WS=/var/tmp/qwen12250r3/ws-$ARM
export HOME_Q=$R/home-$ARM RT=$R/runtime-$ARM
export BASE_URL="http://127.0.0.1:$PORT"
