"""Credential-safe, read-only provider checks. Never generates an image."""
import copy
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

_cache = {}
_lock = threading.Lock()


def identity(state, key, model):
    return (str(state.resolve()), hashlib.sha256(key.encode()).hexdigest(), model)


def remember(state, key, model, result):
    with _lock:
        _cache[identity(state, key, model)] = copy.deepcopy(result)
        if len(_cache) > 64:
            del _cache[next(iter(_cache))]


def status(state, model, check=False):
    from image_generation import api_key, api_failure, JobError
    source = 'Server environment (OPENAI_API_KEY)' if os.environ.get('OPENAI_API_KEY', '').strip() else 'Private saved key on this Mac'
    out = {'credential_source': source, 'shared_across_libraries': True,
           'model': model, 'endpoint': 'https://api.openai.com/v1/images',
           'check_endpoint': 'https://api.openai.com/v1/models/' + model,
           'scope': 'Checks authentication and model visibility without generating an image. Image permissions, credits and billing are not verified.'}
    try:
        key = api_key(state)
    except (JobError, OSError) as error:
        message = str(error) if isinstance(error, JobError) else 'The saved key could not be read. Run Set Up Image API.command again.'
        return {**out, 'state': 'needs_setup', 'configured': False, 'message': message}
    with _lock:
        cached = copy.deepcopy(_cache.get(identity(state, key, model)))
    if not check:
        if cached and time.time() - cached['checked_at'] < 300:
            return {**out, **cached}
        return {**out, 'state': 'unverified', 'configured': True,
                'message': 'Key saved; OpenAI access has not been verified. Use Check API access.'}
    started = time.monotonic()
    result = {'checked_at': time.time(), 'configured': True}
    request = urllib.request.Request(out['check_endpoint'], headers={'Authorization': 'Bearer ' + key}, method='GET')
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read(65536))
            if not isinstance(payload, dict) or payload.get('id') != model:
                raise ValueError('Unexpected model response')
        result.update(state='verified', message='Authentication and model visibility verified. Image generation permissions and available credits are checked when you generate.')
    except urllib.error.HTTPError as error:
        failure = api_failure(error)
        message = str(failure)
        if error.code == 403:
            message = 'This key cannot read the model endpoint. Check its model-read permissions; this check cannot determine image-generation access.'
        elif error.code == 404:
            message = 'The configured model is unavailable to this API project. Check model access and the app’s model configuration.'
        result.update(state='rejected' if error.code == 401 else 'check_failed', configured=error.code != 401, message=message, api_error=failure.diagnostics)
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        result.update(state='unreachable', message='Could not reach OpenAI. Check this Mac’s internet connection, VPN, proxy and firewall, then check again. No image request was sent.')
    except (ValueError, TypeError):
        result.update(state='check_failed', message='OpenAI returned an unexpected model response. Try the access check again. No image request was sent.')
    result['latency_ms'] = round((time.monotonic() - started) * 1000)
    remember(state, key, model, result)
    return {**out, **result}


def recent_job(directory):
    """Only expose operational fields, never prompt, references or credentials."""
    files = sorted(directory.glob('*/job.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in files[:1]:
        try:
            job = json.loads(path.read_text())
            return {k: job.get(k) for k in ('id', 'status', 'message', 'updated_at', 'api_error')}
        except (OSError, ValueError):
            pass
    return None
