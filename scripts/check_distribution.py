"""Check tracked files for accidental private runtime data or credential patterns."""
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parent.parent
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
blocked = {'.state', 'libraries', '__pycache__', 'catalog-history', 'generation-records'}
patterns = [re.compile(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}'),
            re.compile(r'\bgh[pousr]_[A-Za-z0-9]{20,}'),
            re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]
errors = []
for name in filter(None, paths):
    path = Path(name)
    if set(path.parts) & blocked or path.name.startswith('.env') or path.name == 'image-api-key':
        errors.append(f'Private/runtime path: {name}')
    if path.as_posix() in {'manifest.json', 'data.js', 'reference-manifest.csv', 'reference-audit.csv'}:
        errors.append(f'Production catalog: {name}')
    raw = (root/path).read_bytes()
    if b'\x00' in raw:
        continue
    content = raw.decode('utf-8', errors='replace')
    if any(pattern.search(content) for pattern in patterns):
        errors.append(f'Credential pattern: {name}')
    if re.search('/' + r'Users/[^/\s]+/', content):
        errors.append(f'Personal filesystem path: {name}')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'Public distribution check passed: {len(list(filter(None, paths)))} tracked files.')
