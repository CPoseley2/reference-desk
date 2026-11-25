#!/usr/bin/env python3
"""Connect the bundled Command Center to this Reference Desk checkout."""
import json
import sys
from pathlib import Path
from catalog import build
root=Path(__file__).resolve().parent
state=root.parent/'.state';state.mkdir(exist_ok=True)
config=state/'storyboard-module.json'
if config.exists():
    raise SystemExit('A storyboard connection already exists; keep it or edit its private configuration explicitly.')
build()
config.write_text(json.dumps({'root':str(root),'python':sys.executable},indent=2)+'\n')
print('Command Center is ready. Open Storyboards in Reference Desk, or run command-center/launch.py.')
