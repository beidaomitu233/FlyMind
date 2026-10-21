import hashlib
import http.client
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import stat
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('artifact_fetch', Path(__file__).resolve().parents[1] / 'deploy/cloud/artifact-fetch.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
HOST = 'productionresultssa6.blob.core.windows.net'
TAR_BYTES = b'fixture tar bytes, not a production candidate'
SHA = hashlib.sha256(TAR_BYTES).hexdigest()

def zipped(extra=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(a.TAR, TAR_BYTES)
        archive.writestr(a.TAR + '.sha256', SHA + '  ' + a.TAR + '\n')
        if extra is not None:
            archive.writestr(extra, b'unexpected')
    return output.getvalue()

def metadata(body=None):
    body = zipped() if body is None else body
    return dict(schemaVersion=1, artifactId=7, url='https://' + HOST + '/fixture.zip?not-a-secret', zipSha256=hashlib.sha256(body).hexdigest(), zipBytes=len(body), tarBytes=len(TAR_BYTES), issuedAt=int(time.time() * 1000))

class ArtifactTests(unittest.TestCase):
    def test_metadata_origins_budgets_expiry_and_exact_host(self):
        good = metadata()
        self.assertEqual(a.validate_metadata(good, {HOST}).hostname, HOST)
        for change in [dict(url='http://' + HOST + '/x'), dict(url='https://localhost/x'), dict(url='https://127.0.0.1/x'), dict(url='https://' + HOST + '.evil.test/x'), dict(url='https://u:p@' + HOST + '/x'), dict(url='https://' + HOST + ':444/x'), dict(url='https://' + HOST + '/x#f'), dict(zipBytes=True), dict(zipBytes=a.MAX_BYTES + 1), dict(issuedAt=1), dict(zipSha256=42), dict(hosts=[HOST])]:
            with self.subTest(change=list(change)):
                with self.assertRaises(ValueError):
                    a.validate_metadata({**good, **change}, {HOST})
        with self.assertRaises(ValueError):
            a.validate_metadata(good, {'another.blob.core.windows.net'})

    def test_dns_rejects_private_and_mixed_resolution(self):
        for addresses in [['127.0.0.1'], ['8.8.8.8', '10.0.0.1'], ['::1']]:
            with patch.object(socket, 'getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, 443)) for ip in addresses]):
                with self.assertRaises(ValueError):
                    a.public_addresses(HOST)
        with patch.object(socket, 'getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))]):
            self.assertEqual(a.public_addresses(HOST), ['8.8.8.8'])

    def test_local_fake_http_only_via_injected_opener_and_digest_chain(self):
        body = zipped()
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                self.send_response(302 if self.path == '/redirect' else 200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def opener(parsed):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=2)
            connection.request('GET', parsed.path)
            return connection, connection.getresponse()
        try:
            with tempfile.TemporaryDirectory(prefix='flymind-artifact-test-') as directory:
                dest = Path(directory)
                m = metadata(body)
                parsed = a.validate_metadata(m, {HOST})
                a.copy_archive(m, dest / 'ok.zip', parsed, opener)
                a.extract_tar(dest / 'ok.zip', dest / 'ok.tar', m, SHA)
                self.assertEqual((dest / 'ok.tar').read_bytes(), TAR_BYTES)
                with self.assertRaises(ValueError):
                    a.copy_archive({**m, 'zipSha256': '0' * 64}, dest / 'bad.zip', parsed, opener)
                with self.assertRaises(ValueError):
                    a.copy_archive(m, dest / 'redirect.zip', a.validate_metadata({**m, 'url': 'https://' + HOST + '/redirect'}, {HOST}), opener)
                with self.assertRaises(ValueError):
                    a.extract_tar(dest / 'ok.zip', dest / 'bad.tar', m, '0' * 64)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_zip_member_and_sidecar_budgets_no_extraction_of_arbitrary_paths(self):
        with tempfile.TemporaryDirectory(prefix='flymind-artifact-test-') as directory:
            dest = Path(directory)
            for index, extra in enumerate(['../escape', 'arbitrary.txt', a.TAR]):
                payload = zipped(extra)
                path = dest / (str(index) + '.zip')
                path.write_bytes(payload)
                with self.assertRaises(ValueError):
                    a.extract_tar(path, dest / ('out' + str(index)), metadata(payload), SHA)
                self.assertFalse((dest / ('out' + str(index))).exists())
            payload = io.BytesIO()
            with zipfile.ZipFile(payload, 'w') as archive:
                member = zipfile.ZipInfo(a.TAR)
                member.create_system = 3
                member.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(member, b'/etc/passwd')
                archive.writestr(a.TAR + '.sha256', SHA + '  ' + a.TAR)
            path = dest / 'link.zip'
            path.write_bytes(payload.getvalue())
            with self.assertRaises(ValueError):
                a.extract_tar(path, dest / 'link.tar', metadata(payload.getvalue()), SHA)
            self.assertFalse((dest / 'link.tar').exists())

if __name__ == '__main__':
    unittest.main()
