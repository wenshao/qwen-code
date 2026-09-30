#!/bin/bash
# delete the temporary bucket and prove it is gone; bucket name is redacted in the output
cd "$(dirname "$0")"; B=$(cat bucket.txt); [ -n "$B" ] || { echo "no bucket name"; exit 2; }
J=("$HOME/Install/jdk21/bin/java" -Dhttps.proxyHost= -Dhttp.proxyHost= -DsocksProxyHost= -cp "out:lib/*")
red() { sed "s/$B/qwen-pr13037-verify-<redacted>/g"; }
"${J[@]}" RealOss cleanup "$B" 2>&1 | grep -v "commons-logging\|SLF4J" | red
echo "info after cleanup: $("${J[@]}" RealOss info "$B" 2>&1 | grep -o "NoSuchBucket\|objects=[0-9]*" | head -1)"
LIST=$("${J[@]}" ListBuckets 2>&1); RC=$?
echo "bucket listing exit=$RC, still matching qwen-pr13037: $(echo "$LIST" | grep -c 'qwen-pr13037')"
