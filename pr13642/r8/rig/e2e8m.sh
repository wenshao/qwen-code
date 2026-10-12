#!/bin/bash
# MariaDB rerun with longer settle windows (the first run's ticks took ~20 s each under host load average ~70)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export BASEJAR=$S/jars/main-r8-da224e61.jar HEADJAR=$S/jars/merge-r8-8b72c287.jar CPDIR=cp-r8 SEEDOUT=out-r8 SETTLE_WAIT=150 SETTLE_WAIT2=60
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P43642 -e "DROP DATABASE IF EXISTS e2e_r8b_maria" 2>/dev/null
$S/rig/e2e8b.sh maria e2e_r8b_maria r8b-maria > $S/r8/e2e-maria-rerun.txt 2>&1; echo "e2e maria rerun exit=$?"
