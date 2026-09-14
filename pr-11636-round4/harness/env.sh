# source with ARM=head|pre
ARM="${ARM:-head}"
export H=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h
if [ "$ARM" = pre ]; then
  export WT=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wt4pre PORT=4657 MOCK_PORT=18657
else
  export WT=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wt4 PORT=4656 MOCK_PORT=18656
fi
export ARM
export TOKEN=T0KEN11636C
export WS=$H/ws-$ARM
export HOME_Q=$H/home-$ARM
export RT=$H/runtime-$ARM
export BASE_URL="http://127.0.0.1:$PORT"
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
