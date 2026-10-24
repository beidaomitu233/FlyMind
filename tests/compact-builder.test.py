import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import random
import tarfile
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('compact_builder', Path(__file__).resolve().parents[1]/'scripts/build-compact-candidate.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def jar(dependency, code=b'old code', timestamp=(2020, 1, 1, 0, 0, 0), prefix=b''):
    stream = io.BytesIO()
    stream.write(prefix)
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in [('BOOT-INF/lib/common.jar', dependency), ('BOOT-INF/classes/App.class', code)]:
            item = zipfile.ZipInfo(name, timestamp)
            item.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(item, payload)
        archive.comment = str(timestamp[0]).encode()
    return stream.getvalue()


def candidate(root, values, release, source):
    root.mkdir()
    files = []
    for name, content in values.items():
        target = root/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        files.append({'path':name, 'bytes':len(content), 'sha256':hashlib.sha256(content).hexdigest()})
    value = {'schemaVersion':1,'releaseId':release,'sourceCommit':source*40,'prepared':True,'dirty':False,'platform':'linux','arch':'x64','node':'v22.23.3','abi':'127','files':files}
    raw = (json.dumps(value, indent=3)+'\n').encode()
    (root/'candidate.json').write_bytes(raw)
    return raw


class CompactTests(unittest.TestCase):
    def test_exact_delta_payload_removed_files_raw_manifest_and_compressed_jar_replay(self):
        rng = random.Random(9)
        dependency = rng.randbytes(256 * 1024)
        old_jar = jar(dependency, b'old code', prefix=b'old boot prefix\n')
        new_jar = jar(dependency, b'new changed App class', (2024, 10, 24, 1, 2, 4), prefix=b'new prefix\n')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, new = root/'old', root/'new'
            candidate(old, {'application/lib/keep.js':b'keep','application/lib/change.js':b'old','application/lib/deleted.js':b'delete',b.JAR:old_jar}, 'run-old-1','a')
            raw = candidate(new, {'application/lib/keep.js':b'keep','application/lib/change.js':b'new','application/lib/added.js':b'add',b.JAR:new_jar}, 'run-new-1','b')
            before = {p.relative_to(old).as_posix():p.read_bytes() for p in old.rglob('*') if p.is_file()}
            output = root/'flymind-linux-x64.tar.gz'
            report = b.build_compact(old, new, output, root/'report.json')
            with tarfile.open(output, 'r:gz') as archive:
                names = archive.getnames()
                self.assertNotIn('application/lib/keep.js', names)
                self.assertNotIn('application/lib/deleted.js', names)
                self.assertNotIn(b.JAR, names)
                self.assertEqual(archive.extractfile('candidate.json').read(), raw)
                overlay = json.load(archive.extractfile('overlay.json'))
                self.assertEqual(set(overlay), {'schemaVersion','format','baseReleaseId','baseSourceCommit','baseCandidateSHA256','targetCandidateSHA256','patches'})
                self.assertEqual(overlay['targetCandidateSHA256'], hashlib.sha256(raw).hexdigest())
                self.assertEqual(len(overlay['patches']), 1)
                patch = overlay['patches'][0]
                literal = root/'literal.bin'
                literal.write_bytes(archive.extractfile(patch['literalPath']).read())
                self.assertEqual(set(names), {'candidate.json','overlay.json','application/lib/change.js','application/lib/added.js',patch['literalPath']})
                self.assertEqual(b.file_sha(literal), patch['literalSHA256'])
                with open(root/'replayed.jar','wb') as result:
                    replay = b.replay_patch(old/b.JAR, literal, patch['operations'], result)
                self.assertEqual((root/'replayed.jar').read_bytes(), new_jar)
                self.assertEqual(replay['sha256'], hashlib.sha256(new_jar).hexdigest())
                regions = set(b.compressed_regions(old/b.JAR))
                copied = [op for op in patch['operations'] if op['from']=='base']
                self.assertTrue(copied)
                self.assertTrue(all((op['offset'],op['bytes']) in regions for op in copied))
                self.assertGreater(report['jarCopiedBytes'], 250000)
                self.assertLess(report['archiveBytes'], len(new_jar)//10)
            self.assertEqual(report['deletedFiles'],1)
            self.assertEqual(report['fullPayloadFiles'],2)
            self.assertEqual(report['unchangedFiles'],1)
            self.assertEqual(json.loads((root/'report.json').read_bytes()),report)
            self.assertEqual((Path(str(output)+'.sha256')).read_text().strip(),b.file_sha(output)+'  '+output.name)
            self.assertEqual(before,{p.relative_to(old).as_posix():p.read_bytes() for p in old.rglob('*') if p.is_file()})

    def test_unmatched_or_invalid_jar_falls_back_to_complete_original_bytes(self):
        rng = random.Random(10)
        for old_jar, new_jar in [(jar(rng.randbytes(4000)),jar(rng.randbytes(4000),b'different')),(b'not a zip',b'new not a zip'),(jar(b'tiny shared',b'a'),jar(b'tiny shared',b'b'))]:
            with self.subTest(size=len(new_jar)), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                candidate(root/'old',{b.JAR:old_jar},'old','a')
                candidate(root/'new',{b.JAR:new_jar},'new','b')
                result = b.build_compact(root/'old',root/'new',root/'overlay.tar.gz')
                self.assertEqual(result['jarCopiedBytes'],0)
                with tarfile.open(root/'overlay.tar.gz') as archive:
                    self.assertEqual(archive.extractfile(b.JAR).read(),new_jar)
                    self.assertEqual(json.load(archive.extractfile('overlay.json'))['patches'],[])
                    self.assertFalse(any(name.startswith('_overlay/') for name in archive.getnames()))

    def test_replay_rejects_unknown_fields_bad_offsets_bool_and_output_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'base').write_bytes(b'base')
            (root/'literal').write_bytes(b'new')
            invalid = [[],[{'from':'base','offset':0,'bytes':1,'execute':'x'}],[{'from':'base','offset':-1,'bytes':1}],[{'from':'base','offset':False,'bytes':1}],[{'from':'base','offset':3,'bytes':2}],[{'from':'other','offset':0,'bytes':1}],[{'from':'literal','offset':0,'bytes':4}]]
            for ops in invalid:
                with self.subTest(ops=ops),self.assertRaises(ValueError):
                    b.replay_patch(root/'base',root/'literal',ops)

    def test_tampered_candidates_extra_files_unknown_entry_and_output_inside_input_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            candidate(root/'old',{'a':b'old'},'old','a')
            raw=candidate(root/'new',{'a':b'new'},'new','b')
            (root/'new'/'a').write_bytes(b'bad')
            with self.assertRaisesRegex(ValueError,'CANDIDATE_FILE_DIGEST'):
                b.build_compact(root/'old',root/'new',root/'out.tar.gz')
            (root/'new'/'a').write_bytes(b'new')
            (root/'new'/'extra').write_bytes(b'extra')
            with self.assertRaisesRegex(ValueError,'CANDIDATE_UNREGISTERED_FILE'):
                b.build_compact(root/'old',root/'new',root/'out.tar.gz')
            (root/'new'/'extra').unlink()
            value=json.loads(raw)
            value['files'][0]['command']='execute'
            (root/'new'/'candidate.json').write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'CANDIDATE_FILE_INVALID'):
                b.build_compact(root/'old',root/'new',root/'out.tar.gz')
            (root/'new'/'candidate.json').write_bytes(raw)
            with self.assertRaisesRegex(ValueError,'OUTPUT_INSIDE_CANDIDATE'):
                b.build_compact(root/'old',root/'new',root/'new'/'out.tar.gz')
            self.assertFalse((root/'out.tar.gz').exists())
            for name in ['../escape','_overlay','_overlay/file','overlay.json/child','candidate.json/child']:
                with self.assertRaises(ValueError):
                    b.safe_path(name)

    def test_zero_delta_deterministic_archive_and_exclusive_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            candidate(root/'old',{'same':b'same'},'old','a')
            candidate(root/'new',{'same':b'same'},'new','b')
            b.build_compact(root/'old',root/'new',root/'one.tar.gz')
            b.build_compact(root/'old',root/'new',root/'two.tar.gz')
            self.assertEqual((root/'one.tar.gz').read_bytes(),(root/'two.tar.gz').read_bytes())
            with self.assertRaisesRegex(ValueError,'OUTPUT_EXISTS'):
                b.build_compact(root/'old',root/'new',root/'one.tar.gz')
            with tarfile.open(root/'one.tar.gz') as archive:
                self.assertEqual(archive.getnames(),['candidate.json','overlay.json'])

    @unittest.skipUnless(os.name=='posix','Real symlink fixture requires POSIX, not simulated on Windows')
    def test_target_links_come_only_from_manifest_and_deleted_base_link_not_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            candidate(root/'old',{'target':b'target'},'old','a')
            raw=candidate(root/'new',{'target':b'target'},'new','b')
            (root/'new'/'link').symlink_to('target')
            value=json.loads(raw)
            value['files'].append({'path':'link','type':'symlink','target':'target'})
            (root/'new'/'candidate.json').write_text(json.dumps(value))
            b.build_compact(root/'old',root/'new',root/'out.tar.gz')
            with tarfile.open(root/'out.tar.gz') as archive:
                self.assertEqual(archive.getnames(),['candidate.json','overlay.json'])
            (root/'new'/'link').unlink()
            (root/'new'/'link').symlink_to('../outside')
            with self.assertRaises(ValueError):
                b.candidate(root/'new')


if __name__=='__main__':
    unittest.main()
