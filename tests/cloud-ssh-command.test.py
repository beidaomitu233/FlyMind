import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('flymind_ssh', Path(__file__).resolve().parents[1] / 'deploy/cloud/ssh-command.py')
ssh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ssh)


class Dispatched(Exception):
    pass


class ForcedCommandTests(unittest.TestCase):
    def test_only_exact_app_and_control_plane_command_identities_dispatch(self):
        for publisher in (ssh.PROMOTE, ssh.CONTROL_PLANE_PROMOTE):
            for environment in ('staging', 'production'):
                arguments = ['sudo', '-n', publisher, environment, 'run-123-1', 'a' * 64]
                with self.subTest(publisher=publisher, environment=environment):
                    with patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': ' '.join(arguments)}, clear=True), patch.object(ssh.os, 'execv', side_effect=Dispatched) as execute:
                        with self.assertRaises(Dispatched):
                            ssh.main()
                        execute.assert_called_once_with('/usr/bin/sudo', ['/usr/bin/sudo', '-n', publisher, *arguments[3:]])

    def test_arbitrary_sudo_shell_paths_modes_and_extra_arguments_are_rejected(self):
        good = 'sudo -n ' + ssh.CONTROL_PLANE_PROMOTE + ' production run-123-1 ' + 'a' * 64
        invalid = [good + ' extra', good + '; whoami', good.replace('production', 'other'), good.replace('run-123-1', '../other'), good.replace('run-123-1', 'x;id'), good.replace('a' * 64, 'A' * 64), good.replace(ssh.CONTROL_PLANE_PROMOTE, '/bin/sh'), good.replace(ssh.CONTROL_PLANE_PROMOTE, '/tmp/flymind-control-plane-promote'), good.replace('sudo -n', 'sudo -n -u root'), '/bin/bash', 'sftp', 'scp -t /tmp/upload']
        for command in invalid:
            with self.subTest(command=command):
                with patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': command}, clear=True), patch.object(ssh.os, 'execv') as execute:
                    with self.assertRaises(ValueError):
                        ssh.main()
                    execute.assert_not_called()

    def test_existing_stdin_upload_contract_is_unchanged(self):
        with patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': 'flymind-upload run-123-1 ' + 'a' * 64}, clear=True), patch.object(ssh, 'receive') as receive:
            ssh.main()
            receive.assert_called_once_with('run-123-1', 'a' * 64)


if __name__ == '__main__':
    unittest.main()
