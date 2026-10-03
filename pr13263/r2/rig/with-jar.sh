#!/bin/bash
# usage: with-jar.sh <jar> <command...>; always restores the good jar and verifies it.
R=/Users/wenshao/git/pr13263-rig
T=/Users/wenshao/git/pr13263-head/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
GOOD=b1538c1187d518bea6479918492c0044069e2ce879b150650fe2086931d258e5
jar="$1"; shift
cp "$jar" "$T"
"$@"
cp "$R/jars/good/qwen-managed-agent-server-0.1.0-alpha.jar" "$T"
[ "$(shasum -a 256 "$T" | cut -c1-64)" = "$GOOD" ] || { echo "GOOD JAR RESTORE FAILED"; exit 9; }
