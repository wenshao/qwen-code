#!/bin/bash
# append the hook's stdin payload, one JSON per line, tagged by event
{ printf '{"event":"%s","payload":' "$1"; cat; printf '}\n'; } >> /root/verify/pr12258-r2/hooklogs/hooks.jsonl
exit 0
