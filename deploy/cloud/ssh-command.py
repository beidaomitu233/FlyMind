#!/usr/bin/python3
"""Root-owned forced SSH command: receive one archive or invoke fixed promotion."""
import hashlib
import json
import os
import re
import shlex
import stat
import sys
import uuid
import importlib.util

INCOMING = '/var/lib/flymind/incoming'
PROMOTE = '/usr/local/libexec/flymind-promote'
MAX_BYTES = 2_000_000_000
RELEASE = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\Z')
DIGEST = re.compile(r'[a-f0-9]{64}\Z')


def existing_matches(directory, name, digest):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    except FileNotFoundError:
        return False
    with os.fdopen(fd, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError('Existing upload is not a regular file')
        hasher = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(block)
        if hasher.hexdigest() != digest:
            raise ValueError('Release id already has a different archive')
    return True


def receive(release, digest):
    directory = os.open(INCOMING, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = '.upload-' + str(uuid.uuid4())
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        length = 0
        hasher = hashlib.sha256()
        with os.fdopen(fd, 'wb') as target:
            for block in iter(lambda: sys.stdin.buffer.read(1024 * 1024), b''):
                length += len(block)
                if length > MAX_BYTES:
                    raise ValueError('Archive exceeds upload budget')
                hasher.update(block)
                target.write(block)
            target.flush()
            os.fsync(target.fileno())
        if length == 0 or hasher.hexdigest() != digest:
            raise ValueError('Upload digest mismatch')
        name = release + '.tar.gz'
        try:
            os.link(temporary, name, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
        except FileExistsError:
            if not existing_matches(directory, name, digest):
                raise ValueError('Existing upload cannot be reused')
        print(json.dumps({'uploaded': True, 'releaseId': release, 'bytes': length, 'sha256': digest}))
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.close(directory)


def main():
    args = shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if len(args) == 3 and args[0] == 'flymind-upload' and RELEASE.fullmatch(args[1]) and DIGEST.fullmatch(args[2]):
        receive(args[1], args[2])
        return
    if len(args) == 3 and args[0] == 'flymind-fetch' and RELEASE.fullmatch(args[1]) and DIGEST.fullmatch(args[2]):
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise ValueError('Artifact metadata budget exceeded')
        module_path = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'artifact-fetch.py')
        # Helper is installed separately by root, never loaded from incoming.
        check = module_path
        while True:
            info = os.lstat(check)
            if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or (check == module_path and not stat.S_ISREG(info.st_mode)):
                raise ValueError('Artifact helper ownership invalid')
            if check == '/':
                break
            check = os.path.dirname(check)
        spec = importlib.util.spec_from_file_location('flymind_artifact_fetch', module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        try:
            result = module.fetch_artifact(args[1], args[2], json.loads(raw), INCOMING, existing_matches)
        except Exception:
            # URLs/queries/HTTP exception text are capability-bearing; no echo.
            raise ValueError('Artifact fetch refused; no archive published') from None
        print(json.dumps(result))
        return
    if len(args) == 6 and args[:3] == ['sudo', '-n', PROMOTE] and args[3] in ('staging', 'production') and RELEASE.fullmatch(args[4]) and DIGEST.fullmatch(args[5]):
        os.execv('/usr/bin/sudo', ['/usr/bin/sudo', '-n', PROMOTE, *args[3:]])
    raise ValueError('Only FlyMind restricted artifact transfer and fixed promotion are allowed')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print('FlyMind SSH refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
