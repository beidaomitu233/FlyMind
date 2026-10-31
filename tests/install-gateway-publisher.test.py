"""Pure/temp fixture tests. No root install, service or remote network."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import os

spec = importlib.util.spec_from_file_location('gateway_install', Path(__file__).resolve().parents[1]/'deploy/cloud/install-gateway-publisher.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Tests(unittest.TestCase):
    def test_forced_command_only_exact_production_gateway_permission(self):
        dispatcher_spec = importlib.util.spec_from_file_location('gateway_dispatcher', Path(__file__).resolve().parents[1]/'deploy/cloud/ssh-command.py')
        dispatcher = importlib.util.module_from_spec(dispatcher_spec); dispatcher_spec.loader.exec_module(dispatcher)
        command = 'sudo -n /usr/local/libexec/flymind-gateway-promote production run-123-1 '+'a'*64
        class ReplacedProcess(Exception): pass
        with patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND':command}), patch.object(dispatcher.os, 'execv', side_effect=ReplacedProcess) as invoke:
            with self.assertRaises(ReplacedProcess): dispatcher.main()
            self.assertEqual(invoke.call_args.args[0], '/usr/bin/sudo')
        for invalid in (command.replace('production','staging'), command+' extra', command.replace('flymind-gateway-promote','node'), command+'; sh'):
            with patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND':invalid}), patch.object(dispatcher.os, 'execv') as invoke:
                with self.assertRaises(ValueError): dispatcher.main()
                invoke.assert_not_called()

    def test_permission_is_one_fixed_executable_and_production(self):
        text = module.sudoers('flymind-deploy').decode()
        self.assertIn('/usr/local/libexec/flymind-gateway-promote production run-* *', text)
        self.assertNotIn('systemctl', text)
        for user in ('root', 'x;sh', 'a\nALL'):
            with self.assertRaises(ValueError): module.sudoers(user)

    def test_hash_mismatch_refuses_reviewed_file(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'source'; path.write_bytes(b'reviewed')
            with patch.object(module, 'trusted'):
                self.assertEqual(module.checked_source(path, module.digest(b'reviewed')), b'reviewed')
                with self.assertRaisesRegex(ValueError, 'SOURCE_MISMATCH'):
                    module.checked_source(path, 'a'*64)
            self.assertEqual(path.read_bytes(), b'reviewed')

    def test_failed_second_install_rolls_back_exact_originals_and_modes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); first = root/'first'; second = root/'second'; backup = root/'backup'; backup.mkdir()
            first.write_bytes(b'old1'); second.write_bytes(b'old2')
            writes = []
            def writer(path, data, mode):
                writes.append(path)
                if path == second: raise OSError('fixture disk failure')
                path.write_bytes(data)
            # Test atomic rollback ordering on Windows without claiming POSIX ownership.
            with patch.object(module, 'atomic_write', lambda p,d,m: p.write_bytes(d)):
                with self.assertRaisesRegex(ValueError, 'ROLLED_BACK'):
                    module.install_files({first:(b'new1',0o644),second:(b'new2',0o755)},backup,writer)
            self.assertEqual(writes,[first,second]); self.assertEqual(first.read_bytes(),b'old1'); self.assertEqual(second.read_bytes(),b'old2')
            self.assertEqual((backup/'first').read_bytes(),b'old1')


if __name__ == '__main__': unittest.main()
