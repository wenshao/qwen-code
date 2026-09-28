#!/bin/bash
# TLS material for the OSS double: private CA, leaf cert for oss-cn-hangzhou.aliyuncs.com (+ wildcard for the
# virtual-hosted bucket), a PKCS12 trust store for the JVM, and a JVM hosts file (-Djdk.net.hosts.file).
set -e
cd "$(dirname $0)"
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 30 -subj "/CN=rig-fake-oss-ca" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj "/CN=oss-cn-hangzhou.aliyuncs.com"
printf "subjectAltName=DNS:oss-cn-hangzhou.aliyuncs.com,DNS:*.oss-cn-hangzhou.aliyuncs.com\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n" > ext.cnf
openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out srv.pem -days 30 -extfile ext.cnf
keytool -importcert -noprompt -alias rigca -file ca.pem -keystore trust.jks -storepass rigtrust
printf "127.0.0.1 localhost\n127.0.0.1 oss-cn-hangzhou.aliyuncs.com\n127.0.0.1 rig-bucket.oss-cn-hangzhou.aliyuncs.com\n" > hosts
# The OSS double must listen on port 443. On macOS a non-root process can bind 0.0.0.0:443 but not 127.0.0.1:443.
# macOS JDKs inherit the system proxy into http(s).proxyHost; spring.sh clears it, otherwise the SDK reaches real Aliyun.
