# source with ARM=head|mut
ARM="${ARM:-head}"
export R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/18c1820a-1613-4390-bf90-2a36b9a07089/scratchpad/rig
export WTROOT=/Users/wenshao/git/qwen-12250-head
if [ "$ARM" = mut ]; then
  export DIST=$WTROOT/dist-mut PORT=4751 MOCK_PORT=18751
elif [ "$ARM" = obs ]; then
  export DIST=$WTROOT/dist-obs PORT=4752 MOCK_PORT=18752
else
  export DIST=$WTROOT/dist PORT=4750 MOCK_PORT=18750
fi
export ARM TOKEN=T0KEN12250V
export WS=/var/tmp/qwen12250/ws-$ARM
export HOME_Q=$R/home-$ARM RT=$R/runtime-$ARM
export BASE_URL="http://127.0.0.1:$PORT"
