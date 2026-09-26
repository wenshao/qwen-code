#!/bin/zsh
# mutrun <serial> <mutant|none> [instrument args...]: reset tree, apply mutant, build, reinstall, run accessibility class
S=$RIG
source $S/env.sh
s=$1; m=$2; shift 2
cd $S/mut
git checkout -q HEAD -- packages/mobile-shell/app/src/main
[ "$m" != none ] && python3 $S/rig/mutate2.py $m $S/mut
git diff --stat | tail -1
(cd packages/mobile-shell && ./gradlew --no-daemon -q :app:assembleDebug :app:assembleDebugAndroidTest > $S/emu/mutbuild-$m.log 2>&1) || { echo "BUILD FAILED $m"; tail -20 $S/emu/mutbuild-$m.log; exit 1; }
git diff > $S/emu/mut-$m.diff
$S/emu/inst.sh $s $S/mut/packages/mobile-shell >/dev/null
$S/emu/a $s shell am instrument -w -r "$@" -e class com.qwen.mobileshell.ProfileAccessibilityDeviceTest com.qwen.mobileshell.test/androidx.test.runner.AndroidJUnitRunner > $S/emu/mutrun-$m.txt 2>&1
echo "=== $m"; python3 $S/emu/parse.py $S/emu/mutrun-$m.txt | sed 's/^/  /'
git checkout -q HEAD -- packages/mobile-shell/app/src/main
