import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import configure


class ConfigureTests(unittest.TestCase):
    def test_regeneration_preserves_notification_and_schedule_choices(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'pb_hooks').mkdir()
            (root / '.secrets').mkdir()
            secret = root / '.secrets/admin.json'
            secret.write_text('{"test":"preserve existing credentials"}')
            (root / 'mirrors.json').write_text(json.dumps([{
                'source':'https://github.com/example/app.git','project':'app',
                'repository':'app','private':False,'default_branch':'main'}]))
            config = root / 'pb_hooks/github-sync.config.json'
            config.write_text('{"schedule_enabled":false,"notify_new_releases":true,"repositories":[]}')
            previous_umask = os.umask(0o077)
            try:
                with patch.object(configure, 'ROOT', root), patch.object(sys, 'argv', ['configure.py']), contextlib.redirect_stdout(io.StringIO()):
                    configure.main()
            finally:
                os.umask(previous_umask)
            result = json.loads(config.read_text())
            self.assertFalse(result['schedule_enabled'])
            self.assertTrue(result['notify_new_releases'])
            self.assertEqual(len(result['repositories']), 1)
            self.assertEqual(secret.read_text(), '{"test":"preserve existing credentials"}')
