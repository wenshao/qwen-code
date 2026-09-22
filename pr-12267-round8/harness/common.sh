C='\033[1;36m'; G='\033[1;32m'; R='\033[1;31m'; Y='\033[1;33m'; D='\033[2m'; N='\033[0m'; B='\033[1m'
H=/root/verify/h12267r8; Q=$H/q.sh
hdr(){ printf "${C}%s${N}\n" "$*"; }
ok(){ printf "  ${G}%s${N}\n" "$*"; }
bad(){ printf "  ${R}%s${N}\n" "$*"; }
note(){ printf "  ${Y}%s${N}\n" "$*"; }
dim(){ printf "${D}%s${N}\n" "$*"; }
filt(){ grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'; }
