# source with ARM=head|obs|mut|obs-ur|mut-ur
ARM="${ARM:-head}"
export R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b6cd3c7d-d976-4528-aff7-a1b693841583/scratchpad/r2/rig
export WTROOT=/Users/wenshao/git/qwen-12250-r2
case "$ARM" in
  head)   export DIST=$WTROOT/dist        PORT=4760 MOCK_PORT=18760 ;;
  obs)    export DIST=$WTROOT/dist-obs    PORT=4761 MOCK_PORT=18761 ;;
  mut)    export DIST=$WTROOT/dist-mut    PORT=4762 MOCK_PORT=18762 ;;
  obs-ur) export DIST=$WTROOT/dist-obs-ur PORT=4763 MOCK_PORT=18763 ;;
  mut-ur) export DIST=$WTROOT/dist-mut-ur PORT=4764 MOCK_PORT=18764 ;;
  *) echo "bad ARM $ARM"; return 1 ;;
esac
export ARM TOKEN=T0KEN12250R2
export WS=/var/tmp/qwen12250r2/ws-$ARM
export HOME_Q=$R/home-$ARM RT=$R/runtime-$ARM
export BASE_URL="http://127.0.0.1:$PORT"
