#!/bin/zsh
# usage: drive.sh <api> <mutant ids...>
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a1a1a51e-3447-4aef-8643-67c41b38950d/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk17 ANDROID_HOME=$HOME/Library/Android/sdk ANDROID_SDK_ROOT=$HOME/Library/Android/sdk DEVELOPER_DIR=/Library/Developer/CommandLineTools
API=$1; shift
mkdir -p $SP/mut/out
for id in "$@"; do
  info=$(python3 $SP/mut/mutants.py $id) || { echo "$id APPLY-FAIL"; continue; }
  ( cd $SP/mut/ms && ./gradlew -q assembleDebug assembleDebugAndroidTest > $SP/mut/out/$id.build.log 2>&1 )
  if [ $? -ne 0 ]; then echo "$id BUILD-FAIL $info"; continue; fi
  A=$SP/mut/ms/app/build/outputs/apk
  dexsha=$(unzip -p $A/debug/app-debug.apk 'classes*.dex' | shasum -a 256 | cut -c1-12)
  $SP/bin/runsuite.sh $API $A/debug/app-debug.apk $A/androidTest/debug/app-debug-androidTest.apk $SP/mut/out/$id.raw.txt > $SP/mut/out/$id.res.txt 2>&1
  fails=$(grep -cE '^(FAIL|ERROR) ' $SP/mut/out/$id.res.txt)
  newf=$(grep -E '^(FAIL|ERROR) FilePickerDeviceTest#' $SP/mut/out/$id.res.txt | sed 's/.*#//' | tr '\n' ',' )
  oldf=$(grep -E '^(FAIL|ERROR) FilePickerDeviceTestOld#' $SP/mut/out/$id.res.txt | sed 's/.*#//' | tr '\n' ',' )
  othf=$(grep -E '^(FAIL|ERROR) Profile' $SP/mut/out/$id.res.txt | sed 's/^[A-Z]* //' | tr '\n' ',' )
  summ=$(grep SUMMARY $SP/mut/out/$id.res.txt)
  crash=$(grep -m1 -E 'INSTRUMENTATION_RESULT: shortMsg|Process crashed' $SP/mut/out/$id.raw.txt | tr -d '\r')
  echo "$id dex=$dexsha fails=$fails NEW[$newf] OLD[$oldf] OTHER[$othf] $summ $crash"
done
python3 $SP/mut/mutants.py M00 >/dev/null
echo DRIVE-DONE
