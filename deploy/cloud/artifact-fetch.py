"""Restricted artifact data plane. No GitHub token, shell, proxy or redirects."""
import hashlib
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
import stat
import tempfile
import time
import urllib.parse
import zipfile

MAX_BYTES = 2_000_000_000
TAR = 'flymind-linux-x64.tar.gz'
HOSTS_FILE = '/etc/flymind/artifact-download.json'


def configured_hosts():
    if not stat.S_ISREG(os.lstat(HOSTS_FILE).st_mode):
        raise ValueError('Artifact host config must be a regular file')
    path = HOSTS_FILE
    while True:
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Artifact host config ownership invalid')
        if path == '/':
            break
        path = os.path.dirname(path)
    with open(HOSTS_FILE, 'rb') as source:
        raw = source.read(8193)
    if len(raw) > 8192:
        raise ValueError('Artifact host config budget exceeded')
    value = json.loads(raw)
    if not isinstance(value, dict) or set(value) != {'schemaVersion', 'hosts'} or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or not isinstance(value['hosts'], list) or not 1 <= len(value['hosts']) <= 8:
        raise ValueError('Artifact host config invalid')
    for host in value['hosts']:
        if not isinstance(host, str) or not re.fullmatch(r'productionresults[a-z0-9]+\.blob\.core\.windows\.net', host):
            raise ValueError('Artifact host config not an exact approved storage host')
    return frozenset(value['hosts'])


def validate_metadata(value, hosts, now=None):
    now = time.time() * 1000 if now is None else now
    if not isinstance(value, dict) or set(value) != {'schemaVersion', 'artifactId', 'url', 'zipSha256', 'zipBytes', 'tarBytes', 'issuedAt'} or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ValueError('Artifact metadata invalid')
    for field in ('artifactId', 'zipBytes', 'tarBytes', 'issuedAt'):
        if type(value[field]) is not int or value[field] <= 0:
            raise ValueError('Artifact number invalid')
    if value['zipBytes'] > MAX_BYTES or value['tarBytes'] > MAX_BYTES or not -10000 <= now - value['issuedAt'] <= 60000 or not isinstance(value['zipSha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', value['zipSha256']):
        raise ValueError('Artifact metadata budget/expiry invalid')
    url = value['url']
    if not isinstance(url, str) or not 1 <= len(url) <= 12000 or any(ord(c) < 33 or ord(c) > 126 for c in url):
        raise ValueError('Artifact URL invalid')
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in hosts or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.fragment or not parsed.path.startswith('/'):
        raise ValueError('Artifact origin forbidden')
    return parsed


def public_addresses(host):
    addresses = list(dict.fromkeys(item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)))
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError('Artifact DNS returned a non-public address')
    return addresses


def pinned_open(parsed):
    # Connect to the already validated IP; do not resolve again after validation.
    address = public_addresses(parsed.hostname)[0]
    connection = http.client.HTTPSConnection(parsed.hostname, 443, timeout=20, context=ssl.create_default_context())
    raw = socket.create_connection((address, 443), timeout=20)
    try:
        connection.sock = connection._context.wrap_socket(raw, server_hostname=parsed.hostname)
        connection.request('GET', parsed.path + ('?' + parsed.query if parsed.query else ''), headers={'Host': parsed.hostname, 'Accept-Encoding': 'identity'})
        response = connection.getresponse()
        return connection, response
    except Exception:
        raw.close()
        connection.close()
        raise


def copy_archive(metadata, zip_path, parsed, opener=pinned_open):
    connection, response = opener(parsed)
    try:
        if response.status != 200 or response.getheader('Content-Encoding', 'identity') != 'identity':
            raise ValueError('Artifact download status refused')
        declared = response.getheader('Content-Length')
        if declared is not None and declared != str(metadata['zipBytes']):
            raise ValueError('Artifact length mismatch')
        size = 0
        digest = hashlib.sha256()
        deadline = time.monotonic() + 600
        with open(zip_path, 'xb') as target:
            os.chmod(zip_path, 0o600)
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                size += len(block)
                if size > metadata['zipBytes'] or time.monotonic() > deadline:
                    raise ValueError('Artifact download budget exceeded')
                digest.update(block)
                target.write(block)
            target.flush()
            os.fsync(target.fileno())
        if size != metadata['zipBytes'] or digest.hexdigest() != metadata['zipSha256']:
            raise ValueError('Artifact ZIP digest/size mismatch')
    finally:
        connection.close()


def extract_tar(zip_path, tar_path, metadata, expected):
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 2 or {item.filename for item in members} != {TAR, TAR + '.sha256'}:
            raise ValueError('Artifact ZIP members invalid')
        for item in members:
            mode = item.external_attr >> 16
            if item.is_dir() or item.flag_bits & 1 or item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in (0, stat.S_IFREG) or item.file_size < 1 or item.file_size > MAX_BYTES:
                raise ValueError('Artifact ZIP member type/size invalid')
        sidecar = archive.getinfo(TAR + '.sha256')
        if sidecar.file_size > 256:
            raise ValueError('Artifact digest sidecar budget exceeded')
        with archive.open(sidecar) as source:
            line = source.read(257).decode('ascii').strip()
        if not re.fullmatch(expected + r'\s+\*?' + re.escape(TAR), line):
            raise ValueError('Artifact tar sidecar mismatch')
        member = archive.getinfo(TAR)
        if member.file_size != metadata['tarBytes']:
            raise ValueError('Artifact tar size mismatch')
        digest = hashlib.sha256()
        size = 0
        deadline = time.monotonic() + 600
        with archive.open(member) as source, open(tar_path, 'xb') as target:
            os.chmod(tar_path, 0o600)
            for block in iter(lambda: source.read(1024 * 1024), b''):
                size += len(block)
                if size > metadata['tarBytes'] or time.monotonic() > deadline:
                    raise ValueError('Artifact inflated size exceeded')
                digest.update(block)
                target.write(block)
            target.flush()
            os.fsync(target.fileno())
        if size != metadata['tarBytes'] or digest.hexdigest() != expected:
            raise ValueError('Artifact tar digest mismatch')


def fetch_artifact(release, expected, metadata, incoming, existing_matches, hosts=None, opener=None):
    # Tests may inject a local fake data plane. Production entry never supplies
    # these arguments: it always loads root-owned hosts and uses pinned TLS.
    parsed = validate_metadata(metadata, configured_hosts() if hosts is None else hosts)
    directory = os.open(incoming, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if existing_matches(directory, release + '.tar.gz', expected):
            return {'uploaded': True, 'reused': True, 'releaseId': release, 'sha256': expected}
        with tempfile.TemporaryDirectory(prefix='.artifact-', dir=incoming) as temporary:
            os.chmod(temporary, 0o700)
            zipped = os.path.join(temporary, 'archive.zip')
            tar = os.path.join(temporary, 'archive.tar.gz')
            copy_archive(metadata, zipped, parsed, pinned_open if opener is None else opener)
            extract_tar(zipped, tar, metadata, expected)
            try:
                os.link(tar, release + '.tar.gz', dst_dir_fd=directory, follow_symlinks=False)
            except FileExistsError:
                if not existing_matches(directory, release + '.tar.gz', expected):
                    raise ValueError('Existing artifact cannot be reused')
            os.fsync(directory)
            return {'uploaded': True, 'releaseId': release, 'artifactId': metadata['artifactId'], 'bytes': metadata['tarBytes'], 'sha256': expected}
    finally:
        os.close(directory)
