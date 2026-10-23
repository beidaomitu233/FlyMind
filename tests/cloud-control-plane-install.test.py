"""Pure installer checks only; no root setup, services, DB or network."""
import hashlib
import importlib.util
import json
import os
import pathlib
import stat
import tempfile
import unittest
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'deploy/cloud/install-control-plane-actions.py'
spec = importlib.util.spec_from_file_location('cp_install', SOURCE)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def policy():
    return {'schemaVersion': 1, 'sourceCommit': 'a' * 40, 'jarSha256': 'b' * 64,
            'allowedMigrations': {'V1__baseline.sql': 'c' * 64}, 'verified': True}


def environment():
    return {'ADMIN_DB_JDBC_URL': 'jdbc:mysql://127.0.0.1:3306/fly_mind?useUnicode=true',
            'ADMIN_DB_USER': 'flymind_app', 'ADMIN_DB_PASSWORD': 'test-only-$password',
            'FLYMIND_GATEWAY_KEY': 'test-only-key-not-a-real-secret-32-bytes'}


class InstallerTests(unittest.TestCase):
    def setUp(self):
        # Windows only runs private temp-file logic; production refuses non-Linux.
        if not hasattr(installer.os, 'O_NOFOLLOW'):
            mock_flag = patch.object(installer.os, 'O_NOFOLLOW', 0, create=True)
            mock_flag.start()
            self.addCleanup(mock_flag.stop)

    def test_environment_literal_not_executed_and_duplicate_or_escaping_rejected(self):
        parsed = installer.parse_environment('# comment\nADMIN_DB_PASSWORD="$(must-not-run)`literal`"\nEMPTY=\n')
        self.assertEqual(parsed['ADMIN_DB_PASSWORD'], '$(must-not-run)`literal`')
        self.assertEqual(parsed['EMPTY'], '')
        for text in ('A=1\nA=2', 'export A=1', 'A="unterminated', 'A=one\\two'):
            with self.assertRaises(installer.SetupError):
                installer.parse_environment(text)

    def test_database_is_only_loopback_fixed_fly_mind(self):
        self.assertEqual(installer.database_binding(environment()['ADMIN_DB_JDBC_URL']), ('127.0.0.1', 3306))
        for url in ('jdbc:mysql://remote:3306/fly_mind', 'jdbc:mysql://127.0.0.1/flymind',
                    'jdbc:mysql://root:pass@localhost/fly_mind', 'jdbc:mysql://localhost/fly_mind?password=override',
                    'jdbc:mysql://localhost/fly_mind?socketFactory=evil', 'jdbc:postgresql://localhost/fly_mind'):
            with self.assertRaises(installer.SetupError):
                installer.database_binding(url)

    def test_policy_must_be_actual_verified_runtime_evidence_and_same_source(self):
        self.assertEqual(installer.validate_policy(policy(), 'a' * 40), policy())
        for value in ({**policy(), 'verified': False}, {**policy(), 'sourceCommit': 'd' * 40},
                      {**policy(), 'jarSha256': 'bad'}, {**policy(), 'allowedMigrations': {'../bad.sql': 'c' * 64}},
                      {**policy(), 'untrustedExtra': True}):
            with self.assertRaises(installer.SetupError):
                installer.validate_policy(value, 'a' * 40)

    def test_private_material_preserves_literal_secret_and_default_stop_policy(self):
        material = installer.private_material(environment(), policy())
        config = json.loads(material[installer.PRIVATE + '/control-plane-deployment.json'])
        self.assertEqual(config['rollbackPolicy'], 'stop-on-failure')
        self.assertEqual(config['pythonExecutable'], '/usr/bin/python3')
        self.assertEqual(config['allowedMigrations'], policy()['allowedMigrations'])
        self.assertIn(b'password="test-only-$password"', material[installer.PRIVATE + '/mysql-backup.cnf'])
        self.assertEqual(material[installer.PRIVATE + '/control-plane-readiness.key'], environment()['FLYMIND_GATEWAY_KEY'].encode())
        self.assertNotIn(environment()['ADMIN_DB_PASSWORD'], material[installer.PRIVATE + '/control-plane-deployment.json'].decode())

    def test_root_db_bootstrap_mismatch_and_external_listener_refused(self):
        for changed in ({'ADMIN_DB_USER': 'root'}, {'FLYMIND_BOOTSTRAP_ENABLED': 'true'},
                        {'ADMIN_BIND_ADDRESS': '0.0.0.0'}, {'ADMIN_PORT': '99999'},
                        {'SPRING_FLYWAY_URL': 'jdbc:mysql://localhost/another'}, {'FLYMIND_GATEWAY_KEY': 'short'}):
            with self.assertRaises(installer.SetupError):
                installer.private_material({**environment(), **changed}, policy())

    def test_mysql_cnf_quotes_without_shell_interpretation(self):
        self.assertEqual(installer.cnf_quote('a"b\\c$'), '"a\\"b\\\\c$"')
        with self.assertRaises(installer.SetupError):
            installer.cnf_quote('line\nnext')

    def test_sudoers_is_exact_executable_not_generic_shell(self):
        text = installer.sudoers_content('flymind-deploy').decode()
        self.assertIn('/usr/local/libexec/flymind-control-plane-promote production run-* *', text)
        self.assertNotIn('/bin/sh', text)
        self.assertNotIn('ALL=(ALL)', text)
        self.assertEqual(installer.BASH, '/usr/bin/bash')
        helper = installer.backup_helper((SOURCE.parent / 'control-plane-backup.sh.example').read_text(encoding='utf-8'))
        self.assertEqual(helper.splitlines()[0], b'#!/usr/bin/bash')
        self.assertIn(b'readonly database=fly_mind', helper)
        for user in ('root', 'name;command', '../other'):
            with self.assertRaises(installer.SetupError):
                installer.sudoers_content(user)

    def test_private_file_same_bytes_reused_but_different_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix='flymind-install-test-') as directory:
            path = pathlib.Path(directory) / 'private'
            self.assertTrue(installer.immutable_private_file(path, b'original'))
            # Parent trust is tested by privileged boundary, not faked on Windows.
            with patch.object(installer, 'read_protected', side_effect=lambda p, **kw: pathlib.Path(p).read_bytes()):
                self.assertFalse(installer.immutable_private_file(path, b'original'))
                with self.assertRaises(installer.SetupError):
                    installer.immutable_private_file(path, b'new-secret')
            self.assertEqual(path.read_bytes(), b'original')

    def test_failed_managed_install_restores_original_forcedcommand_and_removes_new_rule(self):
        with tempfile.TemporaryDirectory(prefix='flymind-install-test-') as directory:
            root = pathlib.Path(directory)
            forced = root / 'forced.py'
            sudo = root / 'sudoers'
            forced.write_bytes(b'old forced command')
            if os.name == 'posix':
                forced.chmod(0o755)
            changes = []
            write = installer.write_exclusive
            # POSIX 0440 becomes Windows read-only, which would block test cleanup;
            # test rollback bytes here, not Windows' non-POSIX mode translation.
            temp_write = lambda p, value, mode: write(p, value, mode | 0o200 if installer.os.name == 'nt' else mode)
            with patch.object(installer, 'check_root_path'), patch.object(installer, 'read_protected', side_effect=lambda p, **kw: pathlib.Path(p).read_bytes()), patch.object(installer, 'write_exclusive', side_effect=temp_write):
                installer.atomic_code_install(forced, b'new forced command', 0o755, root, changes)
                installer.atomic_code_install(sudo, b'new exact rule', 0o440, root, changes)
                installer.restore_changes(changes)
            self.assertEqual(forced.read_bytes(), b'old forced command')
            if os.name == 'posix':
                self.assertEqual(stat.S_IMODE(forced.stat().st_mode), 0o755)
            self.assertFalse(sudo.exists())
            self.assertEqual((root / 'previous-0').read_bytes(), b'old forced command')

    @unittest.skipUnless(os.name == 'posix', 'Requires actual POSIX permission semantics')
    def test_explicit_modes_survive_umask_077(self):
        previous_umask = os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory(prefix='flymind-install-mode-test-') as directory:
                for mode in (0o440, 0o755, 0o644, 0o600):
                    path = pathlib.Path(directory) / oct(mode)
                    installer.write_exclusive(path, b'non-secret fixture', mode)
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), mode)
                    self.assertEqual(path.read_bytes(), b'non-secret fixture')
        finally:
            os.umask(previous_umask)


if __name__ == '__main__':
    unittest.main()
