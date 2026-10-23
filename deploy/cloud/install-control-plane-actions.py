#!/usr/bin/python3
"""One-time, explicit root-console installation for the audited FlyMind host.

No network, Git, service restart, SQL mutation, shell evaluation or secret output.
The caller supplies a reviewed root-protected source tree and CI evidence digest.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse

NODE = '/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node'
PYTHON = '/usr/bin/python3'
MYSQLDUMP = '/usr/bin/mysqldump'
BASH = '/usr/bin/bash'
ENVIRONMENT = '/etc/flymind/control-plane.env'
PRIVATE = '/etc/flymind/production'
BACKUPS = '/var/backups/flymind/production-mysql'
STATE = '/var/lib/flymind/production/control-plane-deployments'
LIBEXEC = '/usr/local/libexec'
SUDOERS = '/etc/sudoers.d/flymind-control-plane'
FORCED = LIBEXEC + '/flymind-ssh-command.py'
POLICY_KEYS = {'schemaVersion', 'sourceCommit', 'jarSha256', 'allowedMigrations', 'verified'}


class SetupError(Exception):
    """Only fixed, non-secret diagnostic messages may be used here."""


def digest(value):
    return hashlib.sha256(value).hexdigest()


def parse_environment(text):
    """Strict subset of systemd EnvironmentFile, never shell/source/eval.

    Literal $ and backticks are ordinary characters, not executable expressions.
    Unsupported escapes/multiline/duplicate keys fail instead of guessing secrets.
    """
    result = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith(('#', ';')):
            continue
        match = re.fullmatch(r'\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*', line)
        if not match or match[1] in result:
            raise SetupError('Environment syntax or duplicate key is unsupported')
        value = match[2]
        if value[:1] in ('"', "'"):
            quote = value[0]
            if len(value) < 2 or value[-1] != quote or quote in value[1:-1] or '\\' in value:
                raise SetupError('Environment quoting is unsupported')
            value = value[1:-1]
        elif any(char in value for char in ('"', "'", '\\')):
            raise SetupError('Environment escaping is unsupported')
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise SetupError('Environment contains control characters')
        result[match[1]] = value
    return result


def database_binding(url):
    if not isinstance(url, str) or not url.startswith('jdbc:mysql://'):
        raise SetupError('Expected loopback MySQL JDBC URL')
    try:
        value = urllib.parse.urlsplit(url[5:])
        port = value.port or 3306
        query = urllib.parse.parse_qsl(value.query, keep_blank_values=True)
    except ValueError:
        raise SetupError('JDBC URL is invalid') from None
    if value.hostname not in ('127.0.0.1', 'localhost', '::1') or value.username is not None or value.password is not None or value.path != '/fly_mind' or value.fragment or not 1 <= port <= 65535:
        raise SetupError('Only the audited loopback fly_mind database is allowed')
    if any(key.lower() in ('user', 'password', 'username', 'socketfactory', 'socket', 'protocol') for key, _ in query):
        raise SetupError('JDBC credential/transport overrides are not supported')
    return value.hostname, port


def validate_policy(value, source_commit):
    if not isinstance(value, dict) or set(value) != POLICY_KEYS or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['verified'] is not True:
        raise SetupError('Verified CI runtime evidence is required')
    if not re.fullmatch(r'[a-f0-9]{40}', source_commit or '') or value['sourceCommit'] != source_commit or not re.fullmatch(r'[a-f0-9]{64}', str(value['jarSha256'])):
        raise SetupError('Evidence source or JAR identity mismatch')
    migrations = value['allowedMigrations']
    if not isinstance(migrations, dict) or not 1 <= len(migrations) <= 1000:
        raise SetupError('Evidence migration inventory invalid')
    for name, sha in migrations.items():
        if not re.fullmatch(r'V[0-9][A-Za-z0-9_.-]*__[^/\\]+\.sql', name) or not re.fullmatch(r'[a-f0-9]{64}', str(sha)):
            raise SetupError('Evidence migration inventory invalid')
    return value


def cnf_quote(value):
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise SetupError('MySQL credential contains unsupported control characters')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def private_material(environment, policy):
    host, port = database_binding(environment.get('ADMIN_DB_JDBC_URL'))
    if environment.get('SPRING_FLYWAY_URL') and database_binding(environment['SPRING_FLYWAY_URL']) != (host, port):
        raise SetupError('Flyway and application database must match')
    user = environment.get('ADMIN_DB_USER', '')
    password = environment.get('ADMIN_DB_PASSWORD')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', user) or user.lower() in ('root', 'mysql.sys', 'mysql.session', 'mysql.infoschema') or password is None:
        raise SetupError('Existing dedicated MySQL application account is required')
    key = environment.get('FLYMIND_GATEWAY_KEY', '')
    if not 32 <= len(key.encode()) <= 512 or key != key.strip():
        raise SetupError('Gateway key is missing or unsupported')
    if environment.get('FLYMIND_BOOTSTRAP_ENABLED', 'false') != 'false':
        raise SetupError('Bootstrap must already be disabled')
    bind = environment.get('ADMIN_BIND_ADDRESS', '127.0.0.1')
    port_value = environment.get('ADMIN_PORT', '18080')
    if bind not in ('127.0.0.1', '::1') or not re.fullmatch(r'[1-9][0-9]{0,4}', port_value) or int(port_value) > 65535:
        raise SetupError('Java must use the audited loopback listener')
    origin = 'http://' + ('[::1]' if bind == '::1' else bind) + ':' + port_value
    config = {
        'incomingDirectory': '/var/lib/flymind/incoming', 'stateDirectory': STATE,
        'backupDirectory': BACKUPS, 'jarPath': '/opt/flymind/control-plane/system-admin.jar',
        'environmentFile': ENVIRONMENT, 'readinessKeyFile': PRIVATE + '/control-plane-readiness.key',
        'pythonExecutable': PYTHON, 'backupHelper': LIBEXEC + '/flymind-production-mysql-backup',
        'service': 'flymind-control-plane.service', 'readinessOrigin': origin,
        'rollbackPolicy': 'stop-on-failure', 'allowedMigrations': policy['allowedMigrations'],
    }
    cnf = '[client]\nprotocol=TCP\nhost=' + cnf_quote(host) + '\nport=' + str(port) + '\nuser=' + cnf_quote(user) + '\npassword=' + cnf_quote(password) + '\n'
    return {
        PRIVATE + '/mysql-backup.cnf': cnf.encode(),
        PRIVATE + '/control-plane-readiness.key': key.encode(),
        PRIVATE + '/control-plane-deployment.json': (json.dumps(config, indent=2, sort_keys=True) + '\n').encode(),
        PRIVATE + '/control-plane-install-policy.json': (json.dumps(policy, indent=2, sort_keys=True) + '\n').encode(),
    }


def sudoers_content(user):
    if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', user) or user == 'root':
        raise SetupError('Existing non-root deployment account required')
    # Exact executable only. Dispatcher AND root publisher validate all arguments;
    # no generic shell/node/systemctl permission is introduced.
    command = LIBEXEC + '/flymind-control-plane-promote'
    return ('# Managed by the reviewed FlyMind control-plane installer.\n' +
            user + ' ALL=(root) NOPASSWD: ' + command + ' production run-* *, ' +
            command + ' staging run-* *\n').encode()


def backup_helper(template):
    if not template.startswith('#!/bin/bash\n') or template.count('/AUDITED_SUPPLIED_PYTHON/bin/python3') != 1 or template.count('readonly database=AUDITED_DB_NAME') != 1:
        raise SetupError('Reviewed backup template shape changed')
    return template.replace('#!/bin/bash\n', '#!' + BASH + '\n', 1).replace('/AUDITED_SUPPLIED_PYTHON/bin/python3', PYTHON).replace('readonly database=AUDITED_DB_NAME', 'readonly database=fly_mind').encode()


def check_root_path(path, *, directory=False, private=False, executable=False, allow_final_link=False):
    path = pathlib.Path(path)
    if not path.is_absolute() or str(path) != os.path.normpath(str(path)):
        raise SetupError('Expected a canonical absolute installation path')
    if allow_final_link:
        check_root_path(path.parent, directory=True)
        path = path.resolve(strict=True)
    current = path
    while True:
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise SetupError('Installation path is not root protected')
        if current == path:
            expected = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
            if not expected or private and info.st_mode & 0o077 or executable and not info.st_mode & 0o100:
                raise SetupError('Installation file permissions invalid')
        elif not stat.S_ISDIR(info.st_mode):
            raise SetupError('Installation ancestor is not a directory')
        if current.parent == current:
            break
        current = current.parent
    return path


def read_protected(path, limit=2_000_000, **checks):
    check_root_path(path, **checks)
    with open(path, 'rb') as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise SetupError('Protected input budget exceeded')
    return value


def ensure_root_directory(path):
    path = pathlib.Path(path)
    if not path.exists():
        ensure_root_directory(path.parent)
        path.mkdir(mode=0o700)
    check_root_path(path, directory=True)


def write_exclusive(path, value, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def immutable_private_file(path, value):
    """Caller has checked parent protection. Never overwrite operator files."""
    path = pathlib.Path(path)
    if path.exists() or path.is_symlink():
        existing = read_protected(path, private=True)
        if existing != value:
            raise SetupError('Existing private installation file differs; retained unchanged')
        return False
    write_exclusive(path, value, 0o600)
    return True


def run_checked(argv, timeout=60):
    # Child output may contain capability-bearing messages; never echo it.
    try:
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False,
                                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
    except (OSError, subprocess.TimeoutExpired):
        raise SetupError('Installation prerequisite command failed or timed out') from None
    if result.returncode or len(result.stdout) > 200_000 or len(result.stderr) > 200_000:
        raise SetupError('Installation validation command refused')
    return result.stdout


def atomic_code_install(target, value, mode, stage, changes):
    target = pathlib.Path(target)
    check_root_path(target.parent, directory=True)
    previous = None
    if target.exists() or target.is_symlink():
        previous = read_protected(target)
        previous_mode = stat.S_IMODE(target.stat().st_mode)
        if previous == value and previous_mode == mode:
            return
    else:
        previous_mode = None
    if previous is not None:
        write_exclusive(pathlib.Path(stage) / ('previous-' + str(len(changes))), previous, 0o600)
    temporary = target.parent / ('.flymind-install-' + os.urandom(12).hex())
    write_exclusive(temporary, value, mode)
    change = (target, previous, previous_mode, digest(value))
    try:
        os.replace(temporary, target)
        changes.append(change)
    finally:
        if temporary.exists():
            temporary.unlink()


def restore_changes(changes):
    for target, previous, mode, expected_sha in reversed(changes):
        if not target.exists() or digest(target.read_bytes()) != expected_sha:
            raise SetupError('Installation rollback requires console review')
        if previous is None:
            target.unlink()
        else:
            temporary = target.parent / ('.flymind-restore-' + os.urandom(12).hex())
            write_exclusive(temporary, previous, mode)
            os.replace(temporary, target)


def install(args):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise SetupError('Run explicitly as root in the audited server console')
    os.umask(0o077)
    import pwd
    source = check_root_path(args.source_root, directory=True)
    evidence = read_protected(args.policy_json)
    if not re.fullmatch(r'[a-f0-9]{64}', args.policy_sha256 or '') or digest(evidence) != args.policy_sha256:
        raise SetupError('Reviewed CI policy digest mismatch')
    policy = validate_policy(json.loads(evidence), args.source_commit)
    account = pwd.getpwnam(args.deploy_user)
    if account.pw_uid == 0:
        raise SetupError('Deployment user must not be root')
    permissions = sudoers_content(args.deploy_user)
    for binary in (NODE, PYTHON, MYSQLDUMP, '/usr/sbin/visudo', BASH, '/usr/bin/gzip'):
        check_root_path(binary, executable=True, allow_final_link=True)
    if run_checked([NODE, '--version']).strip() != b'v22.23.3':
        raise SetupError('Audited Node version required')
    run_checked([PYTHON, '-c', "import sys,tarfile,hashlib; assert sys.version_info[:3]==(3,11,6) and hasattr(tarfile,'data_filter') and hasattr(hashlib,'file_digest')"])
    environment = parse_environment(read_protected(ENVIRONMENT, private=True).decode())
    private_files = private_material(environment, policy)
    code = {
        LIBEXEC + '/flymind-control-plane-promote.mjs': (read_protected(source / 'deploy/cloud/control-plane-promote.mjs'), 0o644),
        LIBEXEC + '/verify-cloud-candidate.mjs': (read_protected(source / 'scripts/verify-cloud-candidate.mjs'), 0o644),
        FORCED: (read_protected(source / 'deploy/cloud/ssh-command.py'), 0o755),
        LIBEXEC + '/artifact-fetch.py': (read_protected(source / 'deploy/cloud/artifact-fetch.py'), 0o644),
    }
    template = read_protected(source / 'deploy/cloud/control-plane-backup.sh.example').decode()
    helper = backup_helper(template)
    code[LIBEXEC + '/flymind-production-mysql-backup'] = (helper, 0o755)
    code[LIBEXEC + '/flymind-control-plane-promote'] = (('#!/bin/sh\nexec ' + NODE + ' ' + LIBEXEC + '/flymind-control-plane-promote.mjs "$@"\n').encode(), 0o755)
    for path in (PRIVATE, BACKUPS, STATE, LIBEXEC, '/etc/sudoers.d'):
        ensure_root_directory(path)
    # Refuse conflicting private files before creating any new secret.
    for path, value in private_files.items():
        if pathlib.Path(path).exists() or pathlib.Path(path).is_symlink():
            if read_protected(path, private=True) != value:
                raise SetupError('Existing private installation file differs; retained unchanged')
    # Existing service/JAR/env/authorized_keys are never changed by this installer.
    check_root_path(FORCED, executable=True)
    check_root_path('/opt/flymind/control-plane/system-admin.jar')
    run_checked(['/usr/sbin/visudo', '-c'])
    lock = pathlib.Path(STATE) / '.console-install.lock'
    lock.mkdir(mode=0o700)
    stage = pathlib.Path(tempfile.mkdtemp(prefix='flymind-control-plane-install-', dir='/root'))
    changes = []
    succeeded = False
    phase = 'validate-source'
    try:
        staged = {}
        for number, (target, (value, mode)) in enumerate(code.items()):
            path = stage / (str(number) + pathlib.Path(target).suffix)
            write_exclusive(path, value, mode)
            staged[target] = path
            if target.endswith('.py'):
                compile(value, target, 'exec')
            elif target.endswith('.mjs'):
                run_checked([NODE, '--check', str(path)])
        staged_helper = staged[LIBEXEC + '/flymind-production-mysql-backup']
        run_checked([BASH, '-n', str(staged_helper)])
        sudo_stage = stage / 'sudoers'
        write_exclusive(sudo_stage, permissions, 0o440)
        run_checked(['/usr/sbin/visudo', '-cf', str(sudo_stage)])
        phase = 'private-config'
        for path, value in private_files.items():
            immutable_private_file(path, value)
        # The only DB operation: consistent read-only dump, no service stop/SQL writes.
        phase = 'dry-run-backup'
        began = int(time.time() * 1000)
        raw = run_checked([BASH, str(staged_helper)], timeout=300)
        receipt = json.loads(raw)
        if set(receipt) != {'file', 'sha256', 'bytes', 'startedAt', 'completedAt', 'consistent'} or not re.fullmatch(r'database-[a-zA-Z0-9_-]+\.sql\.gz', str(receipt.get('file'))) or receipt.get('consistent') is not True:
            raise SetupError('Read-only database dump receipt invalid')
        backup = pathlib.Path(BACKUPS) / receipt['file']
        check_root_path(backup, private=True)
        if type(receipt['startedAt']) is not int or type(receipt['completedAt']) is not int or not began <= receipt['startedAt'] <= receipt['completedAt'] <= int(time.time() * 1000):
            raise SetupError('Read-only database dump timing invalid')
        if type(receipt['bytes']) is not int or backup.stat().st_size != receipt['bytes'] or receipt['bytes'] <= 0:
            raise SetupError('Read-only database dump length invalid')
        with backup.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != receipt['sha256']:
                raise SetupError('Read-only database dump digest mismatch')
        phase = 'install-dispatch'
        for path, (value, mode) in code.items():
            atomic_code_install(path, value, mode, stage, changes)
        atomic_code_install(SUDOERS, permissions, 0o440, stage, changes)
        phase = 'sudoers-check'
        run_checked(['/usr/sbin/visudo', '-c'])
        audit = {'schemaVersion': 1, 'installed': True, 'sourceCommit': policy['sourceCommit'], 'jarSha256': policy['jarSha256'], 'policySha256': args.policy_sha256, 'backup': receipt, 'installedAt': int(time.time() * 1000), 'servicesRestarted': False}
        write_exclusive(pathlib.Path(STATE) / ('console-install-' + os.urandom(12).hex() + '.json'), (json.dumps(audit, indent=2) + '\n').encode(), 0o600)
        succeeded = True
        print(json.dumps({'installed': True, 'sourceCommit': policy['sourceCommit'], 'servicesRestarted': False, 'productionEnabled': False}))
    except Exception:
        try:
            restore_changes(changes)
            run_checked(['/usr/sbin/visudo', '-c'])
        except Exception:
            raise SetupError('Installation rollback incomplete; review private staging directory in console') from None
        raise SetupError('Installation failed at ' + phase + '; code changes reverted, private files retained') from None
    finally:
        if succeeded:
            shutil.rmtree(stage)
        lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--policy-json', required=True)
    parser.add_argument('--policy-sha256', required=True)
    parser.add_argument('--deploy-user', default='flymind-deploy')
    args = parser.parse_args()
    try:
        install(args)
    except SetupError as error:
        print('FlyMind installation refused: ' + str(error) + '. No services restarted.', file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError):
        # Do not print exceptions from env/JSON/SQL/subprocess parsing.
        print('FlyMind control-plane installation refused; no services restarted. Review protected console inputs/permissions; created private files are retained.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
