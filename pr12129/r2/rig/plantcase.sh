#!/bin/zsh
S=$RIG
A=$S/emu/a; s=$1; kind=$2
$S/emu/inst.sh $s $S/prp/packages/mobile-shell >/dev/null
$S/emu/probe.sh $s plant -e kind $kind | grep PLANTED >/dev/null
snap() { $A $s shell "run-as com.qwen.mobileshell sh -c 'cd /data/data/com.qwen.mobileshell; for f in no_backup/* shared_prefs/qwen_profiles.xml; do [ -f \$f ] && echo \$f \$(md5sum < \$f | cut -c1-12); done'" | tr -d '\r' | sort | tr '\n' ' '; }
before=$(snap)
$A $s shell am instrument -w -r -e requireProfileIsolation true -e class com.qwen.mobileshell.ProfileAccessibilityDeviceTest com.qwen.mobileshell.test/androidx.test.runner.AndroidJUnitRunner > $S/emu/plant-$kind.txt 2>&1
after=$(snap)
res=$(python3 $S/emu/parse.py $S/emu/plant-$kind.txt | grep SUMMARY)
reason=$(grep -o "AssumptionViolatedException: [^:]*" $S/emu/plant-$kind.txt | sort -u | head -2 | tr '\n' ';')
[ "$before" = "$after" ] && same=UNCHANGED || same=CHANGED
echo "[$kind] $res | $reason | files $same | before: $before | after: $after"
[ $kind = real ] && $S/emu/probe.sh $s dumpVault | grep VAULT
