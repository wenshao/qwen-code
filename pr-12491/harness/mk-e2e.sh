#!/bin/bash
# Build a self-contained "repository under review" + fake GitHub, no network.
set -euo pipefail
ROOT="$1"        # where to build it
rm -rf "$ROOT"; mkdir -p "$ROOT/bin"
export GIT_CONFIG_GLOBAL="$ROOT/gitconfig"
export GIT_CONFIG_SYSTEM=/dev/null
cat > "$ROOT/gitconfig" <<'G'
[user]
	name = Harness
	email = harness@example.invalid
[init]
	defaultBranch = main
[protocol "file"]
	allow = always
G

# --- upstream bare repo -------------------------------------------------
git init -q --bare "$ROOT/upstream.git"
git init -q "$ROOT/seed"
cd "$ROOT/seed"
printf 'alpha\n' > a.txt
git add -A && git commit -qm "base commit"
BASE=$(git rev-parse HEAD)
git checkout -q -b feature
printf 'alpha\nbeta\n' > a.txt
printf 'new file\n' > b.txt
git add -A && git commit -qm "feature commit"
HEAD_SHA=$(git rev-parse HEAD)
git checkout -q main
git remote add origin "$ROOT/upstream.git"
git push -q origin main
git push -q origin feature:refs/pull/1/head
git push -q origin feature:refs/pull/2/head
git push -q origin feature:refs/pull/3/head
cd "$ROOT"

# --- the clone the reviewer runs in -------------------------------------
git clone -q "$ROOT/upstream.git" "$ROOT/repo"
cd "$ROOT/repo"
git config user.name Harness; git config user.email harness@example.invalid
git remote set-url origin "$ROOT/upstream.git"
cd "$ROOT"

# --- fake gh -------------------------------------------------------------
cat > "$ROOT/bin/gh" <<GH
#!/bin/bash
# Fake gh. Logs every invocation, answers the few reads review/fetch-pr makes.
echo "gh \$*" >> "$ROOT/gh-calls.log"
case "\$1 \$2" in
  "auth status") echo "Logged in to github.com as harness"; exit 0 ;;
  "repo view")
    echo '{"owner":{"login":"acme"},"name":"widget","url":"https://github.com/acme/widget"}'; exit 0 ;;
  "pr view")
    if [[ "\$*" == *closingIssuesReferences* ]]; then
      echo '{"closingIssuesReferences":[]}'; exit 0
    fi
    echo '{"headRefOid":"$HEAD_SHA","url":"https://github.com/acme/widget/pull/1","number":1,"title":"Harness PR","body":"harness","author":{"login":"harness"},"baseRefName":"main","headRefName":"feature","state":"OPEN","isDraft":false,"additions":2,"deletions":0,"changedFiles":2}'
    exit 0 ;;
  "api "*)
    echo '[]'; exit 0 ;;
esac
echo '{}'
exit 0
GH
chmod +x "$ROOT/bin/gh"

mkdir -p "$ROOT/home"
cat > "$ROOT/env.sh" <<E
export BASE_SHA=$BASE
export HEAD_SHA=$HEAD_SHA
export ROOT=$ROOT
export QWEN_HOME=$ROOT/home
export GIT_CONFIG_GLOBAL=$ROOT/gitconfig
export GIT_CONFIG_SYSTEM=/dev/null
export PATH=$ROOT/bin:\$PATH
E
echo "BASE=$BASE HEAD=$HEAD_SHA"
