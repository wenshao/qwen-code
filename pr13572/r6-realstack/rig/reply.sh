#!/bin/bash
# usage: reply.sh <login> <text>   — reply in-thread to the newest agent reply in <login>'s inbox
cd /Users/wenshao/git/pr13572-rig || exit 9
J=$(node mail/mua.mjs list "$1" | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8")).filter(m=>/^Re:/.test(m.subject)); const r=l.at(-1); const refs=[...(Array.isArray(r.references)?r.references:[r.references]), r.messageId].filter(Boolean); console.log(JSON.stringify({id:r.messageId, refs:refs.join(","), subject:r.subject}))')
ID=$(node -e "console.log(($J).id)"); REFS=$(node -e "console.log(($J).refs)"); SUBJ=$(node -e "console.log(($J).subject)")
node mail/mua.mjs send "$1" "$SUBJ" "$2" --reply-to-id "$ID" --refs "$REFS"
