"""Offline pinned build-tool validation; never requires production Python/pip."""
from pathlib import Path
import hashlib
import json
import unittest
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen

ROOT=Path(__file__).resolve().parents[1]


class FontSupply(unittest.TestCase):
    def test_every_source_codepoint_metrics_and_representative_outlines(self):
        source=TTFont(ROOT/'resources/fonts/NotoSansCJKsc-Regular.otf',recalcTimestamp=False)
        original=source.getBestCmap();seen=set();original_glyphs=source.getGlyphSet()
        manifest=json.loads((ROOT/'resources/fonts/web/manifest.json').read_text(encoding='utf8'))
        total_glyphs=0
        for file in manifest['files']:
            data=(ROOT/'resources/fonts/web'/file['file']).read_bytes();self.assertEqual(hashlib.sha256(data).hexdigest(),file['sha256'])
            font=TTFont(ROOT/'resources/fonts/web'/file['file'],recalcTimestamp=False);cmap=font.getBestCmap();self.assertFalse(seen.intersection(cmap));seen.update(cmap);glyphs=font.getGlyphSet()
            for cp,glyph in cmap.items():self.assertEqual(font['hmtx'][glyph],source['hmtx'][original[cp]],hex(cp))
            # Actual outlines, not only advance widths, across every shard.
            for cp in (min(cmap),sorted(cmap)[len(cmap)//2],max(cmap)):
                before=DecomposingRecordingPen(original_glyphs);after=DecomposingRecordingPen(glyphs);original_glyphs[original[cp]].draw(before);glyphs[cmap[cp]].draw(after);self.assertEqual(before.value,after.value,hex(cp))
            total_glyphs+=len(font.getGlyphOrder())
        self.assertEqual(seen,set(original));self.assertEqual(len(seen),44810)
        print(json.dumps({'sourceGlyphs':len(source.getGlyphOrder()),'sourceCodepoints':len(original),'shards':len(manifest['files']),'sumShardGlyphsIncludingLayoutClosure':total_glyphs}))


if __name__=='__main__':unittest.main()
