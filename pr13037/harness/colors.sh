#!/bin/sh
# Rig fixture: coloured test output with carriage-return progress, as npm/jest/cargo print it.
printf '\033[1mRunning 3 test suites\033[0m\n'
printf '\033[32m PASS \033[0m src/auth/login.test.ts \033[2m(412 ms)\033[0m\n'
printf '\033[32m PASS \033[0m src/net/pool.test.ts \033[2m(1.2 s)\033[0m\n'
printf '\033[31m FAIL \033[0m src/store/cache.test.ts\n'
printf 'downloading fixtures  10%%\rdownloading fixtures  55%%\rdownloading fixtures 100%%\n'
printf '\033[33mwarning\033[0m: 1 snapshot obsolete\r\n'
printf '\033[1mTests:\033[0m \033[31m1 failed\033[0m, \033[32m41 passed\033[0m, 42 total\n'
exit 1
