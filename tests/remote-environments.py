"""Linux environment lifecycle and broker boundary checks; no live model calls."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

REMOTE = Path(__file__).resolve().parents[1] / 'remote'
sys.path.insert(0, str(REMOTE))
import broker
import control
spec = importlib.util.spec_from_file_location('workbench_env', REMOTE / 'workbench-env.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Environments = module.Environments


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.workspace = self.base / 'workspace'
        self.workspace.mkdir()
        self.envs = Environments(self.workspace)

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, name='worker'):
        path = self.envs.path(name, require=False)
        path.mkdir()
        (path / '.workbench-environment.json').write_text(json.dumps({'name': name, 'version': 1, 'ready': True}))
        for name in ('.home', '.cache', '.npm-global', 'tmp', '.venv'):
            (path / name).mkdir()
        return path

    def test_real_venvs_npm_prefixes_and_caches_are_separate(self):
        for name in ('builder', 'reviewer'):
            self.envs.init(name)
        first = self.envs.path('builder')
        second = self.envs.path('reviewer')
        first_env, second_env = self.envs.environment(first), self.envs.environment(second)
        probe = 'import sys, os; print(sys.prefix); print(os.environ["NPM_CONFIG_PREFIX"]); print(os.environ["PIP_CACHE_DIR"])'
        outputs = [subprocess.check_output(['python', '-c', probe], env=env, text=True).splitlines() for env in (first_env, second_env)]
        self.assertEqual(outputs[0][0], str(first / '.venv'))
        self.assertEqual(outputs[1][0], str(second / '.venv'))
        for a, b in zip(*outputs):
            self.assertNotEqual(a, b)
        self.assertEqual(self.envs.run('builder', ['python', '-c', 'raise SystemExit(7)']), 7)
        self.assertEqual(len(self.envs.list()), 2)
        with self.assertRaises(FileExistsError):
            self.envs.init('builder')

    def test_names_and_symlinks_cannot_escape_workspace(self):
        for name in ('../outside', '/etc', '', 'a/b', 'UPPER', '.hidden', 'x' * 41):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.envs.path(name, require=False)
        outside = self.base / 'outside'
        outside.mkdir()
        (self.envs.root / 'escape').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.envs.clean('escape', 'escape')
        self.assertTrue(outside.is_dir())

    def test_registry_and_lock_symlinks_rejected(self):
        (self.envs.root / '.lock').symlink_to(self.base / 'outside-lock')
        with self.assertRaises(OSError):
            self.envs.list()
        other = self.base / 'other'
        other.mkdir()
        (other / '.environments').symlink_to(self.envs.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            Environments(other)

    def test_cache_dry_run_and_exact_delete_preserve_external_files(self):
        path = self.fixture()
        outside = self.base / 'keep.txt'
        outside.write_text('keep')
        (path / '.cache/keep-link').symlink_to(outside)
        (path / '.cache/cached').write_text('cached')
        self.assertFalse(self.envs.cache('worker')['removed'])
        self.assertTrue((path / '.cache/cached').exists())
        self.assertTrue(self.envs.cache('worker', True)['removed'])
        self.assertEqual(outside.read_text(), 'keep')
        with self.assertRaises(ValueError):
            self.envs.clean('worker', 'another')
        self.assertTrue(path.exists())
        self.envs.clean('worker', 'worker')
        self.assertFalse(path.exists())
        self.assertEqual(outside.read_text(), 'keep')

    def test_unmanaged_or_redirected_cache_is_not_removed(self):
        path = self.fixture()
        (path / '.cache').rmdir()
        (path / '.cache').symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.envs.cache('worker', True)
        (path / '.workbench-environment.json').write_text('{}')
        with self.assertRaises(ValueError):
            self.envs.clean('worker', 'worker')

    def test_incomplete_venv_cannot_fall_back_to_system_python(self):
        path = self.fixture()
        with self.assertRaisesRegex(ValueError, 'initialization'):
            self.envs.environment(path)


class JSONWriteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.job = self.base / 'jobs' / ('a' * 32)
        self.job.mkdir(parents=True)
        self.target = self.job / 'stop-request.json'
        self.outside = self.base / 'outside.txt'
        self.outside.write_bytes(b'Keep this file unchanged.\n')
        self.outside.chmod(0o640)
        self.original = self.snapshot(self.outside)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def snapshot(path):
        info = path.stat()
        return (path.read_bytes(), stat.S_IMODE(info.st_mode), info.st_uid,
                info.st_gid, info.st_ino, info.st_mtime_ns)

    def assert_written(self):
        self.assertFalse(self.target.is_symlink())
        self.assertEqual(json.loads(self.target.read_text()), {'reason': 'operator'})
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o600)
        self.assertEqual(self.snapshot(self.outside), self.original)

    def test_target_symlink_is_replaced_without_touching_its_destination(self):
        self.target.symlink_to(self.outside)
        broker.write_json(self.target, {'reason': 'operator'})
        self.assert_written()

    def test_predictable_temp_symlink_is_ignored(self):
        planted = self.target.with_suffix('.tmp')
        planted.symlink_to(self.outside)
        broker.write_json(self.target, {'reason': 'operator'})
        self.assert_written()
        self.assertTrue(planted.is_symlink())
        self.assertEqual(planted.readlink(), self.outside)

    def test_random_temp_collision_refuses_files_and_links(self):
        token = 'b' * 32
        collision = self.target.with_name(self.target.name + '.' + token + '.tmp')
        self.target.write_text('{"previous":true}')
        previous = self.snapshot(self.target)
        absent = self.base / 'must-not-be-created'
        for kind in ('file', 'symlink', 'dangling-symlink'):
            with self.subTest(kind=kind):
                if kind == 'file':
                    collision.write_bytes(b'Keep the collision unchanged.')
                    collision.chmod(0o640)
                    collision_before = self.snapshot(collision)
                else:
                    collision.symlink_to(self.outside if kind == 'symlink' else absent)
                try:
                    with patch.object(broker.uuid, 'uuid4', return_value=Mock(hex=token)):
                        with self.assertRaises(FileExistsError):
                            broker.write_json(self.target, {'reason': 'operator'})
                    self.assertEqual(self.snapshot(self.target), previous)
                    self.assertEqual(self.snapshot(self.outside), self.original)
                    self.assertFalse(absent.exists())
                    if kind == 'file':
                        self.assertEqual(self.snapshot(collision), collision_before)
                    else:
                        self.assertTrue(collision.is_symlink())
                finally:
                    collision.unlink()

    def test_new_file_is_private_even_with_permissive_umask(self):
        previous = os.umask(0)
        try:
            broker.write_json(self.target, {'reason': 'operator'})
        finally:
            os.umask(previous)
        self.assert_written()
        self.assertEqual(list(self.job.iterdir()), [self.target])

    def test_stop_replaces_marker_and_preserves_planted_link_targets(self):
        ident = self.job.name
        (self.job / 'job.json').write_text(json.dumps({'id': ident}))
        self.target.symlink_to(self.outside)
        self.target.with_suffix('.tmp').symlink_to(self.outside)
        with patch.object(control, 'BASE', self.base), \
                patch.object(control, 'command') as command, \
                patch.object(control, 'job_view', return_value={'status': 'stopped'}):
            self.assertEqual(control.run({'op': 'stop', 'id': ident}), {'status': 'stopped'})
        command.assert_called_once_with('systemctl', 'stop', 'tinfoil-job@' + ident + '.service')
        self.assertFalse(self.target.is_symlink())
        self.assertEqual(json.loads(self.target.read_text())['reason'], 'operator')
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o600)
        self.assertEqual(self.snapshot(self.outside), self.original)

    @unittest.skipUnless(os.geteuid() == 0, 'Requires root to check a real ownership change.')
    def test_enrollment_chown_does_not_follow_a_replaced_session_link(self):
        auth = self.base / 'auth'
        auth.mkdir()
        session = auth / 'session.bin'
        session.symlink_to(self.outside)
        owner = Mock(pw_uid=65534, pw_gid=65534)
        with patch.object(control, 'BASE', self.base), \
                patch.object(control.pwd, 'getpwnam', return_value=owner), \
                patch.object(control, 'command', return_value=Mock(returncode=0)):
            result = control.run({'op': 'configure-chat', 'session': {}})
        self.assertTrue(result['connected'])
        self.assertEqual(session.lstat().st_uid, owner.pw_uid)
        self.assertEqual(self.snapshot(self.outside), self.original)

    @unittest.skipUnless(os.geteuid() == 0, 'Requires root to check a real ownership change.')
    def test_submission_chown_does_not_follow_replaced_job_metadata(self):
        auth = self.base / 'auth'
        auth.mkdir()
        (auth / 'session.bin').write_bytes(b'Test fixture only')
        owner = Mock(pw_uid=65534, pw_gid=65534)
        ident, workspace_id = 'c' * 32, 'd' * 32

        def replace_with_link(path, value):
            broker.write_json(path, value)
            path.unlink()
            path.symlink_to(self.outside)

        with patch.object(control, 'BASE', self.base), \
                patch.object(control.pwd, 'getpwnam', return_value=owner), \
                patch.object(control, 'workspace', return_value=(self.base / 'workspace', {'id': workspace_id})), \
                patch.object(control, 'active_jobs', return_value=[]), \
                patch.object(control, 'ensure_mount'), \
                patch.object(control, 'write_json', side_effect=replace_with_link), \
                patch.object(control, 'command') as command:
            result = control.run({'op': 'submit', 'requestId': ident, 'workspace': workspace_id,
                                  'model': 'test-model', 'prompt': 'Fixture', 'policy': 'workspace-auto'})
        self.assertEqual(result['id'], ident)
        command.assert_called_once_with('systemctl', 'start', 'tinfoil-job@' + ident + '.service')
        self.assertEqual((self.base / 'jobs' / ident / 'job.json').lstat().st_uid, owner.pw_uid)
        self.assertEqual(self.snapshot(self.outside), self.original)


class ProfileTests(unittest.TestCase):
    def test_profile_is_fixed_allowlist(self):
        self.assertEqual(broker.profile_image('dev'), 'tinfoil-workbench-tools:1')
        self.assertEqual(broker.profile_image('kali'), 'tinfoil-workbench-kali:1')
        for bad in ('alpine', 'dev --privileged', None, {}, '../kali'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                broker.profile_image(bad)

    def test_uninstalled_image_refuses_creation(self):
        with patch.object(broker, 'command', return_value=Mock(returncode=1)):
            with self.assertRaisesRegex(ValueError, 'not installed'):
                broker.create('Test', 'kali')

    def test_worker_cannot_create_workspaces_or_operator_tools(self):
        with patch.dict(os.environ, {'SUDO_USER': 'tinfoil-runner'}):
            for op in ('create', 'delete', 'cleanup', 'operator-tool'):
                with self.subTest(op=op), self.assertRaisesRegex(ValueError, 'only container tools'):
                    broker.dispatch({'op': op, 'profile': 'kali'})

    def test_tool_profile_comes_only_from_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            for profile in (None, 'dev', 'kali'):
                meta = {'id': 'a' * 32}
                if profile is not None:
                    meta['toolProfile'] = profile
                with patch.object(broker, 'workspace', return_value=(Path(folder), meta)), \
                        patch.object(broker, 'ensure_mount'), patch.object(broker, 'network', return_value='owned'), \
                        patch.object(broker, 'write_json'), patch.object(broker, 'command'), \
                        patch.object(broker, 'container_output', return_value='{"ok":true,"result":{}}') as output:
                    broker.tool({'id': 'a' * 32, 'name': 'run_command', 'profile': 'attacker-image',
                                 'image': 'attacker-image', 'arguments': '{"command":"true"}'})
                    argv = output.call_args.args[0]
                    self.assertEqual(argv[-1], broker.IMAGES[profile or 'dev'])
                    self.assertIn('--read-only', argv)
                    self.assertIn('--cap-drop=ALL', argv)
                    self.assertIn('--memory=768m', argv)
                    self.assertNotIn('--privileged', argv)
                    self.assertFalse(any('docker.sock' in arg for arg in argv))

    def test_operator_execution_refuses_active_job(self):
        value = {'op': 'operator-tool', 'id': 'b' * 32, 'name': 'run_command', 'arguments': '{}'}
        with patch.object(control, 'workspace', return_value=(None, {'id': value['id']})), \
                patch.object(control, 'active_jobs', return_value=['job']), patch.object(control, 'dispatch') as dispatch:
            with self.assertRaisesRegex(ValueError, 'Stop'):
                control.run(value)
            dispatch.assert_not_called()
        with patch.object(control, 'workspace', return_value=(None, {'id': value['id']})), \
                patch.object(control, 'active_jobs', return_value=[]), patch.object(control, 'dispatch') as dispatch:
            control.run(value)
            dispatch.assert_called_once_with(dict(value, op='tool'))


if __name__ == '__main__':
    unittest.main()
