#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
rm -f *.pem *.csr *.srl *.cnf

CN_ROOT="qwen renewed test root CA"

cat > root.cnf <<'CNF'
[v3_ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
CNF

cat > leaf_good.cnf <<'CNF'
[v3_leaf]
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
subjectAltName=IP:127.0.0.1,DNS:localhost
CNF

cat > leaf_badsan.cnf <<'CNF'
[v3_leaf]
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
subjectAltName=DNS:not-the-dial-host.invalid
CNF

# ---- one root key, shared by BOTH root certificates (a real CA renewal
# ---- that reuses the key: same subject, same key, different validity)
openssl genrsa -out rootkey.pem 2048 2>/dev/null

# expired copy (2024-01-01 .. 2024-06-01)
openssl req -x509 -new -key rootkey.pem -sha256 \
  -subj "/CN=$CN_ROOT" \
  -not_before 20240101000000Z -not_after 20240601000000Z \
  -config root.cnf -extensions v3_ca \
  -out root-expired.pem 2>/dev/null

# renewed copy (2026-01-01 .. 2036-01-01)
openssl req -x509 -new -key rootkey.pem -sha256 \
  -subj "/CN=$CN_ROOT" \
  -not_before 20260101000000Z -not_after 20360101000000Z \
  -config root.cnf -extensions v3_ca \
  -out root-renewed.pem 2>/dev/null

# ---- leaves, signed by the shared root key (so BOTH roots verify them)
openssl genrsa -out leafkey.pem 2048 2>/dev/null
openssl req -new -key leafkey.pem -subj "/CN=localhost" -out leaf.csr 2>/dev/null

openssl x509 -req -in leaf.csr -CA root-renewed.pem -CAkey rootkey.pem \
  -sha256 -not_before 20260101000000Z -not_after 20360101000000Z \
  -extfile leaf_good.cnf -extensions v3_leaf -out leaf-good.pem 2>/dev/null

openssl x509 -req -in leaf.csr -CA root-renewed.pem -CAkey rootkey.pem \
  -sha256 -not_before 20260101000000Z -not_after 20360101000000Z \
  -extfile leaf_badsan.cnf -extensions v3_leaf -out leaf-badsan.pem 2>/dev/null

# ---- bundles. EXPIRED COPY FIRST, exactly the ordering the PR is about.
cat leaf-good.pem   root-expired.pem root-renewed.pem > bundleA-renewed-ok.pem
cat leaf-badsan.pem root-expired.pem root-renewed.pem > bundleB-renewed-badsan.pem
cat leaf-good.pem   root-expired.pem                  > bundleC-expired-only.pem

echo "=== subjects / validity ==="
for f in root-expired.pem root-renewed.pem leaf-good.pem leaf-badsan.pem; do
  printf '%-20s ' "$f"
  openssl x509 -in $f -noout -subject -issuer -dates -serial | tr '\n' ' '
  echo
done
echo
echo "=== both roots share the same public key? ==="
a=$(openssl x509 -in root-expired.pem -noout -pubkey | openssl sha256 | awk '{print $NF}')
b=$(openssl x509 -in root-renewed.pem -noout -pubkey | openssl sha256 | awk '{print $NF}')
echo "root-expired  pubkey sha256: $a"
echo "root-renewed  pubkey sha256: $b"
[ "$a" = "$b" ] && echo "SAME KEY -> both verify what the other issued" || { echo "MISMATCH"; exit 1; }
echo
echo "=== both roots verify the leaf? (openssl verify, -no_check_time) ==="
openssl verify -no_check_time -CAfile root-expired.pem -partial_chain leaf-good.pem
openssl verify -no_check_time -CAfile root-renewed.pem -partial_chain leaf-good.pem
