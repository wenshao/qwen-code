#!/bin/bash
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH="$JAVA_HOME/bin:$PATH"
exec /Users/wenshao/Install/maven/bin/mvn -s /Users/wenshao/git/pr13263-rig/empty-settings.xml -Dmaven.repo.local=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad/m2 "$@"
