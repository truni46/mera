# server/tests/knowledge/test_router_helpers.py
import os


def test_removeTempFile_deletes_existing(tmp_path):
    from modules.knowledge.router import _removeTempFile
    p = tmp_path / "r2_tmp.pdf"
    p.write_bytes(b"x")
    _removeTempFile(str(p))
    assert not p.exists()


def test_removeTempFile_ignores_missing(tmp_path):
    from modules.knowledge.router import _removeTempFile
    _removeTempFile(str(tmp_path / "nope.pdf"))


def test_router_imports_ok():
    import modules.knowledge.router  # noqa: F401