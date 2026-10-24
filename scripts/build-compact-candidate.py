"""Build a bounded overlay of two already verified prepared candidates; stdlib only.
Never rebuild business code/JARs or rewrite the target candidate.json bytes.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import struct
import tarfile
import tempfile
import zipfile

MAX_FILE = 2_000_000_000
MAX_TOTAL = 4_000_000_000
MAX_MEMBERS = 100_000
MAX_OPS = 200_000
MAX_MANIFEST = 2 * 1024 * 1024
MAX_OVERLAY = 16 * 1024 * 1024
MAX_CENTRAL = 32 * 1024 * 1024
JAR = 'control-plane/system-admin.jar'
SHA = re.compile(r'[a-f0-9]{64}')
ID = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}')


def require(condition, code):
    if not condition:
        raise ValueError(code)


def strict_json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, 'DUPLICATE_JSON_KEY')
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs)


def encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode('ascii')


def safe_path(name):
    require(isinstance(name, str) and 0 < len(name) <= 2048 and not any(ord(c) < 32 for c in name) and ':' not in name and '\\' not in name and not name.startswith('/') and all(p not in ('', '.', '..') for p in name.split('/')), 'UNSAFE_CANDIDATE_PATH')
    require(name.split('/')[0] not in ('candidate.json', 'overlay.json', '_overlay'), 'RESERVED_CANDIDATE_PATH')
    return name


def integer(value, maximum):
    return type(value) is int and 0 <= value <= maximum


def hash_region(source, offset=0, size=None, output=None):
    source.seek(offset)
    digest = hashlib.sha256()
    count = 0
    while size is None or count < size:
        block = source.read(min(1024 * 1024, size - count) if size is not None else 1024 * 1024)
        if not block:
            break
        count += len(block)
        digest.update(block)
        if output is not None:
            output.write(block)
    require(size is None or count == size, 'SOURCE_READ_INCOMPLETE')
    return count, digest.hexdigest()


def file_sha(path):
    with open(path, 'rb') as source:
        return hash_region(source)[1]


def candidate(root):
    root = Path(root).absolute()
    require(root.is_dir() and not root.is_symlink() and root.resolve() == root, 'CANDIDATE_ROOT_REDIRECT')
    metadata = root / 'candidate.json'
    require(metadata.is_file() and not metadata.is_symlink() and metadata.stat().st_size <= MAX_MANIFEST, 'CANDIDATE_METADATA_INVALID')
    raw = metadata.read_bytes()
    value = strict_json(raw)
    require(isinstance(value, dict) and type(value.get('schemaVersion')) is int and value['schemaVersion'] == 1 and value.get('prepared') is True and value.get('dirty') is False and isinstance(value.get('releaseId'), str) and ID.fullmatch(value['releaseId']) and isinstance(value.get('sourceCommit'), str) and re.fullmatch(r'[a-f0-9]{40}', value['sourceCommit']) and isinstance(value.get('files'), list) and len(value['files']) < MAX_MEMBERS - 2, 'CANDIDATE_NOT_PREPARED')
    files = {}
    total = 0
    for item in value['files']:
        require(isinstance(item, dict), 'CANDIDATE_ENTRY_INVALID')
        name = safe_path(item.get('path'))
        require(name not in files, 'CANDIDATE_DUPLICATE_PATH')
        path = root / name
        for parent in path.parents:
            if parent == root:
                break
            require(parent.is_dir() and not parent.is_symlink(), 'CANDIDATE_PARENT_REDIRECT')
        info = path.lstat()
        if item.get('type') == 'symlink':
            require(set(item) == {'path', 'type', 'target'} and isinstance(item['target'], str) and stat.S_ISLNK(info.st_mode) and os.readlink(path) == item['target'] and not os.path.isabs(item['target']) and '\\' not in item['target'] and ':' not in item['target'], 'CANDIDATE_LINK_INVALID')
            try:
                resolved = path.resolve(strict=True)
            except (OSError, RuntimeError):
                raise ValueError('CANDIDATE_LINK_INVALID') from None
            require(root in resolved.parents, 'CANDIDATE_LINK_ESCAPE')
        else:
            require(set(item) == {'path', 'bytes', 'sha256'} and integer(item.get('bytes'), MAX_FILE) and isinstance(item.get('sha256'), str) and SHA.fullmatch(item['sha256']) and stat.S_ISREG(info.st_mode) and info.st_size == item['bytes'], 'CANDIDATE_FILE_INVALID')
            require(file_sha(path) == item['sha256'], 'CANDIDATE_FILE_DIGEST')
            total += item['bytes']
            require(total <= MAX_TOTAL, 'CANDIDATE_TOTAL_BUDGET')
        files[name] = item
    found = set()
    def walk(directory, prefix=''):
        for entry in os.scandir(directory):
            name = prefix + entry.name
            if entry.is_dir(follow_symlinks=False):
                walk(entry.path, name + '/')
            else:
                found.add(name)
                require(len(found) <= MAX_MEMBERS, 'CANDIDATE_MEMBER_BUDGET')
    walk(root)
    require(found == set(files) | {'candidate.json'}, 'CANDIDATE_UNREGISTERED_FILE')
    return {'root': root, 'raw': raw, 'manifest': value, 'files': files, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': total + len(raw)}


def compressed_regions(path):
    """Locate raw compressed ranges only. Never extract/recompress JAR members.
    ZIP64/encrypted/oversized central indices fall back to the full JAR.
    """
    size = path.stat().st_size
    with open(path, 'rb') as source:
        source.seek(max(0, size - 65557))
        tail = source.read(65557)
        end = tail.rfind(b'PK\x05\x06')
        require(end >= 0 and end + 22 <= len(tail), 'JAR_ZIP_INDEX')
        fields = struct.unpack_from('<4s4H2IH', tail, end)
        _, disk, central_disk, disk_count, count, central_bytes, central_offset, comment = fields
        require(disk == central_disk == 0 and disk_count == count and count < 65535 and count < MAX_MEMBERS and central_bytes <= MAX_CENTRAL and central_offset != 0xffffffff and central_offset + central_bytes <= size and end + 22 + comment == len(tail), 'JAR_ZIP_INDEX_BUDGET')
        with zipfile.ZipFile(source) as archive:
            require(len(archive.infolist()) == count, 'JAR_ZIP_INDEX')
            regions = []
            for item in archive.infolist():
                require(not item.flag_bits & 1 and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and integer(item.compress_size, MAX_FILE) and integer(item.header_offset, MAX_FILE), 'JAR_ZIP_UNSUPPORTED')
                source.seek(item.header_offset)
                header = source.read(30)
                require(len(header) == 30 and header[:4] == b'PK\x03\x04', 'JAR_LOCAL_HEADER')
                name_size, extra_size = struct.unpack_from('<HH', header, 26)
                offset = item.header_offset + 30 + name_size + extra_size
                require(offset + item.compress_size <= size, 'JAR_PAYLOAD_BOUNDS')
                if item.compress_size:
                    regions.append((offset, item.compress_size))
            regions.sort()
            for before, after in zip(regions, regions[1:]):
                require(before[0] + before[1] <= after[0], 'JAR_PAYLOAD_OVERLAP')
            return regions


def replay_patch(base, literal, operations, output=None):
    require(isinstance(operations, list) and 0 < len(operations) <= MAX_OPS, 'PATCH_OPERATION_BUDGET')
    digest = hashlib.sha256()
    total = 0
    with open(base, 'rb') as old, open(literal, 'rb') as new:
        sizes = {'base': os.fstat(old.fileno()).st_size, 'literal': os.fstat(new.fileno()).st_size}
        for operation in operations:
            require(isinstance(operation, dict) and set(operation) == {'from', 'offset', 'bytes'} and operation['from'] in ('base', 'literal') and integer(operation['offset'], MAX_FILE) and integer(operation['bytes'], MAX_FILE) and operation['bytes'] > 0 and operation['offset'] + operation['bytes'] <= sizes[operation['from']], 'PATCH_OPERATION_INVALID')
            total += operation['bytes']
            require(total <= MAX_FILE, 'PATCH_OUTPUT_BUDGET')
            source = old if operation['from'] == 'base' else new
            source.seek(operation['offset'])
            remaining = operation['bytes']
            while remaining:
                block = source.read(min(1024 * 1024, remaining))
                require(bool(block), 'PATCH_SOURCE_INCOMPLETE')
                digest.update(block)
                if output is not None:
                    output.write(block)
                remaining -= len(block)
    return {'bytes': total, 'sha256': digest.hexdigest()}


def jar_patch(base, target, literal, target_sha):
    """Return a verified useful patch, or None for an ordinary full-file payload."""
    try:
        index = {}
        with open(base, 'rb') as old:
            for offset, count in compressed_regions(base):
                index.setdefault((count, hash_region(old, offset, count)[1]), offset)
        operations = []
        literal_bytes = 0
        copied_bytes = 0
        def operation(kind, offset, count):
            if not count:
                return
            if operations and operations[-1]['from'] == kind and operations[-1]['offset'] + operations[-1]['bytes'] == offset:
                operations[-1]['bytes'] += count
            else:
                operations.append({'from': kind, 'offset': offset, 'bytes': count})
            require(len(operations) <= MAX_OPS, 'PATCH_OPERATION_BUDGET')
        with open(target, 'rb') as new, open(literal, 'xb') as output:
            def append(offset, count):
                nonlocal literal_bytes
                if count:
                    hash_region(new, offset, count, output)
                    operation('literal', literal_bytes, count)
                    literal_bytes += count
            cursor = 0
            for offset, count in compressed_regions(target):
                append(cursor, offset - cursor)
                digest = hash_region(new, offset, count)[1]
                original = index.get((count, digest))
                if original is None:
                    append(offset, count)
                else:
                    operation('base', original, count)
                    copied_bytes += count
                cursor = offset + count
            append(cursor, target.stat().st_size - cursor)
        result = replay_patch(base, literal, operations)
        require(result == {'bytes': target.stat().st_size, 'sha256': target_sha}, 'PATCH_REPLAY_DIGEST')
        require(copied_bytes > 0 and literal_bytes + len(encoded(operations)) + 512 < target.stat().st_size, 'PATCH_NOT_SMALLER')
        return {'operations': operations, 'literalSHA256': file_sha(literal), 'copiedBytes': copied_bytes, 'literalBytes': literal_bytes}
    except (ValueError, OSError, zipfile.BadZipFile, struct.error, OverflowError):
        if Path(literal).exists():
            Path(literal).unlink()
        return None


def build_compact(baseline, target, output, report_path=None):
    base = candidate(baseline)
    new = candidate(target)
    require(base['root'] != new['root'], 'BASE_EQUALS_TARGET')
    for field in ('platform', 'arch', 'node', 'abi'):
        require(base['manifest'].get(field) == new['manifest'].get(field) and field in new['manifest'], 'CANDIDATE_PLATFORM_MISMATCH')
    output = Path(output).absolute()
    require(output.parent.resolve() == output.parent, 'OUTPUT_PARENT_REDIRECT')
    for root in (base['root'], new['root']):
        require(output != root and root not in output.parents, 'OUTPUT_INSIDE_CANDIDATE')
    require(not output.exists() and not output.is_symlink() and not Path(str(output) + '.sha256').exists(), 'OUTPUT_EXISTS')
    if report_path is not None:
        report_path = Path(report_path).absolute()
        require(report_path.parent.resolve() == report_path.parent, 'REPORT_PARENT_REDIRECT')
        require(not report_path.exists() and all(root not in report_path.parents for root in (base['root'], new['root'])) and report_path not in (output, Path(str(output)+'.sha256')), 'REPORT_PATH_INVALID')
    overlay = {'schemaVersion': 1, 'format': 'flymind-overlay', 'baseReleaseId': base['manifest']['releaseId'], 'baseSourceCommit': base['manifest']['sourceCommit'], 'baseCandidateSHA256': base['sha256'], 'targetCandidateSHA256': new['sha256'], 'patches': []}
    stats = {'schemaVersion': 1, 'baseReleaseId': base['manifest']['releaseId'], 'releaseId': new['manifest']['releaseId'], 'sourceCommit': new['manifest']['sourceCommit'], 'baseCandidateSHA256': base['sha256'], 'targetCandidateSHA256': new['sha256'], 'targetTreeBytes': new['bytes'], 'unchangedFiles': 0, 'reusedFileBytes': 0, 'fullPayloadFiles': 0, 'fullPayloadBytes': 0, 'symlinks': 0, 'deletedFiles': len(set(base['files'])-set(new['files'])), 'jarCopiedBytes': 0, 'jarLiteralBytes': 0}
    payload = []
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='flymind-compact-') as temporary:
        for name, item in sorted(new['files'].items()):
            old = base['files'].get(name)
            if item.get('type') == 'symlink':
                stats['symlinks'] += 1
                continue
            if old == item:
                stats['unchangedFiles'] += 1
                stats['reusedFileBytes'] += item['bytes']
                continue
            patch = None
            literal = Path(temporary) / (item['sha256'] + '.bin')
            if name == JAR and old is not None and old.get('type') is None:
                patch = jar_patch(base['root']/name, new['root']/name, literal, item['sha256'])
            if patch is not None:
                literal_path = '_overlay/patches/' + item['sha256'] + '.bin'
                overlay['patches'].append({'path': name, 'baseSHA256': old['sha256'], 'literalPath': literal_path, 'literalSHA256': patch['literalSHA256'], 'operations': patch['operations']})
                payload.append((literal_path, literal))
                stats['jarCopiedBytes'] += patch['copiedBytes']
                stats['jarLiteralBytes'] += patch['literalBytes']
            else:
                payload.append((name, new['root']/name))
                stats['fullPayloadFiles'] += 1
                stats['fullPayloadBytes'] += item['bytes']
        overlay_bytes = encoded(overlay)
        require(len(overlay_bytes) <= MAX_OVERLAY and len(payload) + 2 < MAX_MEMBERS and len(new['raw']) + len(overlay_bytes) + sum(path.stat().st_size for _, path in payload) <= MAX_TOTAL, 'OVERLAY_BUDGET')
        created = sidecar_created = report_created = False
        try:
            with open(output, 'xb') as raw:
                created = True
                with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as archive:
                    def add(name, size, source, mode=0o644):
                        header = tarfile.TarInfo(name)
                        header.size = size
                        header.mode = mode
                        header.uid = header.gid = 0
                        header.mtime = 0
                        archive.addfile(header, source)
                    add('candidate.json', len(new['raw']), io.BytesIO(new['raw']))
                    add('overlay.json', len(overlay_bytes), io.BytesIO(overlay_bytes))
                    for name, path in payload:
                        with open(path, 'rb') as source:
                            add(name, path.stat().st_size, source, 0o755 if path.stat().st_mode & 0o111 else 0o644)
            require(output.stat().st_size <= MAX_FILE, 'ARCHIVE_BUDGET')
            stats['archiveBytes'] = output.stat().st_size
            stats['archiveSHA256'] = file_sha(output)
            with open(str(output)+'.sha256', 'x', encoding='ascii', newline='\n') as sidecar:
                sidecar_created = True
                sidecar.write(stats['archiveSHA256'] + '  ' + output.name + '\n')
            if report_path is not None:
                with open(report_path, 'x', encoding='utf-8', newline='\n') as report:
                    report_created = True
                    report.write(json.dumps(stats, indent=2, sort_keys=True)+'\n')
        except Exception:
            if created:
                output.unlink(missing_ok=True)
            if sidecar_created:
                Path(str(output)+'.sha256').unlink(missing_ok=True)
            if report_created:
                report_path.unlink(missing_ok=True)
            raise
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--target', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--report', required=True)
    options = parser.parse_args()
    try:
        result = build_compact(options.baseline, options.target, options.output, options.report)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, zipfile.BadZipFile):
        raise SystemExit('COMPACT_BUILD_REFUSED') from None


if __name__ == '__main__':
    main()
