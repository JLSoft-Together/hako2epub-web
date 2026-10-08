import json

import pytest

from conftest import ROOT
from hako2epub import tracker
from hako2epub.models import Chapter


def load(name):
    path = ROOT / 'fixtures' / 'tracker' / f'{name}.json'
    return json.loads(path.read_text(encoding='utf-8'))


def cases(name):
    return pytest.mark.parametrize('case', load(name), ids=lambda c: c['name'])


@cases('find_novel')
def test_find_novel(case):
    assert tracker.find_novel(case['data'], **case['args']) == case['expected']


@cases('new_chapters')
def test_new_chapters(case):
    a = case['args']
    entry = tracker.find_novel(case['data'], a['ln_url'])
    live = [Chapter(name=n) for n in a['live']]
    result = tracker.new_chapters(entry, a['vol_name'], live)
    assert [c.name for c in result] == case['expected']


@cases('remove_volume')
def test_remove_volume(case):
    assert tracker.remove_volume(case['data'], **case['args']) == case['expected']


@cases('remove_novel')
def test_remove_novel(case):
    assert tracker.remove_novel(case['data'], **case['args']) == case['expected']
