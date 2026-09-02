#!/usr/bin/env bash
# Builds PATH shims that add LAT seconds of latency to every fork+exec of the
# externals a heartbeat tick resolves by name. Models a loaded self-hosted
# runner where process creation — not wall-clock sleeping — is what got slower.
# The counter uses bash builtins only: a `date` call inside the `date` shim
# would resolve back to the shim itself.
set -euo pipefail
dir="$1"; lat="$2"
mkdir -p "$dir"
for tool in date mktemp head timeout; do
  real="$(command -v "$tool")"
  cat > "$dir/$tool" <<EOF
#!/usr/bin/env bash
sleep ${lat}
printf '%s %s\n' "\${EPOCHREALTIME:-?}" "${tool}" >> "\${SHIM_LOG:-/dev/null}" 2>/dev/null || true
exec ${real} "\$@"
EOF
  chmod +x "$dir/$tool"
done
echo "shims in $dir at ${lat}s: $(ls "$dir" | tr '\n' ' ')"
