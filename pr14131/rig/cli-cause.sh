#!/bin/bash
# Operator CLI (WorkspaceStorageRegistrationMain register) on a freshly initialized root, exactly as the
# fixtures create it (mkdir root; mkdir root/child; no mtime pin), base classes vs head classes, real MySQL.
R=/root/pr14131-rig; P=$R/probe; OUT=$P/cli-cause.txt; : > $OUT
docker exec pr14131-db mysql -uroot -phosted-fixture -e "CREATE DATABASE IF NOT EXISTS cli_probe" 2>&1 | grep -v Warning
for arm in base head; do
  rm -rf $P/tmp-cli; mkdir -p $P/tmp-cli; chmod 1777 $P/tmp-cli
  docker run --rm --network pr14131net -v $R:$R -v $P/tmp-cli:/tmp -v /etc/machine-id:/etc/machine-id:ro \
    -e W1_JDBC_URL="jdbc:mysql://pr14131-db:3306/cli_probe?allowPublicKeyRetrieval=true&useSSL=false" \
    -e W1_JDBC_USER=root -e W1_JDBC_PASSWORD=hosted-fixture qwen-managed-e2e:u24 bash -c "
      for i in \$(seq 1 50); do rm -rf /tmp/root; mkdir -p /tmp/root/child; [ \"\$(stat -c %w /tmp/root)\" = \"\$(stat -c %y /tmp/root)\" ] && break; done
      stat -c 'root birth=%w mtime=%y (attempt '\$i')' /tmp/root
      java -cp $P/$arm-classes:\$(cat $P/cp.txt) com.alibaba.qwen.code.managedagent.store.WorkspaceStorageRegistrationMain \
        register tenant-a storage-a /tmp/root 7f9c2a52-3b5e-4c55-9f1e-2a8c1d0e4b6a --offline-confirmed 2>&1 | grep -v -E '^\s+at |^SLF4J|^\s+\.\.\. [0-9]+ more'
      echo \"exit=\${PIPESTATUS[0]}\"" 2>&1 | sed "s#^#[$arm] #" | tee -a $OUT
done
