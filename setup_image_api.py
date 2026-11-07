#!/usr/bin/env python3
"""Store the local server key outside the served website; never print it."""
import getpass, os, tempfile
from pathlib import Path

def main():
    state=Path(__file__).resolve().parent/'.state'
    print('DESK image API setup\n')
    print('Create an API key at https://platform.openai.com/settings/organization/api-keys')
    print('Check API credits/billing at https://platform.openai.com/settings/organization/billing/overview')
    print('This only stores your key. Image charges occur when you click Generate in the desk.\n')
    key=getpass.getpass('API key (hidden; blank cancels): ').strip()
    if not key:print('Cancelled. Existing configuration kept.');return
    if len(key)<20 or any(c.isspace() for c in key):raise ValueError('Invalid key format; existing configuration kept.')
    state.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix='.image-api-key-',dir=state)
    try:
        with os.fdopen(fd,'w') as f:f.write(key+'\n');f.flush();os.fsync(f.fileno())
        os.chmod(name,0o600);os.replace(name,state/'image-api-key')
    finally:
        if os.path.exists(name):os.unlink(name)
    print('\nKey saved privately. Click Refresh connection in the reference desk. No restart needed.')

if __name__=='__main__':
    try:main()
    except (KeyboardInterrupt,EOFError):print('\nCancelled.')
    except Exception:print('\nSetup could not complete. Check the key format and folder permissions; no key was displayed.')
    input('\nPress Return to close…')
