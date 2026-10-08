"""Author lookup that doesn't trust the core parser.

The core takes the first link of *any* ``info-item``. Hako stopped printing the
author on novel pages, so that link is now the status ("Đang tiến hành"). Only
an item labelled "Tác giả" counts; otherwise the author is unknown.
"""
from bs4 import BeautifulSoup

_LABEL = 'tác giả'


def extract_author(series_info_html: str | None) -> str:
    if not series_info_html:
        return ''
    soup = BeautifulSoup(series_info_html, 'html.parser')
    for item in soup.find_all('div', class_='info-item'):
        name = item.find(class_='info-name')
        if not name or _LABEL not in name.get_text().lower():
            continue
        value = item.find(class_='info-value')
        if value is None:
            return ''
        anchor = value.find('a')
        return ' '.join((anchor or value).get_text().split())
    return ''
