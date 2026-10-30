"""Provision explicit destinations for the optional fresh Docker installation."""
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from configure import validate

BASE = 'http://bugstage:8090'
TOKEN = ''


def api(method, path, data=None):
    request = urllib.request.Request(BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type': 'application/json', 'Authorization': TOKEN}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{method} {path}: HTTP {error.code}') from None


def records(collection, expression):
    query = urllib.parse.urlencode({'filter': expression, 'perPage': 100})
    return api('GET', f'/api/collections/{collection}/records?{query}')['items']


def ensure(collection, expression, data):
    existing = records(collection, expression)
    return existing[0] if existing else api('POST', f'/api/collections/{collection}/records', data)


def main():
    global TOKEN
    os.umask(0o077)
    entries = validate(json.loads(Path('/config/mirrors.json').read_text()))
    state = Path('/state')
    state.mkdir(parents=True, exist_ok=True)
    credentials = json.loads(Path('/run/secrets/admin_credentials').read_text())
    TOKEN = api('POST', '/api/collections/_superusers/auth-with-password', {
        'identity': credentials['email'], 'password': credentials['password']})['token']
    user = records('users', 'email=' + json.dumps(credentials['email']))[0]
    key = state / 'id_ed25519'
    if not key.exists():
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C',
                        'bugstage-github-mirror', '-f', str(key)], check=True)
    public_key = key.with_suffix('.pub').read_text().strip()
    registered = ensure('sshKeys', 'name="github-mirror" && user=' + json.dumps(user['id']), {
        'user': user['id'], 'name': 'github-mirror', 'publicKey': public_key})
    if registered['publicKey'] != public_key:
        raise RuntimeError('Existing mirror SSH key differs; inspect before replacing it')
    host_public = subprocess.check_output(['ssh-keygen', '-y', '-f', '/data/.ssh_private_key'], text=True).strip()
    (state / 'known_hosts').write_text('[bugstage]:8022 ' + host_public + '\n')
    for config in entries:
        project = ensure('projects', 'name=' + json.dumps(config['project']), {
            'name': config['project'], 'title': config.get('title', config['project']),
            'description': config.get('description', 'Public GitHub mirror'), 'accentColor': '#5264db'})
        repo = ensure('repositories', 'project=' + json.dumps(project['id']) + ' && name=' + json.dumps(config['repository']), {
            'project': project['id'], 'name': config['repository'], 'private': False, 'order': 1})
        if repo['private']:
            raise RuntimeError('Existing destination is private; refusing to change its visibility')
        path = Path('/data/repositories') / repo['id']
        git_dir = path / '.git' if (path / '.git').is_dir() else path
        subprocess.run(['git', '--git-dir=' + str(git_dir), 'symbolic-ref', 'HEAD', 'refs/heads/' + config['default_branch']], check=True)
        ensure('links', 'project=' + json.dumps(project['id']) + ' && title="GitHub"', {
            'project': project['id'], 'title': 'GitHub', 'href': config['source'].removesuffix('.git'),
            'icon': 'ri-github-fill', 'order': 1, 'compact': False})
        print('Configured', config['project'] + '/' + config['repository'], flush=True)
    settings = api('GET', '/api/settings')
    api('PATCH', '/api/settings', {'meta': {**settings['meta'], 'appURL': os.environ['PUBLIC_URL']}})
    (state / '.configured').write_text('ready\n')
    print('Setup complete. Start the mirror service to copy branches and tags.')


if __name__ == '__main__':
    main()
