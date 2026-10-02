#!/bin/bash
exec docker --context colima-pr13112 exec pr13112-lx bash -c "$*"
