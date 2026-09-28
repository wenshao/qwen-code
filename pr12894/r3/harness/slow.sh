#!/bin/sh
# ~96 s of periodic output (keeps a publication OPEN and renewing).
i=1
while [ $i -le 12 ]; do echo "tick ${i}"; sleep 8; i=$((i+1)); done
