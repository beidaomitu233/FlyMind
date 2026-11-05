#!/usr/bin/env python3
"""Install fixed systemd files only; never reload or restart a service."""
import os
import stat
import subprocess
import sys

SLICE = b'[Unit]\nDescription=FlyMind application services aggregate resource boundary\n\n[Slice]\nMemoryAccounting=yes\nMemoryHigh=1000M\nMemoryMax=1024M\nMemorySwapMax=0\n'
DROPIN = b'[Service]\nSlice=flymind.slice\n'
FILES = {
    'flymind.slice': SLICE,
    'flymind-application.service.d/10-flymind-slice.conf': DROPIN,
    'flymind-gateway.service.d/10-flymind-slice.conf': DROPIN,
    'flymind-control-plane.service.d/10-flymind-slice.conf': DROPIN,
}


def checked_dir(parent, name, uid, create=False):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    except FileNotFoundError:
        if not create:
            return None
        os.mkdir(name, 0o755, dir_fd=parent)
        os.fsync(parent)
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_mode & 0o022:
        os.close(fd)
        raise RuntimeError('UNTRUSTED_DIRECTORY')
    return fd


def checked_file(parent, name, content, uid):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    except FileNotFoundError:
        return False
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or stat.S_IMODE(info.st_mode) != 0o644 or info.st_size != len(content):
            raise RuntimeError('UNEXPECTED_EXISTING_FILE')
        data = b''
        while len(data) <= len(content):
            part = os.read(fd, len(content) + 1 - len(data))
            if not part:
                break
            data += part
        if data != content:
            raise RuntimeError('UNEXPECTED_EXISTING_FILE')
        return True
    finally:
        os.close(fd)


def apply_files(system_fd, uid, install):
    """All existing destinations are checked before any file is created."""
    directories = {}
    try:
        for rel in FILES:
            parts = rel.split('/')
            if len(parts) == 2 and parts[0] not in directories:
                directories[parts[0]] = checked_dir(system_fd, parts[0], uid)
        for rel, content in FILES.items():
            parts = rel.split('/')
            parent = system_fd if len(parts) == 1 else directories[parts[0]]
            if parent is not None:
                checked_file(parent, parts[-1], content, uid)
        if not install:
            for rel, content in FILES.items():
                parts = rel.split('/')
                parent = system_fd if len(parts) == 1 else directories[parts[0]]
                if parent is None or not checked_file(parent, parts[-1], content, uid):
                    raise RuntimeError('MISSING_FILE')
            return
        for name, fd in list(directories.items()):
            if fd is None:
                directories[name] = checked_dir(system_fd, name, uid, create=True)
        for rel, content in FILES.items():
            parts = rel.split('/')
            parent = system_fd if len(parts) == 1 else directories[parts[0]]
            if checked_file(parent, parts[-1], content, uid):
                continue
            fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=parent)
            try:
                os.fchmod(fd, 0o644)
                view = memoryview(content)
                while view:
                    count = os.write(fd, view)
                    if count <= 0:
                        raise RuntimeError('SHORT_WRITE')
                    view = view[count:]
                os.fsync(fd)
            finally:
                os.close(fd)
            os.fsync(parent)
    finally:
        for fd in directories.values():
            if fd is not None:
                os.close(fd)


def main():
    if sys.platform != 'linux' or os.geteuid() != 0 or sys.argv[1:] not in (['--install'], ['--verify-files'], ['--verify-live']):
        raise RuntimeError('REQUIRES_ROOT_LINUX_AND_FIXED_MODE')
    with open('/sys/fs/cgroup/cgroup.controllers', encoding='ascii') as source:
        if 'memory' not in source.read(4096).split():
            raise RuntimeError('CGROUP_MEMORY_UNAVAILABLE')
    # cgroup v2 exposes swap limits on non-root cgroups; verify the slice's
    # effective memory.swap.max in --verify-live after systemd creates it.
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in ('etc', 'systemd', 'system'):
            child = checked_dir(fd, name, 0)
            if child is None:
                raise RuntimeError('MISSING_SYSTEM_DIRECTORY')
            os.close(fd)
            fd = child
        apply_files(fd, 0, sys.argv[1] == '--install')
    finally:
        os.close(fd)
    if sys.argv[1] == '--verify-live':
        verify_live()
        print('RESOURCE_BOUNDARY_MAIN_PROCESSES_VERIFIED; verify descendants, deployment processes and full workload separately')
        return
    print('RESOURCE_BOUNDARY_FILES_VERIFIED; reload, coordinated restart and live cgroup verification remain required')


def verify_live():
    root = '/sys/fs/cgroup/flymind.slice/'
    for name, expected in (('memory.high', '1048576000'), ('memory.max', '1073741824'), ('memory.swap.max', '0')):
        with open(root + name, encoding='ascii') as source:
            if source.read(128).strip() != expected:
                raise RuntimeError('LIVE_LIMIT_MISMATCH')
    for name in ('flymind-application.service', 'flymind-gateway.service', 'flymind-control-plane.service'):
        def prop(key):
            value = subprocess.run(['/usr/bin/systemctl', 'show', '--property=' + key, '--value', name],
                                   check=True, timeout=10, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if len(value.stdout) > 4096:
                raise RuntimeError('LIVE_PROPERTY_INVALID')
            return value.stdout.decode('ascii').strip()
        if prop('Slice') != 'flymind.slice' or prop('ActiveState') != 'active':
            raise RuntimeError('LIVE_SERVICE_INVALID')
        pid = prop('MainPID')
        if not pid.isascii() or not pid.isdecimal() or int(pid) <= 0:
            raise RuntimeError('LIVE_PID_INVALID')
        with open('/proc/' + pid + '/cgroup', encoding='ascii') as source:
            if source.read(4096).strip() != '0::/flymind.slice/' + name:
                raise RuntimeError('LIVE_CGROUP_MISMATCH')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, UnicodeError, subprocess.SubprocessError):
        print('RESOURCE_BOUNDARY_INSTALL_REFUSED; inspect protected local state', file=sys.stderr)
        sys.exit(1)
