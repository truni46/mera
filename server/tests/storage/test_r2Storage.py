# server/tests/storage/test_r2Storage.py
import asyncio
from unittest.mock import MagicMock

import pytest


class FakeBody:
    def __init__(self, data: bytes):
        self._data = data

    def read(self):
        return self._data

    def close(self):
        pass


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_isR2Key_prefixes():
    from modules.storage.r2Storage import isR2Key
    assert isR2Key("documents/abc/file.pdf") is True
    assert isR2Key("ocr/abc.md") is True
    assert isR2Key(r"C:\data\uploads\x.pdf") is False
    assert isR2Key("/var/uploads/x.pdf") is False
    assert isR2Key(None) is False


def test_enabled_reflects_env(monkeypatch):
    from modules.storage.r2Storage import r2Storage
    monkeypatch.setenv("R2_ENABLED", "true")
    assert r2Storage.enabled is True
    monkeypatch.setenv("R2_ENABLED", "false")
    assert r2Storage.enabled is False


def test_uploadBytes_calls_put_object(monkeypatch):
    from modules.storage.r2Storage import r2Storage
    fakeS3 = MagicMock()
    fakeS3.put_object = MagicMock()
    monkeypatch.setattr(r2Storage, "_client", lambda: fakeS3)
    monkeypatch.setenv("R2_ENABLED", "true")
    key = _run(r2Storage.uploadBytes(b"hello", "documents/1/a.pdf", "application/pdf"))
    assert key == "documents/1/a.pdf"
    putKwargs = fakeS3.put_object.call_args.kwargs
    assert putKwargs["Bucket"] == "mera"
    assert putKwargs["Key"] == "documents/1/a.pdf"
    assert putKwargs["ContentType"] == "application/pdf"
    assert putKwargs["Body"] == b"hello"


def test_uploadBytes_raises_on_failure(monkeypatch):
    from modules.storage.r2Storage import r2Storage
    fakeS3 = MagicMock()
    fakeS3.put_object = MagicMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr(r2Storage, "_client", lambda: fakeS3)
    monkeypatch.setenv("R2_ENABLED", "true")
    with pytest.raises(RuntimeError):
        _run(r2Storage.uploadBytes(b"x", "documents/1/a.pdf", "application/pdf"))


def test_downloadToTemp_writes_object_bytes(monkeypatch, tmp_path):
    from modules.storage.r2Storage import r2Storage
    fakeS3 = MagicMock()
    fakeS3.get_object = MagicMock(return_value={"Body": FakeBody(b"pdf-bytes")})
    monkeypatch.setattr(r2Storage, "_client", lambda: fakeS3)
    monkeypatch.setattr("tempfile.gettempdir", lambda: str(tmp_path))
    monkeypatch.setenv("R2_ENABLED", "true")
    path = _run(r2Storage.downloadToTemp("documents/1/a.pdf"))
    with open(path, "rb") as f:
        assert f.read() == b"pdf-bytes"
    assert path.endswith(".pdf")


def test_downloadToTemp_raises_on_failure(monkeypatch):
    from modules.storage.r2Storage import r2Storage
    fakeS3 = MagicMock()
    fakeS3.get_object = MagicMock(side_effect=RuntimeError("no object"))
    monkeypatch.setattr(r2Storage, "_client", lambda: fakeS3)
    monkeypatch.setenv("R2_ENABLED", "true")
    with pytest.raises(RuntimeError):
        _run(r2Storage.downloadToTemp("ocr/1.md"))


def test_readText_returns_limited_content(monkeypatch):
    from modules.storage.r2Storage import r2Storage
    fakeS3 = MagicMock()
    fakeS3.get_object = MagicMock(return_value={"Body": FakeBody("abcdefgh".encode())})
    monkeypatch.setattr(r2Storage, "_client", lambda: fakeS3)
    monkeypatch.setenv("R2_ENABLED", "true")
    assert _run(r2Storage.readText("ocr/1.md", maxChars=5)) == "abcde"
    assert _run(r2Storage.readText("ocr/1.md", maxChars=100)) == "abcdefgh"


def test_delete_calls_delete_object(monkeypatch):
    from modules.storage.r2Storage import r2Storage
    fakeS3 = MagicMock()
    fakeS3.delete_object = MagicMock()
    monkeypatch.setattr(r2Storage, "_client", lambda: fakeS3)
    monkeypatch.setenv("R2_ENABLED", "true")
    _run(r2Storage.delete("ocr/1.md"))
    assert fakeS3.delete_object.call_args.kwargs["Key"] == "ocr/1.md"


def test_exists_true_and_false(monkeypatch):
    from modules.storage.r2Storage import r2Storage
    fakeS3 = MagicMock()
    fakeS3.head_object = MagicMock(return_value={"ContentLength": 10})
    monkeypatch.setattr(r2Storage, "_client", lambda: fakeS3)
    monkeypatch.setenv("R2_ENABLED", "true")
    assert _run(r2Storage.exists("documents/1/a.pdf")) is True
    fakeS3.head_object = MagicMock(side_effect=RuntimeError("404"))
    assert _run(r2Storage.exists("documents/1/a.pdf")) is False