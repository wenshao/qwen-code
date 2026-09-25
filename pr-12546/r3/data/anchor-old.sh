for k in '**UserPromptSubmit Context:**' '**Denied Tool Calls:**' '**Respect Tool Decisions:**' \
         '**Security First:**' '**Explain Critical Commands:**' '**Report outcomes faithfully:**' \
         'Carefully consider the reversibility' '- Destructive operations:'; do
  grep -qF "$k" /tmp/prompt-eager.md || echo "缺失：$k"
done
