# source with ARM=pr|base
ARM="${ARM:-pr}"
export H=/root/git/h11636
if [ "$ARM" = base ]; then
  export WT=/root/git/b11636 PORT=4637 MOCK_PORT=18637
else
  export WT=/root/git/pr11636 PORT=4636 MOCK_PORT=18636
fi
export ARM
export TOKEN=T0KEN11636
export WS=$H/ws-$ARM
export HOME_Q=$H/home-$ARM
export RT=$H/runtime-$ARM
export BASE_URL="http://127.0.0.1:$PORT"
