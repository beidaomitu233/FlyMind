import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('compact_installer',Path(__file__).resolve().parents[1]/'deploy/cloud/install-compact-publisher.py')
i=importlib.util.module_from_spec(spec)
spec.loader.exec_module(i)


class Response(io.BytesIO):
    def __init__(self,body,status=200,headers=None):
        super().__init__(body)
        self.status=status
        self.headers=headers or {}
    def getheader(self,name,default=None):
        return self.headers.get(name,default)


class Connection:
    sock=None
    def __init__(self,response):
        self.response=response
        self.requests=[]
    def request(self,*args,**kwargs):
        self.requests.append((args,kwargs))
    def getresponse(self):
        return self.response
    def close(self):
        pass


class StaticInstallerTests(unittest.TestCase):
    def fixture(self,root):
        files=[]
        prior={}
        downloads={}
        for index,target in enumerate(['materialize-candidate.mjs','flymind-promote.mjs','flymind-control-plane-promote.mjs']):
            old=None if index==0 else ('old'+str(index)).encode()
            data=('export const next='+str(index)+';\n').encode()
            path=root/target
            if old is not None:
                path.write_bytes(old)
            files.append({'source':target,'target':target,'bytes':len(data),'sha256':i.sha(data),'old':(i.sha(old),) if old else (), 'optional':old is None})
            prior[target]=None if old is None else {'path':path,'bytes':old,'sha256':i.sha(old),'mode':0o644}
            downloads[target]=data
        return tuple(files),prior,downloads

    def test_source_and_targets_are_fixed_no_runtime_url_or_hash_parameters(self):
        self.assertEqual(i.SOURCE_COMMIT,'9747278fb556e05eed17e4b0f1349c6003131847')
        self.assertEqual([s['target'] for s in i.FILES],['materialize-candidate.mjs','flymind-promote.mjs','flymind-control-plane-promote.mjs'])
        self.assertEqual(i.BASE_RELEASE,'run-39994902799-1')
        self.assertEqual(i.BASE_MANIFEST_SHA,'1ec49bc838fadbd45f21a9c294da3b60e52479bfccd31874d624893a95c8c828')
        self.assertFalse(i.FILES[0]['old'])
        for spec in i.FILES:
            i.installed_allowed(spec,spec['sha256'])
            for old in spec['old']:
                i.installed_allowed(spec,old)
            output=io.StringIO()
            with redirect_stderr(output),self.assertRaisesRegex(i.InstallError,'UNKNOWN_INSTALLED_PUBLISHER'):
                i.installed_allowed(spec,'0'*64)
            self.assertEqual(json.loads(output.getvalue()),{'code':'UNKNOWN_INSTALLED_PUBLISHER','file':spec['target'],'sha256':'0'*64})

    def test_tls_download_exact_source_digest_length_and_refuses_redirect(self):
        data=b'export const test=1;\n'
        spec={'source':'promote.mjs','bytes':len(data),'sha256':i.sha(data)}
        connection=Connection(Response(data,headers={'Content-Length':str(len(data))}))
        def factory(host,port,timeout):
            self.assertEqual((host,port,timeout),('raw.githubusercontent.com',443,20))
            return connection
        self.assertEqual(i.download(spec,factory),data)
        self.assertEqual(connection.requests[0][0],('GET',i.SOURCE_PREFIX+'promote.mjs'))
        for response in [Response(data,302,{'Location':'https://evil.invalid/'}),Response(data,200,{'Content-Encoding':'gzip'}),Response(data+b'extra'),Response(b'corrupt'),Response(data,200,{'Content-Length':'1'})]:
            with self.subTest(status=response.status),self.assertRaises(i.InstallError):
                i.download(spec,lambda *args,**kwargs:Connection(response))

    def test_download_failure_never_echoes_network_url_or_credentials(self):
        def fail(*_args,**_kwargs):
            raise RuntimeError('https://private.invalid/?token=must-not-log')
        output=io.StringIO()
        with redirect_stderr(output),self.assertRaisesRegex(i.InstallError,'STATIC_DOWNLOAD_FAILED'):
            i.download({'source':'promote.mjs','bytes':1,'sha256':'0'*64},lambda *args,**kwargs:ConnectionFailure())
        self.assertNotIn('token',output.getvalue())

    def test_module_first_atomic_install_private_backup_and_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            files,prior,downloads=self.fixture(root)
            order=[]
            def writer(path,data,mode,**options):
                order.append(Path(path).name)
                i.atomic_write(path,data,mode,**options)
            with patch.object(i,'LIBEXEC',root),patch.object(i,'FILES',files):
                receipt=i.install_static(prior,downloads,root/'backup',root_required=False,writer=writer)
            self.assertEqual(order,[s['target'] for s in files])
            for spec in files:
                self.assertEqual((root/spec['target']).read_bytes(),downloads[spec['target']])
                before=prior[spec['target']]
                if before:
                    self.assertEqual((root/'backup'/(spec['target']+'.before')).read_bytes(),before['bytes'])
                    if os.name=='posix':
                        self.assertEqual((root/'backup'/(spec['target']+'.before')).stat().st_mode&0o777,0o600)
            self.assertEqual(json.loads((root/'backup'/'receipt.json').read_text()),receipt)

    def test_failure_after_module_and_caller_restores_old_callers_removes_only_new_module(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            files,prior,downloads=self.fixture(root)
            raised=False
            def writer(path,data,mode,**options):
                nonlocal raised
                if Path(path).name==files[2]['target'] and not raised:
                    raised=True
                    raise OSError('controlled installation failure')
                i.atomic_write(path,data,mode,**options)
            with patch.object(i,'LIBEXEC',root),patch.object(i,'FILES',files),self.assertRaisesRegex(i.InstallError,'STATIC_INSTALL_ROLLED_BACK'):
                i.install_static(prior,downloads,root/'backup',root_required=False,writer=writer)
            self.assertFalse((root/files[0]['target']).exists())
            for spec in files[1:]:
                self.assertEqual((root/spec['target']).read_bytes(),prior[spec['target']]['bytes'])
            self.assertTrue((root/'backup'/'receipt.json').is_file())

    def test_changed_snapshot_refused_and_existing_file_not_destroyed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            files,prior,downloads=self.fixture(root)
            (root/files[1]['target']).write_bytes(b'outside change')
            with patch.object(i,'LIBEXEC',root),patch.object(i,'FILES',files),self.assertRaisesRegex(i.InstallError,'STATIC_INSTALL_ROLLED_BACK'):
                i.install_static(prior,downloads,root/'backup',root_required=False)
            self.assertEqual((root/files[1]['target']).read_bytes(),b'outside change')
            self.assertFalse((root/files[0]['target']).exists())

    def test_real_directory_locks_do_not_delete_busy_owner_and_release_owned_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            first,second=root/'.deploy.lock',root/'.control-plane.lock'
            second.mkdir()
            (second/'owner.json').write_bytes(b'foreign existing publisher')
            with self.assertRaisesRegex(i.InstallError,'PUBLISHER_BUSY'):
                with i.PublicationLocks([first,second]):
                    self.fail('must not acquire a foreign lock')
            self.assertEqual((second/'owner.json').read_bytes(),b'foreign existing publisher')
            self.assertFalse(first.exists())
            (second/'owner.json').unlink()
            second.rmdir()
            with i.PublicationLocks([first,second]):
                self.assertTrue(first.is_dir() and second.is_dir())
                with self.assertRaisesRegex(i.InstallError,'PUBLISHER_BUSY'):
                    with i.PublicationLocks([first]):
                        self.fail('must exclude another installer')
            self.assertFalse(first.exists() or second.exists())

    def test_fixed_node_command_no_shell_no_inherited_node_options_and_timeout(self):
        class Result:
            returncode=0
            stdout=b'BASELINE_VERIFIED'
        with patch.object(i.subprocess,'run',return_value=Result()) as run:
            self.assertEqual(i.node_run(['--check','/private/staged.mjs']),b'BASELINE_VERIFIED')
            args,kwargs=run.call_args
            self.assertEqual(args[0],[str(i.NODE),'--check','/private/staged.mjs'])
            self.assertEqual(kwargs['timeout'],120)
            self.assertNotIn('shell',kwargs)
            self.assertNotIn('NODE_OPTIONS',kwargs['env'])
            self.assertEqual(kwargs['stdin'],i.subprocess.DEVNULL)

    def test_state_config_accepts_existing_custom_root_path_not_guessed_same_cp_directory(self):
        self.assertEqual(i.state_path('/var/lib/flymind/production/control-plane-deployments').as_posix(),'/var/lib/flymind/production/control-plane-deployments')
        for path in ['/', 'relative', '/var/lib/../unsafe', '/var/lib/x\x00']:
            with self.assertRaises(i.InstallError):
                i.state_path(path)


class ConnectionFailure(Connection):
    def __init__(self):
        raise RuntimeError('https://private.invalid/?token=must-not-log')


if __name__=='__main__':
    unittest.main()
