#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c190ac33-9385-406c-a1c1-f75775d345f5/scratchpad
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
cd ~/git/qwen-code-pr12733
MUT_TAG=r3asis python3 $SP/mut/run2.py ~/git/qwen-code-pr12733 mutants_r2.py > $SP/mut/r3-asis-summary.txt 2>&1
git apply $SP/cand2/candidate-r2.patch && MUT_TAG=r3cand python3 $SP/mut/run2.py ~/git/qwen-code-pr12733 mutants_r2.py > $SP/mut/r3-cand-summary.txt 2>&1
git checkout -- integration-tests/cli/hosted-harness-process.test.ts scripts/tests/hosted-process-ci.test.js
$SP/mvn-install.sh $SP > $SP/mvn-install-r3.log 2>&1; echo "mvn install exit $?" > $SP/r3-java.txt
~/Install/mysql-8.4.7-macos15-arm64/bin/mysql -h127.0.0.1 -P33733 -uroot -e "DROP DATABASE IF EXISTS hosted_harness_test; CREATE DATABASE hosted_harness_test;"
$SP/java-it.sh r3-pristine >> $SP/r3-java.txt
~/Install/mysql-8.4.7-macos15-arm64/bin/mysql -h127.0.0.1 -P33733 -uroot hosted_harness_test -e "SELECT state, writer_generation FROM qwen_managed_session_journal_head;" >> $SP/r3-java.txt
sed -e "s#'r2mut-'#'r3mut-'#" $SP/mut/java-mut-r2.py > $SP/mut/java-mut-r3.py
python3 $SP/mut/java-mut-r3.py >> $SP/r3-java.txt 2>&1
git status --short > $SP/r3-final-status.txt
shasum -a 256 integration-tests/cli/hosted-harness-process.test.ts >> $SP/r3-final-status.txt
find dist -type f | LC_ALL=C sort | xargs shasum -a 256 | diff -q - $SP/dist-manifest-r3.txt >> $SP/r3-final-status.txt && echo "dist identical to r3 manifest" >> $SP/r3-final-status.txt
echo ALL_DONE >> $SP/r3-final-status.txt
