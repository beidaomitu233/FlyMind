#!/usr/bin/python3
"""One-time Linux root-console static compact publisher update. No service/SQL action.
Source is pinned, not chosen by arguments or environment. Fail closed on other code.
"""
import hashlib
import http.client
import json
import os
import posixpath
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import uuid

SOURCE_COMMIT = '9747278fb556e05eed17e4b0f1349c6003131847'
SOURCE_PREFIX = '/beidaomitu233/FlyMind/' + SOURCE_COMMIT + '/deploy/cloud/'
LIBEXEC = Path('/usr/local/libexec')
NODE = Path('/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node')
NODE_SHA = 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
NODE_BYTES = 124827920
BASE_RELEASE = 'run-39994902799-1'
BASE_MANIFEST_SHA = '1ec49bc838fadbd45f21a9c294da3b60e52479bfccd31874d624893a95c8c828'
VERIFIER = LIBEXEC/'verify-cloud-candidate.mjs'
VERIFIER_SHAS = frozenset(['bd174219487d0a118cadfb9bb0c27d6a6836002fc0ad0e6c3104865a39832c48', 'a274d402663ba117167a28203f4333f52b958057ca3cd2d7e9adec5bc5d05ae7'])
# Old callers: exact 33f026e git blob LF or checkout CRLF. New: exact 9747278 blob only.
FILES = (
    {'source':'materialize-candidate.mjs','target':'materialize-candidate.mjs','bytes':14715,'sha256':'f2d3187efdcacec11b07b429a934bfaede653133bfa819f51e33bd915b687d8d','old':(), 'optional':True},
    {'source':'promote.mjs','target':'flymind-promote.mjs','bytes':11545,'sha256':'7eced5386b74ade878fec2a0b65d64ef598325075d10d5bbecf23df89b3fdd03','old':('dfb93330fb921d8a5d78660f0abab30cba641e1a94dc9b63f3d369ca55dbe685','bdc427e426dd4460f804318920d0ffebcce6572a21477128c8af5a382ad1a783'), 'optional':False},
    {'source':'control-plane-promote.mjs','target':'flymind-control-plane-promote.mjs','bytes':17927,'sha256':'a11c4d574fa7272bf9e04c71a4a279cee5898a36de79a999cf95fd51ae0d8d35','old':('fd5084728c0fa38c36e03eb6cbab8e13b18d3dbc2b67eb78f7de3ae0e782dd90','7fc7bbefc9228a15a6db51830780afba198f28f818579b17a996ed383b509f97'), 'optional':False},
)


class InstallError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise InstallError(code)


def public_mismatch(code, name, actual):
    print(json.dumps({'code':code,'file':name,'sha256':actual},sort_keys=True),file=sys.stderr)
    raise InstallError(code)


def installed_allowed(spec, actual):
    if actual not in (*spec['old'],spec['sha256']):
        public_mismatch('UNKNOWN_INSTALLED_PUBLISHER',spec['target'],actual)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for part in iter(lambda: stream.read(1024*1024), b''):
            digest.update(part)
    return digest.hexdigest()


def trusted_ancestors(path):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.normpath(path), 'UNSAFE_STATIC_PATH')
    for parent in (path, *path.parents):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'UNSAFE_ROOT_ANCESTOR')


def trusted_file(path, maximum, executable=False):
    trusted_ancestors(Path(path).parent)
    # O_NONBLOCK refuses a FIFO at fstat rather than waiting for its writer.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0 and not info.st_mode & 0o022 and 0 < info.st_size <= maximum and (not executable or info.st_mode & 0o100), 'UNSAFE_STATIC_FILE')
        named = os.stat(path, follow_symlinks=False)
        require((info.st_dev, info.st_ino) == (named.st_dev, named.st_ino), 'STATIC_FILE_IDENTITY_CHANGED')
        with os.fdopen(os.dup(fd), 'rb') as source:
            data = source.read(maximum+1)
        require(len(data) == info.st_size, 'STATIC_FILE_CHANGED')
        return {'path':Path(path), 'bytes':data, 'sha256':sha(data), 'mode':stat.S_IMODE(info.st_mode)}
    finally:
        os.close(fd)


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'DUPLICATE_CONFIG_KEY')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs)


def state_path(value):
    require(isinstance(value, str) and value.startswith('/') and value != '/' and '\x00' not in value and posixpath.normpath(value) == value, 'INVALID_STATE_DIRECTORY')
    return Path(value)


def download(spec, connection_factory=http.client.HTTPSConnection):
    # No caller-controlled host, URL, proxies, redirect target or credentials.
    connection = None
    try:
        connection = connection_factory('raw.githubusercontent.com', 443, timeout=20)
        connection.request('GET', SOURCE_PREFIX+spec['source'], headers={'Accept-Encoding':'identity','User-Agent':'FlyMind-static-publisher-install'})
        response = connection.getresponse()
        require(response.status == 200 and response.getheader('Content-Encoding','identity').lower() == 'identity' and response.getheader('Location') is None, 'STATIC_DOWNLOAD_REFUSED')
        length = response.getheader('Content-Length')
        require(length is None or length == str(spec['bytes']), 'STATIC_DOWNLOAD_LENGTH')
        deadline = time.monotonic()+60
        data = bytearray()
        read = getattr(response, 'read1', response.read)
        while True:
            remaining = deadline-time.monotonic()
            require(remaining > 0, 'STATIC_DOWNLOAD_TIMEOUT')
            if getattr(connection, 'sock', None) is not None:
                connection.sock.settimeout(min(20,remaining))
            part = read(65536)
            if not part:
                break
            data.extend(part)
            require(len(data) <= spec['bytes'] <= 1024*1024, 'STATIC_DOWNLOAD_LENGTH')
        require(len(data) == spec['bytes'] and sha(data) == spec['sha256'], 'STATIC_DOWNLOAD_DIGEST')
        return bytes(data)
    except InstallError:
        raise
    except Exception:
        raise InstallError('STATIC_DOWNLOAD_FAILED') from None
    finally:
        if connection is not None:
            connection.close()


def atomic_write(path, data, mode, *, root_required=True):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.compact-static-', dir=path.parent)
    try:
        if root_required:
            os.fchown(fd,0,0)
        if hasattr(os,'fchmod'):
            os.fchmod(fd,mode)
        else:
            os.chmod(temporary,mode)
        with os.fdopen(fd,'wb') as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary,path)
        sync_directory(path.parent)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def sync_directory(path):
    if os.name == 'posix':
        fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


class PublicationLocks:
    def __init__(self, paths):
        self.paths=sorted(set(Path(path) for path in paths))
        self.owned=[]
        self.token=uuid.uuid4().hex

    def __enter__(self):
        try:
            for path in self.paths:
                # Same mkdir lock names as the current app/Java publishers.
                # Never inspect a PID to delete/steal an existing directory.
                try:
                    path.mkdir(mode=0o700)
                except FileExistsError:
                    raise InstallError('PUBLISHER_BUSY') from None
                info=path.lstat()
                entry={'path':path,'identity':(info.st_dev,info.st_ino),'owner':None}
                self.owned.append(entry)
                data=json.dumps({'pid':os.getpid(),'installer':'compact-static','token':self.token},sort_keys=True).encode()
                owner=path/'owner.json'
                with open(owner,'xb') as output:
                    os.chmod(owner,0o600)
                    entry['owner']=data
                    output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                sync_directory(path)
                sync_directory(path.parent)
            return self
        except Exception:
            self.__exit__(None,None,None)
            raise

    def __exit__(self,*_):
        failure=False
        for entry in reversed(self.owned):
            path=entry['path']
            try:
                info=path.lstat()
                require((info.st_dev,info.st_ino)==entry['identity'],'LOCK_IDENTITY_CHANGED')
                owner=path/'owner.json'
                if entry['owner'] is not None:
                    require(owner.is_file() and not owner.is_symlink() and owner.read_bytes()==entry['owner'],'LOCK_OWNER_CHANGED')
                    owner.unlink()
                path.rmdir()
                sync_directory(path.parent)
            except Exception:
                failure=True
        self.owned=[]
        if failure:
            raise InstallError('INSTALL_LOCK_CLEANUP_FAILED')


def node_run(arguments):
    try:
        result=subprocess.run([str(NODE),*arguments],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120,check=False,env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8','NODE_NO_WARNINGS':'1'})
    except Exception:
        raise InstallError('NODE_PREFLIGHT_FAILED') from None
    require(result.returncode==0,'NODE_PREFLIGHT_FAILED')
    return result.stdout


def configuration():
    configs=[]
    for environment in ('production','staging'):
        for filename, lockname in (('deployment.json','.deploy.lock'),('control-plane-deployment.json','.control-plane.lock')):
            path=Path('/etc/flymind')/environment/filename
            if environment=='staging' and not os.path.lexists(path):
                continue
            value=strict_json(trusted_file(path,65536)['bytes'])
            require(isinstance(value,dict) and 'stateDirectory' in value,'INVALID_DEPLOYMENT_CONFIG')
            state=state_path(value['stateDirectory'])
            trusted_ancestors(state)
            configs.append((environment,filename,value,state/lockname))
    app=next(value for environment,filename,value,_ in configs if environment=='production' and filename=='deployment.json')
    return app,[lock for *_,lock in configs]


def baseline_preflight(app):
    release_root=state_path(app.get('releaseRoot'))
    current=state_path(app.get('currentLink'))
    trusted_ancestors(release_root)
    trusted_ancestors(current.parent)
    info=current.lstat()
    require(stat.S_ISLNK(info.st_mode) and info.st_uid==0,'CURRENT_RELEASE_LINK_INVALID')
    root=current.resolve(strict=True)
    require(root.parent==release_root and root.name==BASE_RELEASE,'UNEXPECTED_CURRENT_RELEASE')
    raw=trusted_file(root/'candidate.json',2*1024*1024)
    require(raw['sha256']==BASE_MANIFEST_SHA,'BASELINE_MANIFEST_MISMATCH')
    value=strict_json(raw['bytes'])
    require(value.get('releaseId')==BASE_RELEASE,'BASELINE_RELEASE_MISMATCH')
    verifier=trusted_file(VERIFIER,1024*1024)
    if verifier['sha256'] not in VERIFIER_SHAS:
        public_mismatch('UNTRUSTED_CANDIDATE_VERIFIER',VERIFIER.name,verifier['sha256'])
    script="import {verifyCandidate} from 'file:///usr/local/libexec/verify-cloud-candidate.mjs';const m=await verifyCandidate(process.argv[1],{requireRootOwned:true});if(m.releaseId!=='"+BASE_RELEASE+"')throw Error('BASELINE');process.stdout.write('BASELINE_VERIFIED');"
    require(node_run(['--input-type=module','--eval',script,str(root)])==b'BASELINE_VERIFIED','BASELINE_VERIFY_FAILED')


def snapshots():
    result={}
    for spec in FILES:
        path=LIBEXEC/spec['target']
        if spec['optional'] and not os.path.lexists(path):
            result[spec['target']]=None
            continue
        prior=trusted_file(path,1024*1024)
        installed_allowed(spec,prior['sha256'])
        result[spec['target']]=prior
    return result


def install_static(prior, downloaded, backup, *, root_required=True, writer=atomic_write):
    """All downloads/syntax/full baseline checks happen before entering here.
    Root CLI uses only fixed FILES. Private fixtures can exercise rollback without root.
    """
    backup=Path(backup)
    backup.mkdir(mode=0o700)
    for spec in FILES:
        old=prior[spec['target']]
        if old is not None:
            path=backup/(spec['target']+'.before')
            with open(path,'xb') as target:
                os.chmod(path,0o600)
                target.write(old['bytes'])
                target.flush()
                os.fsync(target.fileno())
            require(digest_file(path)==old['sha256'],'STATIC_BACKUP_DIGEST_MISMATCH')
    receipt={'sourceCommit':SOURCE_COMMIT,'files':{spec['target']:{'oldSHA256':prior[spec['target']]['sha256'] if prior[spec['target']] else None,'oldMode':prior[spec['target']]['mode'] if prior[spec['target']] else None,'newSHA256':spec['sha256']} for spec in FILES}}
    with open(backup/'receipt.json','x',encoding='utf-8') as target:
        os.chmod(backup/'receipt.json',0o600)
        json.dump(receipt,target,sort_keys=True)
        target.flush()
        os.fsync(target.fileno())
    sync_directory(backup)
    sync_directory(backup.parent)
    installed=[]
    try:
        for spec in FILES:  # dependency module first, then the two callers
            name=spec['target']
            path=LIBEXEC/name
            old=prior[name]
            if old is None:
                require(not os.path.lexists(path),'STATIC_FILE_CHANGED')
            else:
                require(digest_file(path)==old['sha256'],'STATIC_FILE_CHANGED')
            data=downloaded[name]
            require(len(data)==spec['bytes'] and sha(data)==spec['sha256'],'DOWNLOADED_STATIC_CHANGED')
            # Include a possibly replaced file even if directory fsync raises.
            installed.append(spec)
            writer(path,data,0o644,root_required=root_required)
            require(digest_file(path)==spec['sha256'],'INSTALLED_DIGEST_MISMATCH')
        return receipt
    except Exception:
        failed=False
        for spec in reversed(installed):
            name=spec['target']
            path=LIBEXEC/name
            try:
                old=prior[name]
                if old is None:
                    if os.path.lexists(path):
                        require(digest_file(path)==spec['sha256'],'ROLLBACK_TARGET_CHANGED')
                        path.unlink()
                        sync_directory(path.parent)
                else:
                    writer(path,old['bytes'],old['mode'],root_required=root_required)
                    require(digest_file(path)==old['sha256'],'ROLLBACK_DIGEST_MISMATCH')
            except Exception:
                failed=True
        raise InstallError('STATIC_ROLLBACK_INCOMPLETE' if failed else 'STATIC_INSTALL_ROLLED_BACK') from None


def main():
    require(len(sys.argv)==1 and sys.platform.startswith('linux') and os.geteuid()==0,'LINUX_ROOT_CONSOLE_REQUIRED')
    trusted_ancestors(LIBEXEC)
    trusted_ancestors(NODE.parent)
    node=trusted_file(NODE,NODE_BYTES,executable=True)
    if len(node['bytes'])!=NODE_BYTES or node['sha256']!=NODE_SHA:
        public_mismatch('FIXED_NODE_IDENTITY_MISMATCH','node',node['sha256'])
    app,locks=configuration()
    with PublicationLocks(locks):
        prior=snapshots()
        baseline_preflight(app)
        # Download ALL fixed sources and verify their bytes before backup/install.
        downloaded={spec['target']:download(spec) for spec in FILES}
        stage=Path(tempfile.mkdtemp(prefix='.compact-check-',dir=LIBEXEC))
        try:
            for spec in FILES:
                path=stage/spec['target']
                with open(path,'xb') as output:
                    os.chmod(path,0o600)
                    output.write(downloaded[spec['target']])
                node_run(['--check',str(path)])
            state=next(lock.parent for lock in locks if lock.name=='.deploy.lock')
            backup=state/('compact-publisher-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+uuid.uuid4().hex[:12])
            install_static(prior,downloaded,backup)
            for spec in FILES:
                final=trusted_file(LIBEXEC/spec['target'],1024*1024)
                require(final['sha256']==spec['sha256'] and final['mode']==0o644,'FINAL_STATIC_VERIFY_FAILED')
        finally:
            for path in stage.iterdir():
                require(path.is_file() and not path.is_symlink(),'STAGE_CHANGED')
                path.unlink()
            stage.rmdir()
    print('COMPACT_PUBLISHER_READY')


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error,InstallError) else 'COMPACT_PUBLISHER_INSTALL_REFUSED',file=sys.stderr)
        sys.exit(1)
