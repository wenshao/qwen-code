#!/usr/bin/python3
import os, sys
from pathlib import Path
root=Path('/tmp/qwen-pr10237-verify-20260909')
env={'PATH':'/Users/wenshao/.nvm/versions/node/v22.22.2/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','TMPDIR':str(root/'runtime'),'QWEN_HOME':str(root/'runtime'/'qwen-home'),'QWEN_RUNTIME_DIR':str(root/'runtime'/'qwen-runtime'),'npm_config_cache':str(root/'npm-cache'),'npm_config_userconfig':str(root/'empty-npmrc'),'QWEN_SKIP_PREPARE':'1','HUSKY':'0','LANG':'en_US.UTF-8','TERM':'xterm-256color','CI':'1'}
(root/'empty-npmrc').touch()
profile=str(root/'isolation.sb')
os.execve('/usr/bin/sandbox-exec',['sandbox-exec','-f',profile,*sys.argv[1:]],env)
