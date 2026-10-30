import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import mirror
from configure import validate


def git(*args):
    env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
    return subprocess.check_output(['git', *args], text=True, stderr=subprocess.PIPE, env=env).strip()


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        self.target = self.root / 'target.git'
        git('init', '-b', 'main', str(self.source))
        git('init', '--bare', str(self.target))
        git('-C', str(self.source), 'config', 'user.name', 'Mirror tests')
        git('-C', str(self.source), 'config', 'user.email', 'tests@example.invalid')
        self.commit('first')
        self.config = {'source':'https://github.com/example/app.git','project':'app','repository':'app','private':False,'default_branch':'main'}
        real_git = mirror.git
        def local_transport(args, cwd=None):
            args = [str(self.source) if a == self.config['source'] else str(self.target) if a == 'ssh://git@bugstage:8022/app/app.git' else a for a in args]
            return real_git(args, cwd)
        self.patch_state = patch.object(mirror, 'STATE', self.root / 'state')
        self.patch_git = patch.object(mirror, 'git', local_transport)
        self.patch_state.start()
        self.patch_git.start()
        self.addCleanup(self.patch_state.stop)
        self.addCleanup(self.patch_git.stop)

    def commit(self, value):
        (self.source / 'file.txt').write_text(value)
        git('-C', str(self.source), 'add', 'file.txt')
        git('-C', str(self.source), 'commit', '-m', value)
        return git('-C', str(self.source), 'rev-parse', 'HEAD')

    def test_repeat_and_fast_forward_preserve_source_and_match_destination(self):
        first = mirror.sync(self.config)
        self.assertEqual(first, mirror.sync(self.config))
        newest = self.commit('second')
        self.assertEqual(mirror.sync(self.config)['main_commit'], newest)
        self.assertEqual(git('--git-dir='+str(self.target),'rev-parse','main'), newest)
        self.assertEqual(git('-C',str(self.source),'rev-parse','main'), newest)

    def test_deleted_source_branch_is_retained_at_destination(self):
        git('-C',str(self.source),'branch','feature')
        mirror.sync(self.config)
        git('-C',str(self.source),'branch','-D','feature')
        self.assertIn('refs/heads/feature',mirror.sync(self.config)['retained_extra_refs'])

    def test_history_rewrite_is_rejected_without_changing_destination(self):
        self.commit('second')
        mirror.sync(self.config)
        target_before = git('--git-dir='+str(self.target),'rev-parse','main')
        git('-C',str(self.source),'reset','--hard','HEAD~1')
        self.commit('rewritten')
        with self.assertRaises(RuntimeError):
            mirror.sync(self.config)
        self.assertEqual(git('--git-dir='+str(self.target),'rev-parse','main'),target_before)

    def test_private_and_duplicate_configuration_is_rejected(self):
        with self.assertRaises(ValueError): validate([{**self.config,'private':True}])
        with self.assertRaises(ValueError): validate([self.config,self.config])


if __name__ == '__main__':
    unittest.main()
