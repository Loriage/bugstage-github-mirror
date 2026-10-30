"""Initialize this new instance once, then exec the pinned BugStage binary."""
import json
import os
from pathlib import Path
import subprocess

os.umask(0o077)
data = Path('/app/pb_data')
data.mkdir(parents=True, exist_ok=True)
marker = data / '.admin-initialized'
if not marker.exists():
    # Custom BugStage collections must exist before its first-maintainer hook runs.
    subprocess.run(['/app/bugstage', 'migrate', 'up', '--dir=' + str(data)], check=True)
    credentials = json.loads(Path('/run/secrets/admin_credentials').read_text())
    result = subprocess.run([
        '/app/bugstage', 'superuser', 'create', credentials['email'],
        credentials['password'], '--dir=' + str(data),
    ], capture_output=True, text=True)
    if result.returncode:
        # CalledProcessError would include the secret in the command arguments.
        detail = (result.stderr or result.stdout).replace(credentials['password'], '[REDACTED]')
        raise SystemExit('Administrator initialization failed: ' + detail)
    marker.write_text('Administrator and first maintainer initialized.\n')
os.execv('/app/bugstage', [
    '/app/bugstage', 'serve', '--http=0.0.0.0:8090',
    '--ssh=0.0.0.0:8022', '--dir=' + str(data),
])
