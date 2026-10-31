#!/usr/bin/python3
"""One-time reviewed root-console install. Only static gateway publication rights.

Download the two reviewed source files first; supply their pinned SHA256 and the
installed dispatcher SHA explicitly. This installer never downloads/executes a
candidate, starts a service, changes env/SQL/SSH keys, or invokes promotion.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import uuid

NODE = '/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node'
LIBEXEC = Path('/usr/local/libexec')
DISPATCHER = LIBEXEC/'flymind-ssh-command.py'
SUDOERS = Path('/etc/sudoers.d/flymind-gateway')


def require(ok, code):
    if not ok:
        raise ValueError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def trusted(path, directory=False):
    path = Path(path)
    for p in (path, *path.parents):
        s = p.lstat()
        require(not stat.S_ISLNK(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
                'GATEWAY_INSTALL_UNTRUSTED_PATH')
        require(stat.S_ISDIR(s.st_mode) if p != path or directory else stat.S_ISREG(s.st_mode),
                'GATEWAY_INSTALL_PATH_TYPE')


def sudoers(user):
    require(bool(re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', user)) and user != 'root', 'GATEWAY_DEPLOY_USER_INVALID')
    return (user+' ALL=(root) NOPASSWD: /usr/local/libexec/flymind-gateway-promote production run-* *\n').encode()


def checked_source(path, expected):
    require(bool(re.fullmatch(r'[a-f0-9]{64}', expected)), 'GATEWAY_INSTALL_HASH_INVALID')
    trusted(path)
    with open(path, 'rb') as source:
        data = source.read(262145)
    require(len(data) <= 262144 and digest(data) == expected, 'GATEWAY_INSTALL_SOURCE_MISMATCH')
    return data


def atomic_write(path, data, mode):
    temporary = path.parent/('.gateway-install-'+str(uuid.uuid4()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as output:
            output.write(data); output.flush(); os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def install_files(files, backup, write=atomic_write):
    snapshots = {}
    for path, (data, mode) in files.items():
        try:
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode), 'GATEWAY_INSTALL_TARGET_TYPE')
            snapshots[path] = (path.read_bytes(), stat.S_IMODE(info.st_mode))
        except FileNotFoundError:
            snapshots[path] = None
    for path, prior in snapshots.items():
        if prior is not None:
            atomic_write(backup/path.name, prior[0], 0o600)
    changed = []
    try:
        for path, (data, mode) in files.items():
            changed.append(path); write(path, data, mode)
    except Exception:
        for path in reversed(changed):
            prior = snapshots[path]
            if prior is None:
                path.unlink()
            else:
                atomic_write(path, *prior)
        raise ValueError('GATEWAY_STATIC_INSTALL_ROLLED_BACK') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-directory', required=True)
    parser.add_argument('--publisher-sha256', required=True)
    parser.add_argument('--dispatcher-sha256', required=True)
    parser.add_argument('--old-dispatcher-sha256', required=True)
    parser.add_argument('--deploy-user', default='flymind-deploy')
    args = parser.parse_args()
    require(sys.platform == 'linux' and os.geteuid() == 0, 'GATEWAY_INSTALL_LINUX_ROOT_REQUIRED')
    for directory in (LIBEXEC, SUDOERS.parent, Path('/etc/flymind/production'), Path('/opt/flymind/gateway')):
        trusted(directory, True)
    trusted(NODE)
    source = Path(args.source_directory)
    trusted(source, True)
    publisher = checked_source(source/'gateway-promote.mjs', args.publisher_sha256)
    dispatcher = checked_source(source/'ssh-command.py', args.dispatcher_sha256)
    # Exact preimage guard: never overwrite a dispatcher changed since review.
    checked_source(DISPATCHER, args.old_dispatcher_sha256)
    compile(dispatcher, 'reviewed-ssh-command.py', 'exec')
    wrapper = ('#!/bin/sh\nexec '+NODE+' /usr/local/libexec/flymind-gateway-promote.mjs "$@"\n').encode()
    files = {LIBEXEC/'flymind-gateway-promote.mjs': (publisher, 0o644),
             LIBEXEC/'flymind-gateway-promote': (wrapper, 0o755),
             DISPATCHER: (dispatcher, 0o755), SUDOERS: (sudoers(args.deploy_user), 0o440)}
    for path in files:
        if path.exists() or path.is_symlink():
            trusted(path)
    config_path = Path('/etc/flymind/production/deployment.json')
    cp_path = Path('/etc/flymind/production/control-plane-deployment.json')
    locks = []
    try:
        for config, name in ((config_path, '.deploy.lock'), (cp_path, '.control-plane.lock')):
            trusted(config)
            state = Path(json.loads(config.read_text())['stateDirectory'])
            require(state.is_absolute(), 'GATEWAY_INSTALL_STATE_INVALID'); trusted(state, True)
            lock = state/name
            lock.mkdir(mode=0o700); locks.append(lock)  # never remove an existing lock
        with tempfile.TemporaryDirectory(prefix='.gateway-install-', dir=LIBEXEC) as staging:
            staging = Path(staging)
            (staging/'publisher.mjs').write_bytes(publisher)
            (staging/'sudoers').write_bytes(sudoers(args.deploy_user))
            subprocess.run([NODE, '--check', str(staging/'publisher.mjs')], check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['/usr/sbin/visudo', '-cf', str(staging/'sudoers')], check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            backup = LIBEXEC/('.gateway-backup-'+str(uuid.uuid4())); backup.mkdir(mode=0o700)
            install_files(files, backup)
        print(json.dumps({'status': 'GATEWAY_PUBLISHER_READY', 'serviceChanged': False, 'backups': str(backup)}))
    finally:
        for lock in reversed(locks):
            lock.rmdir()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('GATEWAY_INSTALL_REFUSED (no promotion executed)', file=sys.stderr)
        sys.exit(1)
