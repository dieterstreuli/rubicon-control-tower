import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import docs_dir  # noqa: E402


def test_default_uses_public():
    os.environ.pop('RUBICON_DOCS_DIR', None)
    assert docs_dir('reports', '/app') == os.path.join('/app', 'public', 'reports')


def test_env_override():
    os.environ['RUBICON_DOCS_DIR'] = '/vol/_generated'
    try:
        assert docs_dir('protokolle', '/app') == os.path.join('/vol/_generated', 'protokolle')
    finally:
        os.environ.pop('RUBICON_DOCS_DIR', None)


if __name__ == '__main__':
    test_default_uses_public()
    test_env_override()
    print('docs_dir: 2/2 gruen')
