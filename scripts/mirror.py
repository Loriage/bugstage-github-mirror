"""One-way Git replication. No force pushes, remote deletions or GitHub credentials."""
import datetime
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
from configure import validate

STATE = Path(os.environ.get('MIRROR_STATE', '/state'))
CONFIG = Path(os.environ.get('MIRROR_CONFIG', '/config/mirrors.json'))
INTERVAL = int(os.environ.get('SYNC_INTERVAL', '300'))
STOP = threading.Event()

def git(args, cwd=None):
    env = os.environ.copy()
    env.update({
        'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_NOSYSTEM': '1',
        'GIT_CONFIG_GLOBAL': '/dev/null',
        'GIT_SSH_COMMAND': f'ssh -i {STATE}/id_ed25519 -o IdentitiesOnly=yes '
                           f'-o BatchMode=yes -o StrictHostKeyChecking=yes '
                           f'-o UserKnownHostsFile={STATE}/known_hosts -o ConnectTimeout=15',
    })
    result = subprocess.run(['git', *args], cwd=cwd, env=env,
                            capture_output=True, text=True, timeout=240)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout

def remote_refs(url, cwd):
    return {ref: sha for sha, ref in
            (line.split() for line in git(['ls-remote', '--heads', '--tags', url], cwd).splitlines())
            if not ref.endswith('^{}')}

def sync(config):
    validate([config])
    source = config['source']
    if not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git', source):
        raise ValueError('Only explicit public GitHub HTTPS sources are enabled')
    for key in ['project', 'repository']:
        if not re.fullmatch(r'[a-z0-9_-]+', config[key]):
            raise ValueError('Invalid destination slug')
    name = config['project'] + '/' + config['repository']
    cache = STATE / 'repositories' / config['project'] / (config['repository'] + '.git')
    destination = 'ssh://git@bugstage:8022/' + name + '.git'
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        git(['init', '--bare', str(cache)])
    # Reassert fixed remotes on every run. There is no push route to GitHub.
    git(['config', 'remote.origin.url', source], cache)
    git(['config', 'remote.origin.pushurl', 'file:///github-push-disabled'], cache)
    git(['config', 'remote.bugstage.url', destination], cache)
    git(['fetch', '--prune', '--no-write-fetch-head', 'origin',
         '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'], cache)
    git(['symbolic-ref', 'HEAD', 'refs/heads/' + config['default_branch']], cache)
    expected = {ref: sha for sha, ref in
                (line.split() for line in git(['show-ref', '--heads', '--tags'], cache).splitlines())}
    git(['push', '--porcelain', 'bugstage',
         'refs/heads/*:refs/heads/*', 'refs/tags/*:refs/tags/*'], cache)
    actual = remote_refs(destination, cache)
    missing = [ref for ref, sha in expected.items() if actual.get(ref) != sha]
    if missing:
        raise RuntimeError('Verification failed for ' + ', '.join(missing))
    return {'repository': name, 'branches': sum(x.startswith('refs/heads/') for x in expected),
            'tags': sum(x.startswith('refs/tags/') for x in expected),
            'main_commit': expected.get('refs/heads/' + config['default_branch']),
            'retained_extra_refs': sorted(set(actual) - set(expected))}

def cycle():
    results, errors = [], []
    for config in validate(json.loads(CONFIG.read_text())):
        try:
            results.append(sync(config))
        except Exception as error:
            errors.append({'repository': config.get('repository'), 'error': str(error)})
    report = {'status': 'error' if errors else 'ok', 'timestamp': time.time(),
              'time_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'results': results, 'errors': errors}
    temp = STATE / '.status.json.tmp'
    temp.write_text(json.dumps(report, indent=2) + '\n')
    temp.replace(STATE / 'status.json')
    print(json.dumps(report), flush=True)
    return not errors

def main():
    if '--health' in sys.argv:
        try:
            report = json.loads((STATE / 'status.json').read_text())
            return 0 if report['status'] == 'ok' and time.time() - report['timestamp'] < INTERVAL * 3 else 1
        except (OSError, ValueError, KeyError):
            return 1
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    for sig in [signal.SIGTERM, signal.SIGINT]:
        signal.signal(sig, lambda *_: STOP.set())
    if not (STATE / '.configured').exists():
        raise RuntimeError('Run the setup service before starting the mirror')
    if '--once' in sys.argv:
        return 0 if cycle() else 1
    while not STOP.is_set():
        cycle()
        STOP.wait(INTERVAL)
    return 0

if __name__ == '__main__':
    sys.exit(main())
