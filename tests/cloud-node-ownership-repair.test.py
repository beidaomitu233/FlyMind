"""Pure/temporary-byte fixtures only: not evidence of real Linux root execution."""
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('repair_node', Path(__file__).resolve().parents[1] / 'deploy/cloud/repair-node-ownership.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


def info(directory=False, **changes):
    result = dict(st_mode=(stat.S_IFDIR if directory else stat.S_IFREG) | 0o755,
                  st_uid=1000, st_gid=1000, st_size=repair.NODE_BYTES, st_nlink=1,
                  st_dev=1, st_ino=2)
    result.update(changes)
    return SimpleNamespace(**result)


class NodeRepairTests(unittest.TestCase):
    def setUp(self):
        # Only mocked-syscall orchestration uses these flags on Windows. No real
        # directory-fd operation or root ownership is simulated as OS evidence.
        for name in ('O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC', 'O_NONBLOCK'):
            if not hasattr(repair.os, name):
                mock_flag = patch.object(repair.os, name, 0, create=True)
                mock_flag.start()
                self.addCleanup(mock_flag.stop)

    def test_exact_official_identity_and_no_caller_arguments(self):
        self.assertEqual(repair.NODE_SHA256, 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48')
        self.assertEqual(repair.NODE_BYTES, 124827920)
        self.assertEqual(repair.RUNTIME_PARTS, ('opt', 'flymind', 'runtime'))
        self.assertEqual(repair.PREFIX, 'node-v22.23.3-linux-x64')
        with patch.object(repair.sys, 'argv', ['repair.py', '/arbitrary']), patch.object(repair, 'runtime_directory') as open_root:
            with self.assertRaises(repair.RepairError):
                repair.main()
            open_root.assert_not_called()

    def test_owner_modes_types_links_and_root_parent_are_fail_closed(self):
        repair.metadata(info(), False)
        repair.metadata(info(True, st_uid=0, st_gid=0), True, True)
        for changes in ({'st_uid': 1001}, {'st_gid': 1001}, {'st_mode': stat.S_IFREG | 0o777},
                        {'st_mode': stat.S_IFLNK | 0o755}, {'st_mode': stat.S_IFREG | 0o4755},
                        {'st_nlink': 2}, {'st_size': 1}):
            with self.subTest(changes=changes), self.assertRaises(repair.RepairError):
                repair.metadata(info(**changes), False)
        with self.assertRaises(repair.RepairError):
            repair.metadata(info(True), True, True)

    def test_copy_rehashes_real_staged_bytes_and_rejects_mutated_source(self):
        data = b'isolated official fixture\n' * 20
        with tempfile.TemporaryDirectory() as root, patch.object(repair, 'NODE_BYTES', len(data)), patch.object(repair, 'NODE_SHA256', hashlib.sha256(data).hexdigest()):
            source_path, target_path = Path(root) / 'source', Path(root) / 'target'
            source_path.write_bytes(data)
            with source_path.open('rb') as source, target_path.open('w+b') as target:
                repair.checked_hash(source.fileno())
                repair.checked_copy(source.fileno(), target.fileno())
                self.assertEqual(target_path.read_bytes(), data)
                # A retained writer can mutate the old inode after its first valid hash.
                source_path.write_bytes(b'x' * len(data))
                target.seek(0); target.truncate()
                with self.assertRaisesRegex(repair.RepairError, 'HASH_MISMATCH'):
                    repair.checked_copy(source.fileno(), target.fileno())

    def test_descriptor_identity_must_match_current_path(self):
        with patch.object(repair.os, 'stat', return_value=info(st_ino=3)), patch.object(repair.os, 'fstat', return_value=info(st_ino=2)):
            with self.assertRaisesRegex(repair.RepairError, 'PATH_IDENTITY_CHANGED'):
                repair.same_entry(1, 'bin', 2)

    def test_initial_hash_mismatch_has_zero_mutations(self):
        with patch.object(repair.os, 'open', side_effect=[101, 102, 103]) as opened, patch.object(repair.os, 'close'), patch.object(repair.os, 'fstat'), patch.object(repair, 'metadata'), patch.object(repair, 'same_entry'), patch.object(repair, 'checked_hash', side_effect=repair.RepairError('NODE_HASH_MISMATCH')), patch.object(repair.os, 'fchown', create=True) as chown, patch.object(repair.os, 'replace') as replace, patch.object(repair.os, 'unlink') as unlink:
            with self.assertRaisesRegex(repair.RepairError, 'HASH_MISMATCH'):
                repair.repair(100)
            self.assertEqual(opened.call_count, 3)  # No staged file created.
            chown.assert_not_called(); replace.assert_not_called(); unlink.assert_not_called()

    def test_copy_failure_cleans_only_own_staged_file_without_chown_or_replace(self):
        with patch.object(repair.os, 'open', side_effect=[101, 102, 103, 104]), patch.object(repair.os, 'close'), patch.object(repair.os, 'fstat'), patch.object(repair, 'metadata'), patch.object(repair, 'same_entry'), patch.object(repair, 'checked_hash'), patch.object(repair, 'checked_copy', side_effect=repair.RepairError('NODE_HASH_MISMATCH')), patch.object(repair.os, 'fchown', create=True) as chown, patch.object(repair.os, 'replace') as replace, patch.object(repair.os, 'unlink') as unlink:
            with self.assertRaisesRegex(repair.RepairError, 'HASH_MISMATCH'):
                repair.repair(100)
            chown.assert_not_called(); replace.assert_not_called()
            self.assertEqual(unlink.call_count, 1)
            self.assertTrue(unlink.call_args.args[0].startswith('.flymind-node-repair-'))
            self.assertEqual(unlink.call_args.kwargs, {'dir_fd': 100})

    def test_failed_exclusive_create_does_not_unlink_another_invocations_file(self):
        with patch.object(repair.os, 'open', side_effect=[101, 102, 103, FileExistsError()]), patch.object(repair.os, 'close'), patch.object(repair.os, 'fstat'), patch.object(repair, 'metadata'), patch.object(repair, 'same_entry'), patch.object(repair, 'checked_hash'), patch.object(repair.os, 'unlink') as unlink:
            with self.assertRaises(FileExistsError):
                repair.repair(100)
            unlink.assert_not_called()

    def test_bin_swapped_at_prefix_chown_never_writes_detached_bin(self):
        with patch.object(repair.os, 'open', side_effect=[101, 102, 103, 104]), patch.object(repair.os, 'close'), patch.object(repair.os, 'fstat'), patch.object(repair, 'metadata'), patch.object(repair, 'same_entry', side_effect=[None] * 7 + [repair.RepairError('PATH_IDENTITY_CHANGED')]), patch.object(repair, 'checked_hash'), patch.object(repair, 'checked_copy'), patch.object(repair.os, 'fsync'), patch.object(repair.os, 'fchmod', create=True), patch.object(repair.os, 'fchown', create=True) as chown, patch.object(repair.os, 'replace') as replace, patch.object(repair.os, 'unlink') as unlink:
            with self.assertRaisesRegex(repair.RepairError, 'PATH_IDENTITY_CHANGED'):
                repair.repair(100)
            self.assertEqual([call.args[0] for call in chown.call_args_list], [104, 101])
            replace.assert_not_called(); unlink.assert_called_once()


if __name__ == '__main__':
    unittest.main()
