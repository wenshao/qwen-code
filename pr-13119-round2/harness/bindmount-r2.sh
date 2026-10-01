#!/bin/bash
# usage: bindmount-r2.sh <arm> <startups|other-writer>
# Private mount namespace with the real bwrap overlaid at /usr/bin (ns.sh); host mounts untouched.
exec /root/verify/pr13119/bwrap-private/ns.sh node /root/verify/pr13119/r2/bindmount-r2.mjs "$@"
