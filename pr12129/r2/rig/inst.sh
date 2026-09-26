#!/bin/zsh
# inst <serial> <apkdir-root>: reinstall app + test apk (keeps nothing: uninstall first)
A=$RIG/emu/a
s=$1; root=$2
$A $s uninstall com.qwen.mobileshell >/dev/null 2>&1
$A $s uninstall com.qwen.mobileshell.test >/dev/null 2>&1
$A $s install -t $root/app/build/outputs/apk/debug/app-debug.apk | tail -1
$A $s install -t $root/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk | tail -1
