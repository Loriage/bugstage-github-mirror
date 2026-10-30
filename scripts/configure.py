"""Validate a mirror list and prepare a new optional Docker installation."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets

ROOT = Path(__file__).resolve().parents[1]


def validate(entries):
    if not isinstance(entries, list) or not entries:
        raise ValueError('mirrors.json must contain at least one repository')
    sources, targets = set(), set()
    for entry in entries:
        source = entry.get('source', '')
        if not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git', source):
            raise ValueError('Only public GitHub HTTPS repository URLs are supported')
        if entry.get('private') is not False:
            raise ValueError('Every mirror must explicitly set private to false')
        for key in ['project', 'repository']:
            if not re.fullmatch(r'[a-z0-9_-]+', entry.get(key, '')):
                raise ValueError('Invalid destination slug: ' + key)
        branch = entry.get('default_branch', '')
        if not branch or branch.startswith(('-', '/')) or '..' in branch or any(c.isspace() for c in branch):
            raise ValueError('Invalid default_branch')
        target = entry['project'] + '/' + entry['repository']
        if source.lower() in sources or target in targets:
            raise ValueError('Duplicate source or destination')
        sources.add(source.lower())
        targets.add(target)
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--admin-email', help='Required only when creating a new Docker instance')
    parser.add_argument('--check', action='store_true', help='Validate without writing any files')
    args = parser.parse_args()
    os.umask(0o077)
    entries = validate(json.loads((ROOT / 'mirrors.json').read_text()))
    if args.check:
        print('Mirror configuration is valid.')
        return
    secret = ROOT / '.secrets/admin.json'
    if not secret.exists():
        if not args.admin_email or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', args.admin_email):
            parser.error('Provide --admin-email for the first setup')
        secret.parent.mkdir(mode=0o700, exist_ok=True)
        with secret.open('x') as stream:
            json.dump({'email': args.admin_email, 'password': secrets.token_urlsafe(32)}, stream)
        secret.chmod(0o600)
        print('Generated administrator credentials in .secrets/admin.json (mode 0600). Keep this file private.')
    config = {'schedule_enabled': True, 'repositories': [
        {key: entry[key] for key in ['source', 'project', 'repository', 'private']} for entry in entries
    ]}
    (ROOT / 'pb_hooks/github-sync.config.json').write_text(json.dumps(config, indent=2) + '\n')
    print('Metadata sync configuration updated. Existing credentials were preserved.')


if __name__ == '__main__':
    main()
