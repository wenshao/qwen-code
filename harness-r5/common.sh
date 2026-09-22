H='\033[1;36m'; G='\033[1;32m'; R='\033[1;31m'; Y='\033[1;33m'; D='\033[2m'; N='\033[0m'
Q=/root/verify/h12267r5/q.sh
hdr() { printf "${H}%s${N}\n" "$*"; }
cmd() { printf "${D}\$ %s${N}\n" "$*"; }
ok() { printf "  ${G}%s${N}\n" "$*"; }
bad() { printf "  ${R}%s${N}\n" "$*"; }
note() { printf "  ${Y}%s${N}\n" "$*"; }
filt() { grep -v -E '^(Boundary|Filesystem|Command network|Model, auth|Host reads|Backend probe)'; }
