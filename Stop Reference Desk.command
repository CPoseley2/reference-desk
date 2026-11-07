#!/bin/zsh
cd -- "$(dirname "$0")" || exit 1
exec /usr/bin/python3 -B launch_review.py --stop
