#!/usr/bin/env python3
"""One-time, offline file preparation from an independently verified Linux bundle.

No service startup, database access, credentials, sudoers or network operations.
Existing targets are never replaced. Failure retains any files already created.
"""
import hashlib
import grp
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import sys

NODE = Path('/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node')
VERIFIER = Path('/root/flymind-install/verify-cloud-candidate.mjs')
BOUNDARY_INSTALLER = Path('/root/flymind-install/install-resource-boundary.py')
OPT = Path('/opt/flymind')
DATA = Path('/var/lib/flymind')
ETC = Path('/etc/flymind')
BACKUP = Path('/var/backups/flymind')
SYSTEM = Path('/etc/systemd/system')
SERVICES = ('flymind-application.service', 'flymind-gateway.service', 'flymind-control-plane.service')

APP = '''[Unit]
Description=FlyMind drawing application (one active writer)
After=network-online.target flymind-control-plane.service

[Service]
Type=simple
User=flymind
Group=flymind
WorkingDirectory=/opt/flymind/current/application
EnvironmentFile=/etc/flymind/production/application.env
Environment=NODE_ENV=production
Environment=FLYMIND_CLOUD_REQUIRE_PREPARED_BUNDLE=1
ExecStart=/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node lib/server/cloud/start.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=250
KillSignal=SIGTERM
KillMode=mixed
SendSIGKILL=no
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/flymind/production
UMask=0077

[Install]
WantedBy=multi-user.target
'''
GATEWAY = '''[Unit]
Description=FlyMind stable MCP ingress
After=network-online.target flymind-control-plane.service

[Service]
Type=simple
User=flymind
Group=flymind
WorkingDirectory=/opt/flymind/gateway/application
EnvironmentFile=/etc/flymind/production/gateway.env
Environment=NODE_ENV=production
ExecStart=/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node lib/server/cloud/mcp-gateway-start.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=160
KillSignal=SIGTERM
KillMode=mixed
SendSIGKILL=no
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
UMask=0077

[Install]
WantedBy=multi-user.target
'''
JAVA = '''[Unit]
Description=FlyMind Java control plane
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=flymind
Group=flymind
WorkingDirectory=/opt/flymind/control-plane
EnvironmentFile=/etc/flymind/control-plane.env
ExecStart=/usr/bin/java -Dfile.encoding=UTF-8 -jar /opt/flymind/control-plane/system-admin.jar
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
SuccessExitStatus=143
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
UMask=0077

[Install]
WantedBy=multi-user.target
'''


def trusted(path, directory=False):
    path = Path(path)
    if not path.is_absolute() or str(path) != os.path.normpath(str(path)) or Path(os.path.realpath(path)) != path:
        raise RuntimeError('UNTRUSTED_PATH')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise RuntimeError('UNTRUSTED_PATH')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise RuntimeError('UNTRUSTED_DIRECTORY')
        elif not stat.S_ISREG(info.st_mode):
            raise RuntimeError('UNTRUSTED_FILE')


def run(args):
    subprocess.run(args, check=True, timeout=600, stdin=subprocess.DEVNULL,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})


def create_file(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
    finally:
        os.close(fd)


def create_dir(path, mode):
    path.mkdir(mode=mode)
    os.chmod(path, mode)


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    if sys.platform != 'linux' or os.geteuid() != 0 or len(sys.argv) != 3:
        raise RuntimeError('USE_ROOT_LINUX_CANDIDATE_AND_MANIFEST_SHA')
    candidate, expected = Path(sys.argv[1]), sys.argv[2]
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise RuntimeError('MANIFEST_SHA_INVALID')
    for path in (NODE, VERIFIER, BOUNDARY_INSTALLER):
        trusted(path)
    trusted(candidate, directory=True)
    metadata = candidate / 'candidate.json'
    trusted(metadata)
    if metadata.stat().st_size > 2 * 1024 * 1024:
        raise RuntimeError('MANIFEST_MISMATCH')
    raw = metadata.read_bytes()
    if len(raw) > 2 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != expected:
        raise RuntimeError('MANIFEST_MISMATCH')
    manifest = json.loads(raw)
    release = manifest.get('releaseId')
    if not isinstance(release, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', release) or manifest.get('prepared') is not True or manifest.get('dirty') is not False or manifest.get('platform') != 'linux':
        raise RuntimeError('CANDIDATE_NOT_PREPARED')
    identity = pwd.getpwnam('flymind')
    group = grp.getgrnam('flymind')
    if identity.pw_uid == 0 or group.gr_gid == 0:
        raise RuntimeError('FLYMIND_IDENTITY_INVALID')
    for path in (OPT, OPT / 'runtime', DATA.parent, ETC.parent, BACKUP.parent, SYSTEM):
        trusted(path, directory=True)
    absent = [OPT / 'releases', OPT / 'current', OPT / 'gateway', OPT / 'control-plane', DATA, ETC, BACKUP]
    absent += [SYSTEM / service for service in SERVICES]
    if any(os.path.lexists(path) for path in absent):
        raise RuntimeError('TARGET_ALREADY_EXISTS')
    # Existing slice/drop-ins are accepted only if the reviewed boundary
    # installer confirms every fixed file, ownership and mode exactly.
    run(['/usr/bin/python3', str(BOUNDARY_INSTALLER), '--verify-files'])
    for service in SERVICES:
        result = subprocess.run(['/usr/bin/systemctl', 'show', '--property=LoadState', '--value', service],
                                check=True, timeout=10, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if result.stdout.strip() != b'not-found':
            raise RuntimeError('EXISTING_SERVICE')
    # Only the separately reviewed root-owned verifier is executable code here.
    code = "import {verifyCandidate} from 'file:///root/flymind-install/verify-cloud-candidate.mjs';await verifyCandidate(process.argv[1],{requireRootOwned:true})"
    run([str(NODE), '--input-type=module', '-e', code, str(candidate)])
    jar = candidate / 'control-plane/system-admin.jar'
    trusted(jar)
    jars = [entry for entry in manifest.get('files', []) if isinstance(entry, dict) and entry.get('path') == 'control-plane/system-admin.jar']
    if len(jars) != 1 or jars[0].get('type') is not None or not re.fullmatch(r'[a-f0-9]{64}', jars[0].get('sha256', '')):
        raise RuntimeError('JAR_MANIFEST_INVALID')
    create_dir(OPT / 'releases', 0o755)
    target = OPT / 'releases' / release
    shutil.copytree(candidate, target, symlinks=True)
    run([str(NODE), '--input-type=module', '-e', code, str(target)])
    if hashlib.sha256((target / 'candidate.json').read_bytes()).hexdigest() != expected:
        raise RuntimeError('COPIED_MANIFEST_MISMATCH')
    create_dir(OPT / 'control-plane', 0o755)
    shutil.copyfile(target / 'control-plane/system-admin.jar', OPT / 'control-plane/system-admin.jar', follow_symlinks=False)
    os.chmod(OPT / 'control-plane/system-admin.jar', 0o644)
    if file_digest(OPT / 'control-plane/system-admin.jar') != jars[0]['sha256']:
        raise RuntimeError('JAR_COPY_MISMATCH')
    create_dir(OPT / 'gateway', 0o755)
    os.symlink(str(target / 'application'), OPT / 'gateway/application')
    os.symlink(str(target), OPT / 'current')
    create_dir(DATA, 0o755)
    create_dir(DATA / 'production', 0o755)
    create_dir(DATA / 'production/diagrams', 0o700)
    os.chown(DATA / 'production/diagrams', identity.pw_uid, group.gr_gid)
    create_dir(DATA / 'production/deployments', 0o700)
    create_dir(DATA / 'production/control-plane-deployments', 0o700)
    create_dir(DATA / 'incoming', 0o700)
    create_dir(ETC, 0o700)
    create_dir(ETC / 'production', 0o700)
    create_dir(BACKUP, 0o700)
    create_dir(BACKUP / 'production', 0o700)
    create_dir(BACKUP / 'production-mysql', 0o700)
    for service, text in zip(SERVICES, (APP, GATEWAY, JAVA)):
        create_file(SYSTEM / service, text.encode('utf-8'))
    run(['/usr/bin/python3', str(BOUNDARY_INSTALLER), '--install'])
    print('FIRST_BUNDLE_FILES_PREPARED; configure private env and verify before service start')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.SubprocessError):
        print('FIRST_BUNDLE_INSTALL_REFUSED; retain and inspect partial state', file=sys.stderr)
        sys.exit(1)
