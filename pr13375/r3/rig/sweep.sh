#!/bin/bash
# usage: sweep.sh <from> <to> — list non-test source files whose added lines touch message bodies or resource walkers
cd /Users/wenshao/git/qwen-code-x3
PAT="resources\.read|\.read\(ref|contentRef|message\.committed|'managed-message|\"managed-message|nestedResourceRefs|enqueueRefs|collectRefs|RESOURCE_KINDS|managedMessage|readRecordBody|readManagedMessageBody|recordRef|resultRef"
for f in $(git diff --name-only "$1" "$2" -- 'packages/*.ts' 'packages/*.tsx' 'packages/*.java' | grep -v "\.test\.\|test-helper\|/test/\|Test\.java\|IT\.java\|\.d\.ts"); do
  c=$(git diff "$1" "$2" -- "$f" | grep '^+' | grep -v '^+++' | grep -cE "$PAT")
  [ "$c" != 0 ] && echo "$c $f"
done
