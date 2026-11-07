import importlib.util
import io
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('resource_boundary', ROOT / 'deploy/cloud/install-resource-boundary.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FixtureTests(unittest.TestCase):
    def test_embedded_files_match_reviewed_templates(self):
        for name, content in MODULE.FILES.items():
            self.assertEqual((ROOT / 'deploy/cloud/systemd' / name).read_bytes().replace(b'\r\n', b'\n'), content)

    def test_live_checks_slice_swap_and_fails_when_missing(self):
        def systemctl(args, **_kwargs):
            key = next(arg for arg in args if arg.startswith('--property='))
            names = ('flymind-application.service', 'flymind-gateway.service', 'flymind-control-plane.service')
            value = {'--property=Slice': 'flymind.slice', '--property=ActiveState': 'active',
                     '--property=MainPID': str(123 + names.index(args[-1]))}[key]
            return SimpleNamespace(stdout=value.encode('ascii'))

        values = {'memory.high': '1543503872', 'memory.max': '1610612736', 'memory.swap.max': '0'}
        def fake_open(path, **_kwargs):
            if path.startswith('/sys/fs/cgroup/flymind.slice/'):
                name = path.rsplit('/', 1)[-1]
                if name not in values:
                    raise FileNotFoundError(name)
                return io.StringIO(values[name])
            names = ('flymind-application.service', 'flymind-gateway.service', 'flymind-control-plane.service')
            for index, name in enumerate(names):
                if path == f'/proc/{123 + index}/cgroup':
                    return io.StringIO('0::/flymind.slice/' + name)
            raise AssertionError(path)

        with patch.object(MODULE.subprocess, 'run', side_effect=systemctl), patch('builtins.open', side_effect=fake_open):
            MODULE.verify_live()
            values['memory.swap.max'] = 'max'
            with self.assertRaisesRegex(RuntimeError, 'LIVE_LIMIT_MISMATCH'):
                MODULE.verify_live()
            del values['memory.swap.max']
            with self.assertRaises(FileNotFoundError):
                MODULE.verify_live()


@unittest.skipUnless(os.name == 'posix' and hasattr(os, 'O_NOFOLLOW') and os.open in os.supports_dir_fd,
                     'requires POSIX openat/no-follow')
class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
        self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY)
        self.uid = os.getuid()

    def tearDown(self):
        os.close(self.fd)
        self.tmp.cleanup()

    def test_create_verify_and_repeat(self):
        MODULE.apply_files(self.fd, self.uid, True)
        MODULE.apply_files(self.fd, self.uid, False)
        MODULE.apply_files(self.fd, self.uid, True)
        for name, content in MODULE.FILES.items():
            target = self.path / name
            self.assertEqual(target.read_bytes(), content)
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)

    def test_conflict_checked_before_any_creation(self):
        parent = self.path / 'flymind-gateway.service.d'
        parent.mkdir()
        (parent / '10-flymind-slice.conf').write_bytes(b'unknown')
        with self.assertRaises(RuntimeError):
            MODULE.apply_files(self.fd, self.uid, True)
        self.assertFalse((self.path / 'flymind.slice').exists())

    def test_symlink_and_writable_directory_rejected(self):
        (self.path / 'flymind.slice').symlink_to(self.path / 'missing')
        with self.assertRaises(OSError):
            MODULE.apply_files(self.fd, self.uid, True)
        (self.path / 'flymind.slice').unlink()
        parent = self.path / 'flymind-gateway.service.d'
        parent.mkdir(mode=0o777)
        parent.chmod(0o777)
        with self.assertRaises(RuntimeError):
            MODULE.apply_files(self.fd, self.uid, True)

    def test_verify_missing_and_unsafe_mode(self):
        with self.assertRaises(RuntimeError):
            MODULE.apply_files(self.fd, self.uid, False)
        MODULE.apply_files(self.fd, self.uid, True)
        (self.path / 'flymind.slice').chmod(0o666)
        with self.assertRaises(RuntimeError):
            MODULE.apply_files(self.fd, self.uid, False)


if __name__ == '__main__':
    unittest.main()
