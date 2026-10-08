import json
import re

import pytest

from conftest import ROOT
from hako_worker.ids import InvalidNovelUrl, asset_name, canonical_url, novel_id

CASES = json.loads((ROOT / 'fixtures/ids.json').read_text(encoding='utf-8'))


@pytest.mark.parametrize('case', CASES, ids=lambda c: c['input'])
def test_canonical_and_id(case):
    if case['canonical'] is None:
        with pytest.raises(InvalidNovelUrl):
            canonical_url(case['input'])
    else:
        assert canonical_url(case['input']) == case['canonical']
        assert novel_id(case['input']) == case['novel_id']


def test_asset_name_vietnamese():
    name = asset_name('Tập 3 - Đại Ma Vương.epub')
    assert name.startswith('tap-3-dai-ma-vuong-') and name.endswith('.epub')
    assert re.fullmatch(r'[a-z0-9-]+\.epub', name)


def test_asset_name_long_and_symbols_is_bounded():
    name = asset_name('Tập 1: "Hỏi/Đáp"? 😀 ' + 'x' * 300 + '.epub')
    assert re.fullmatch(r'[a-z0-9-]+-[0-9a-f]{8}\.epub', name)
    assert len(name) <= 80 + 1 + 8 + 5


def test_asset_name_distinguishes_similar_names():
    assert asset_name('Tập 1 - A.epub') != asset_name('Tap 1 - A.epub')


def test_asset_name_suffix_is_sha1_of_filename():
    import hashlib
    expected = hashlib.sha1('a.epub'.encode('utf-8')).hexdigest()[:8]
    assert asset_name('a.epub') == 'a-' + expected + '.epub'
    assert asset_name('a.epub') == 'a-6507318e.epub'


def test_asset_name_fixed_vector_vietnamese():
    assert asset_name('Tập 3 - Đại Ma Vương.epub') == 'tap-3-dai-ma-vuong-a267e305.epub'
