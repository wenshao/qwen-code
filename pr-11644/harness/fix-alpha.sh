#!/bin/bash
cd /root/git/h11644/ws/alpha-app
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] && git checkout -q main && echo "alpha -> main"
git show-ref -q refs/heads/feature/s13 && git branch -q -D feature/s13 && echo "deleted feature/s13"
echo "alpha on $(git rev-parse --abbrev-ref HEAD)"
