# source with ARM=obs|m17|ur|m17ur
ARM="${ARM:-obs}"
export R=<scratch>/r4/rig
export WTROOT=/Users/wenshao/git/qwen-12250-r4
case "$ARM" in
  obs|m17|ur|m17ur) export DIST=$WTROOT/dist-$ARM ;;
  *) echo "bad ARM $ARM"; return 1 ;;
esac
export PORT=4804 MOCK_PORT=18804
export ARM TOKEN=T0KEN12250R4
export WS=/var/tmp/qwen12250r4/ws-$ARM
export HOME_Q=$R/home-$ARM RT=$R/runtime-$ARM
export BASE_URL="http://127.0.0.1:$PORT"
