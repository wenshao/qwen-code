# source with ARM=head|pre
ARM="${ARM:-head}"
export H=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/63de0ea4-4d44-4577-a263-66b150608516/scratchpad/h
if [ "$ARM" = pre ]; then
  export WT=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/63de0ea4-4d44-4577-a263-66b150608516/scratchpad/wtPRE PORT=4647 MOCK_PORT=18647
else
  export WT=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/63de0ea4-4d44-4577-a263-66b150608516/scratchpad/wtHEAD PORT=4646 MOCK_PORT=18646
fi
export ARM
export TOKEN=T0KEN11636B
export WS=$H/ws-$ARM
export HOME_Q=$H/home-$ARM
export RT=$H/runtime-$ARM
export BASE_URL="http://127.0.0.1:$PORT"
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
