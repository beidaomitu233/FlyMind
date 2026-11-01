#!/usr/bin/env python3
"""Offline browser-only WOFF2 supply. Requires fonttools==4.60.1, brotli==1.1.0.
No network, user text or dynamic subsets. Renderer keeps the original fixed OTF.
"""
import hashlib
import json
from pathlib import Path
import sys
from fontTools import subset, version as fonttools_version
from fontTools.ttLib import TTFont
import brotli

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'resources/fonts/NotoSansCJKsc-Regular.otf'
SOURCE_SHA = '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b'
DEST = ROOT/'resources/fonts/web'


def sha(data): return hashlib.sha256(data).hexdigest()


def ranges(codes):
    runs = []
    for cp in sorted(codes):
        if runs and cp == runs[-1][1]+1: runs[-1][1] = cp
        else: runs.append([cp, cp])
    return ','.join('U+%X'%a if a == b else 'U+%X-%X'%(a,b) for a,b in runs)


def common_codes(cmap):
    result = set(range(0x100)) | set(range(0x2000,0x2070)) | set(range(0x3000,0x3040)) | set(range(0xff00,0xfff0))
    # GB2312 level-one 3755 Han characters; stdlib mapping, no external corpus.
    for a in range(0xb0,0xd8):
        for b in range(0xa1,0xff):
            try: result.add(ord(bytes([a,b]).decode('gb2312')))
            except UnicodeDecodeError: pass
    return result & set(cmap)


def build():
    assert fonttools_version == '4.60.1' and brotli.__version__ == '1.1.0', 'Pinned build tools required'
    assert sha(SOURCE.read_bytes()) == SOURCE_SHA, 'Fixed source font mismatch'
    original = TTFont(SOURCE, recalcTimestamp=False)
    cmap = original.getBestCmap(); common = common_codes(cmap)
    core_source=(ROOT/'scripts/browser-font-core.txt').read_text(encoding='utf8')
    core={ord(c) for line in core_source.splitlines() if not line.startswith('#') for c in line} & set(cmap)
    core |= {cp for cp in common if cp<0x3400 or cp>=0xff00}
    remaining_common=sorted(common-core); rest=sorted(set(cmap)-common-core)
    partitions = [('core', sorted(core))]+[('common-%03d'%(i//256),remaining_common[i:i+256]) for i in range(0,len(remaining_common),256)]+[('rare-%03d'%(i//512),rest[i:i+512]) for i in range(0,len(rest),512)]
    source_uvs={cp:seq for t in original['cmap'].tables if t.format==14 for cp,seq in t.uvsDict.items()}
    DEST.mkdir(parents=True,exist_ok=True); files = []; covered = set()
    for name, codes in partitions:
        font = TTFont(SOURCE, recalcTimestamp=False)
        options = subset.Options(); options.layout_features=['*']; options.name_IDs=['*']; options.name_legacy=True; options.name_languages=['*']; options.notdef_outline=True
        tool = subset.Subsetter(options=options); tool.populate(unicodes=set(codes)|set(source_uvs)); tool.subset(font)
        # Derivative internal names avoid Reserved Font Name ambiguity. Original
        # copyright/license records are retained; CSS legacy aliases are logical.
        for record in font['name'].names:
            if record.nameID in (1,3,4,6,16,17):
                value = {1:'FlyMind CJK Web',3:'FlyMind-CJK-Web-'+name,4:'FlyMind CJK Web Regular',6:'FlyMindCJKWeb-'+name,16:'FlyMind CJK Web',17:'Regular'}[record.nameID]
                record.string=value.encode(record.getEncoding())
        font.flavor='woff2'; font.recalcTimestamp=False
        file='FlyMindCJKWeb-'+name+'.woff2'; output=DEST/file; font.save(output)
        decoded=TTFont(output,recalcTimestamp=False); actual=decoded.getBestCmap()
        assert set(actual)==set(codes), 'Subset cmap changed'
        assert not covered.intersection(actual), 'Overlapping character coverage'
        for cp,glyph in actual.items():
            assert decoded['hmtx'][glyph] == original['hmtx'][cmap[cp]], 'Glyph horizontal metrics changed: U+%X'%cp
        assert decoded['head'].unitsPerEm == original['head'].unitsPerEm
        # The browser must retain source variation selectors for each base glyph.
        actual_uvs={cp:seq for t in decoded['cmap'].tables if t.format==14 for cp,seq in t.uvsDict.items()}
        for selector,seq in source_uvs.items():
            wanted={base for base,_glyph in seq if base in actual}
            assert {base for base,_glyph in actual_uvs.get(selector,[])} == wanted, 'Variation selector coverage changed'
        covered.update(actual); data=output.read_bytes()
        files.append({'file':file,'bytes':len(data),'sha256':sha(data),'unicodeRange':ranges(codes),'characters':len(codes),'glyphs':len(decoded.getGlyphOrder())})
        print(name,len(data),flush=True)
    assert covered==set(cmap), 'Source character coverage lost'
    manifest={'schemaVersion':1,'sourceSha256':SOURCE_SHA,'sourceCommit':'523d033d6cb47f4a80c58a35753646f5c3608a78','sourceURL':'https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78','license':'SIL Open Font License 1.1 (../OFL.txt)','derivativeFamily':'FlyMind CJK Web','tools':{'fonttools':'4.60.1','brotli':'1.1.0'},'characters':len(cmap),'metricsVerified':True,'files':files,'coreCorpusSha256':sha(core_source.encode('utf8')),'partitioning':{'common':256,'rare':512},'sourceGlyphs':len(original.getGlyphOrder())}
    encoded=(json.dumps(manifest,ensure_ascii=True,indent=2)+'\n').encode()
    (DEST/'manifest.json').write_bytes(encoded)
    module='// Generated by scripts/build-browser-fonts.py; fixed source, no user text.\nexport const BROWSER_FONT_MANIFEST='+json.dumps(manifest,separators=(',',':'))+' as const\n'
    (ROOT/'src/drawing/engine/browser-font-manifest.ts').write_text(module,encoding='utf8',newline='\n')
    print(json.dumps({'files':len(files),'totalBytes':sum(f['bytes'] for f in files),'commonBytes':files[0]['bytes'],'manifestSHA256':sha(encoded)}))


if __name__=='__main__': build()
