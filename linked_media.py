"""Read-only, allowlisted media access. Never returns a source path to a writer.

Library folders contain real writable directories, never links into the source.
Only exact imported media paths may fall back to the external source directory.
"""
import functools
import hashlib
import json
import threading
from pathlib import Path, PurePosixPath

MEDIA_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.avif'}
_verified = {}
_lock = threading.RLock()


def relative_path(value):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        raise ValueError('Invalid media path')
    parts = value.split('/')
    if any(not part or part.startswith('.') for part in parts) or PurePosixPath(value).is_absolute():
        raise ValueError('Invalid media path')
    return value


@functools.lru_cache(maxsize=32)
def _load(path, modified, size):
    spec = json.loads(Path(path).read_text())
    if spec.get('version') != 1 or spec.get('mode') != 'read-only':
        raise ValueError('Invalid linked-media configuration')
    return spec


def config(root):
    path = Path(root)/'.state/linked-media.json'
    if not path.exists(): return None
    stat = path.stat()
    return _load(str(path), stat.st_mtime_ns, stat.st_size)


def resolve_read(root, relative):
    """Resolve an existing local file or an integrity-checked linked image for reading."""
    relative_path(relative)
    root = Path(root).resolve()
    local = root/relative
    resolved = local.resolve()
    if not resolved.is_relative_to(root): raise ValueError('Library path escapes its directory')
    if local.exists():
        if not local.is_file(): raise FileNotFoundError(relative)
        return resolved
    spec = config(root)
    entry = (spec or {}).get('files', {}).get(relative)
    if not entry or Path(relative).suffix.lower() not in MEDIA_SUFFIXES:
        raise FileNotFoundError(relative)
    source = Path(spec['source_root'])
    # A moved/replaced source symlink must never silently change the allowed root.
    if source.resolve() != source or not source.is_dir():
        raise FileNotFoundError('Linked image folder is unavailable')
    path = source/relative
    if path.is_symlink() or not path.resolve().is_relative_to(source) or not path.is_file():
        raise FileNotFoundError('Linked image is unavailable')
    stat = path.stat()
    signature = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    key = (str(path), entry['sha256'])
    with _lock:
        if _verified.get(key) != signature:
            if stat.st_size != entry['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
                raise ValueError('Linked image changed since import; original was not modified by Reference Desk')
            _verified[key] = signature
    return path


def reference_path(root, relative):
    relative_path(relative)
    if not relative.startswith('assets/') or Path(relative).suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'}:
        raise ValueError('Reference must be a catalogued image')
    return resolve_read(root, relative)


def reference_info(root, relative):
    linked = relative in (config(root) or {}).get('files', {}) and not (Path(root)/relative).exists()
    try: path = str(resolve_read(root, relative))
    except (ValueError, OSError): path = None
    return {'local_path': path, 'linked_read_only': linked, 'file_available': path is not None}
