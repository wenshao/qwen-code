#!/bin/bash
# PR tests + real-worker E2E on JDK 21 (temurin), host node/ss, host pid+net namespaces
docker run --rm --pid host --network host \
  -v /:/host -v /root/.m2:/root/.m2 -v /root/Install/maven:/opt/maven:ro \
  -v /usr/bin/node:/usr/local/bin/node:ro \
  -v /root/verify:/root/verify -w /root/verify/pr12552-harness eclipse-temurin:21-jdk bash -c '
printf "#!/bin/sh\nexec chroot /host ss \"\$@\"\n" > /usr/local/bin/ss; chmod +x /usr/local/bin/ss
java -version 2>&1 | head -1; node -v
cp -r /root/verify/pr12552/packages/sdk-java/runtime-broker /tmp/rb && cd /tmp/rb && rm -rf target
/opt/maven/bin/mvn -q -o test 2>&1 | grep -E "ERROR|FAIL" | head
for f in target/surefire-reports/*.txt; do sed -n 4p $f; done | awk "{r+=\$3;f+=\$5;e+=\$7;s+=\$9} END {print \"JDK21 module tests run\",r,\"fail\",f,\"err\",e,\"skip\",s}"
grep -h "Tests run" target/surefire-reports/*LocalProcess*.txt
cd /root/verify/pr12552-harness
sed "s|H=/root/verify/pr12552-harness|H=/root/verify/pr12552-harness; OUTDIR=/tmp/out21|; s|\$H/out|/tmp/out21|g" run.sh > /tmp/run21.sh
bash /tmp/run21.sh /tmp/rb 2>&1 | grep -v ^WARNING
'
