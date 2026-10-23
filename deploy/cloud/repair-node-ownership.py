#!/usr/bin/env python3
"""One-shot ownership repair, no network/shell/arguments; never executes Node.

Official source: https://nodejs.org/dist/v22.23.3/SHASUMS256.txt
Archive: https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-x64.tar.xz
Archive SHA verified by PM before pinning the executable identity below.
"""
import hashlib
import json
import os
import secrets
import stat
import sys
from contextlib import contextmanager

ARCHIVE_SHA256 = 'df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de'
NODE_SHA256 = 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
NODE_BYTES = 124827920
RUNTIME_PARTS = ('opt', 'flymind', 'runtime')
PREFIX = 'node-v22.23.3-linux-x64'


class RepairError(Exception):
    pass


def metadata(info, directory, protected=False):
    allowed = (0,) if protected else (0, 1000)
    if (not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or info.st_uid not in allowed or info.st_gid not in allowed
            or info.st_mode & 0o7022 or info.st_mode & 0o555 != 0o555):
        raise RepairError('UNSAFE_METADATA')
    if not directory and (info.st_size != NODE_BYTES or info.st_nlink != 1):
        raise RepairError('UNEXPECTED_NODE_FILE')


def same_entry(parent, name, descriptor):
    entry = os.stat(name, dir_fd=parent, follow_symlinks=False)
    opened = os.fstat(descriptor)
    if (entry.st_dev, entry.st_ino) != (opened.st_dev, opened.st_ino):
        raise RepairError('PATH_IDENTITY_CHANGED')


def checked_hash(descriptor):
    os.lseek(descriptor, 0, os.SEEK_SET)
    digest, size = hashlib.sha256(), 0
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > NODE_BYTES:
            raise RepairError('NODE_SIZE_MISMATCH')
        digest.update(chunk)
    if size != NODE_BYTES or digest.hexdigest() != NODE_SHA256:
        raise RepairError('NODE_HASH_MISMATCH')


def checked_copy(source, target):
    os.lseek(source, 0, os.SEEK_SET)
    total = 0
    while True:
        chunk = os.read(source, 1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > NODE_BYTES:
            raise RepairError('COPY_SIZE_MISMATCH')
        view = memoryview(chunk)
        while view:
            written = os.write(target, view)
            if written <= 0:
                raise RepairError('COPY_WRITE_FAILED')
            view = view[written:]
    # Re-read the staged inode, not just bytes observed from the mutable source.
    checked_hash(target)
    os.fsync(target)


@contextmanager
def runtime_directory():
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptor = os.open('/', flags)
    try:
        metadata(os.fstat(descriptor), True, True)
        for name in RUNTIME_PARTS:
            child = os.open(name, flags, dir_fd=descriptor)
            try:
                metadata(os.fstat(child), True, True)
            except BaseException:
                os.close(child)
                raise
            os.close(descriptor)
            descriptor = child
        yield descriptor
    finally:
        os.close(descriptor)


def repair(runtime):
    """Internal descriptor entry point for isolated tests; CLI exposes no path inputs."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    prefix = binary_dir = source = staged = None
    temporary = None
    try:
        prefix = os.open(PREFIX, flags, dir_fd=runtime)
        metadata(os.fstat(prefix), True)
        binary_dir = os.open('bin', flags, dir_fd=prefix)
        metadata(os.fstat(binary_dir), True)
        source = os.open('node', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=binary_dir)
        metadata(os.fstat(source), False)
        same_entry(runtime, PREFIX, prefix)
        same_entry(prefix, 'bin', binary_dir)
        same_entry(binary_dir, 'node', source)
        checked_hash(source)  # Before any chown, chmod or staging write.

        candidate = '.flymind-node-repair-' + secrets.token_hex(16)
        staged = os.open(candidate, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=runtime)
        temporary = candidate  # Only a file successfully created by this invocation is ours to unlink.
        checked_copy(source, staged)
        os.fchown(staged, 0, 0)
        os.fchmod(staged, 0o755)
        metadata(os.fstat(staged), False, True)
        checked_hash(staged)
        os.fsync(staged)

        same_entry(runtime, PREFIX, prefix)
        same_entry(prefix, 'bin', binary_dir)
        same_entry(binary_dir, 'node', source)
        metadata(os.fstat(prefix), True)
        metadata(os.fstat(binary_dir), True)
        metadata(os.fstat(source), False)
        os.fchown(prefix, 0, 0)
        # A former prefix owner could have swapped bin just before the chown.
        # Never operate on a now-detached old directory descriptor.
        same_entry(runtime, PREFIX, prefix)
        same_entry(prefix, 'bin', binary_dir)
        os.fchown(binary_dir, 0, 0)
        same_entry(prefix, 'bin', binary_dir)
        same_entry(binary_dir, 'node', source)
        metadata(os.fstat(prefix), True, True)
        metadata(os.fstat(binary_dir), True, True)
        os.fsync(prefix)
        same_entry(runtime, temporary, staged)
        os.replace(temporary, 'node', src_dir_fd=runtime, dst_dir_fd=binary_dir)
        temporary = None
        os.fsync(binary_dir)
        os.fsync(runtime)

        same_entry(runtime, PREFIX, prefix)
        same_entry(prefix, 'bin', binary_dir)
        same_entry(binary_dir, 'node', staged)
        metadata(os.fstat(staged), False, True)
        checked_hash(staged)
        with runtime_directory() as final_runtime:
            same_entry(final_runtime, PREFIX, prefix)
        return {'ok': True, 'version': '22.23.3', 'nodeSha256': NODE_SHA256,
                'nodeBytes': NODE_BYTES, 'nodeOwner': '0:0', 'nodeMode': '0755',
                'directoriesReowned': ['runtime/' + PREFIX, 'runtime/' + PREFIX + '/bin'],
                'atomicReplacement': True, 'processesRestarted': False}
    finally:
        try:
            if temporary is not None:
                os.unlink(temporary, dir_fd=runtime)
        finally:
            for descriptor in (staged, source, binary_dir, prefix):
                if descriptor is not None:
                    os.close(descriptor)


def main():
    if len(sys.argv) != 1 or sys.platform != 'linux' or not hasattr(os, 'geteuid') or os.geteuid() != 0:
        raise RepairError('LINUX_ROOT_NO_ARGUMENTS_REQUIRED')
    with runtime_directory() as runtime:
        return repair(runtime)


if __name__ == '__main__':
    try:
        print(json.dumps(main(), sort_keys=True))
    except Exception as error:
        # Never execute a verifier/installer after failure; emit only a safe category.
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, RepairError) else 'OS_SAFETY_CHECK_FAILED'}), file=sys.stderr)
        sys.exit(1)
