#!/bin/zsh
set -e
cd "$(dirname "$0")"
python3 -m venv .venv-crescendo
.venv-crescendo/bin/python -m pip install -r crescendo-engine/scripts/requirements.txt
mkdir -p .state
pwd | awk '{print $0 "/.venv-crescendo/bin/python"}' > .state/crescendo-python
echo 'Crescendo is ready. Reload its page in Reference Desk.'
