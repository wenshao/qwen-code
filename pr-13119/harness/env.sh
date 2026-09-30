# common isolated environment for every qwen process in this harness
export HOME=/root/verify/pr13119/run/home
export QWEN_HOME=/root/verify/pr13119/run/qh
export QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/system-settings.json
export QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/system-defaults.json
export QWEN_CODE_NO_RELAUNCH=1 QWEN_SANDBOX=false TERM=xterm-256color
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy NO_COLOR QWEN_CODE_SIMPLE
export WS=/root/verify/pr13119/run/ws
export OUTSIDE=/root/verify/pr13119/outside
