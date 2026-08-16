# Cloudflare R2 Document Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store newly uploaded documents (and their OCR markdown output) in Cloudflare R2 instead of the local disk, while keeping existing local documents and the `R2_ENABLED=false` legacy path fully working.

**Architecture:** A new `r2Storage` singleton (single-file provider pattern, like `ocrProvider`) wraps boto3 (S3-compatible) calls behind async methods that run sync boto3 inside `asyncio.to_thread`. `knowledge/service.py` and `knowledge/router.py` branch on whether a stored `filePath` is an R2 key (`documents/<id>/...`) or a legacy local path. Processing downloads to a per-document temp file, then cleans up in `finally`. A semaphore (default 4) bounds concurrent processing.

**Tech Stack:** Python 3.12, FastAPI, boto3 (R2 S3-compatible API), aiofiles-free (uses stdlib + `asyncio.to_thread`), pytest.

## Global Constraints

- All Python function/method/variable names camelCase (`uploadBytes`, `downloadToTemp`). Component/file names camelCase (e.g. `r2Storage.py`).
- Single-file provider pattern for the storage module (Protocol pattern not needed — methods are concrete). Module singleton named `r2Storage`.
- Every try/except must call `logger.error(...)` or `logger.warning(...)` before returning/raising (CLAUDE.md). No bare `except:`.
- Background task `_processDocument` must never crash: all failures land in the outer try/except → `updateEmbedding("failed", errorMsg=...)`.
- Env gates read at call time via `os.getenv(...)` so tests can monkeypatch. `R2_ENABLED` default `"false"` (legacy local behavior).
- Run backend tests from project root: `.venv\Scripts\python.exe -m pytest server\tests -v`
- Install deps into the root `.venv` only: `.venv\Scripts\activate` then `pip install <pkg>`, then pin in `server/requirements.txt`.
- Reuse the existing `documents.filePath` column to store the R2 object key (no schema change).
- Do NOT modify `server/migrations/`, frontend, or the OCR provider classes themselves. The `ocrProvider.py` file only gains ONE new method (`saveOcrMarkdown`).
- Key layout: source `documents/<documentId>/<storedFilename>`; converted `.docx` `documents/<documentId>/<stem>.docx`; OCR `ocr/<documentId>.md`.

---

### Task 1: R2 storage module + env + dependency

**Files:**
- Create: `server/modules/storage/__init__.py`
- Create: `server/modules/storage/r2Storage.py`
- Create: `server/tests/storage/__init__.py`
- Create: `server/tests/storage/test_r2Storage.py`
- Modify: `server/requirements.txt`
- Modify: `server/tests/conftest.py:9` (add R2_ENABLED default)

**Interfaces:**
- Consumes: env vars only — `R2_ENABLED`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_REGION`, `R2_ENDPOINT_URL`.
- Produces:
  - Module functions `isR2Key(storageRef: str) -> bool` (True for `documents/...` or `ocr/...` prefixes).
  - `class R2StorageService` singleton `r2Storage`:
    - `enabled: bool` property (reads `R2_ENABLED` each call).
    - `async uploadBytes(content: bytes, key: str, contentType: str) -> str`
    - `async downloadToTemp(key: str) -> str`
    - `async readText(key: str, maxChars: int = 100000) -> str`
    - `async delete(key: str) -> None`
    - `async exists(key: str) -> bool`

- [ ] **Step 1: Install boto3 into the root venv**

```bash
.venv\Scripts\python.exe -m pip install boto3
```

Then confirm the installed version: `.venv\Scripts\python.exe -m pip show boto3` and pin `boto3==<version>` plus its `botocore` line (from `pip show botocore`) to the end of `server/requirements.txt`.

- [ ] **Step 2: Update `server/tests/conftest.py`**

After the `os.environ.setdefault("REDIS_PASSWORD", "mera_test_pass")` line (line 17), add:

```python
os.environ.setdefault("R2_ENABLED", "false")
```

- [ ] **Step 3: Write the failing tests**

Create `server/tests/storage/__init__.py` (empty), then create `server/tests/storage/test_r2Storage.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest server\tests\storage\test_r2Storage.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'modules.storage'`.

- [ ] **Step 5: Write the module**

Create `server/modules/storage/__init__.py` (empty) and `server/modules/storage/r2Storage.py`:

```python
# server/modules/storage/r2Storage.py
import asyncio
import os
import tempfile

from config.logger import logger


def isR2Key(storageRef) -> bool:
    """True when a stored filePath is an R2 object key rather than a local path."""
    if not storageRef:
        return False
    ref = str(storageRef)
    return ref.startswith("documents/") or ref.startswith("ocr/")


class R2StorageService:

    @property
    def enabled(self) -> bool:
        return os.getenv("R2_ENABLED", "false").lower() in ("1", "true", "yes", "on")

    def _bucket(self) -> str:
        return os.getenv("R2_BUCKET_NAME", "mera")

    def _endpoint(self) -> str:
        endpoint = os.getenv("R2_ENDPOINT_URL", "")
        if endpoint:
            return endpoint
        accountId = os.getenv("R2_ACCOUNT_ID", "")
        if accountId:
            return f"https://{accountId}.r2.cloudflarestorage.com"
        return ""

    def _client(self):
        import boto3
        return boto3.client(
            "s3",
            endpoint_url=self._endpoint(),
            aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID", ""),
            aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY", ""),
            region_name=os.getenv("R2_REGION", "auto"),
        )

    async def uploadBytes(self, content: bytes, key: str, contentType: str) -> str:
        try:
            await asyncio.to_thread(self._putObject, self._bucket(), key, content, contentType)
            logger.info(f"R2 uploadBytes uploads bucket={self._bucket()} key={key} bytes={len(content)}")
            return key
        except Exception as e:
            logger.error(f"R2StorageService.uploadBytes failed for key={key}: {e}")
            raise

    def _putObject(self, bucket: str, key: str, content: bytes, contentType: str) -> None:
        self._client().put_object(Bucket=bucket, Key=key, Body=content, ContentType=contentType)

    async def downloadToTemp(self, key: str) -> str:
        try:
            data = await asyncio.to_thread(self._getObjectBytes, self._bucket(), key)
            suffix = os.path.splitext(key)[1] or ".bin"
            fd, tmpPath = tempfile.mkstemp(prefix="r2_", suffix=suffix)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            logger.info(f"R2 downloadToTemp key={key} -> {tmpPath}")
            return tmpPath
        except Exception as e:
            logger.error(f"R2StorageService.downloadToTemp failed for key={key}: {e}")
            raise

    def _getObjectBytes(self, bucket: str, key: str) -> bytes:
        resp = self._client().get_object(Bucket=bucket, Key=key)
        try:
            return resp["Body"].read()
        finally:
            resp["Body"].close()

    async def readText(self, key: str, maxChars: int = 100000) -> str:
        try:
            data = await asyncio.to_thread(self._getObjectBytes, self._bucket(), key)
            return data.decode("utf-8", errors="ignore")[:maxChars]
        except Exception as e:
            logger.error(f"R2StorageService.readText failed for key={key}: {e}")
            return ""

    async def delete(self, key: str) -> None:
        try:
            await asyncio.to_thread(self._deleteObject, self._bucket(), key)
            logger.info(f"R2 delete bucket={self._bucket()} key={key}")
        except Exception as e:
            logger.error(f"R2StorageService.delete failed for key={key}: {e}")
            raise

    def _deleteObject(self, bucket: str, key: str) -> None:
        self._client().delete_object(Bucket=bucket, Key=key)

    async def exists(self, key: str) -> bool:
        try:
            await asyncio.to_thread(self._headObject, self._bucket(), key)
            return True
        except Exception as e:
            logger.warning(f"R2StorageService.exists false for key={key}: {e}")
            return False

    def _headObject(self, bucket: str, key: str) -> None:
        self._client().head_object(Bucket=bucket, Key=key)


r2Storage = R2StorageService()
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest server\tests\storage\test_r2Storage.py -v`
Expected: all pass.

- [ ] **Step 7: Run the full backend suite**

Run: `.venv\Scripts\python.exe -m pytest server\tests -v`
Expected: all pass (existing tests unaffected).

- [ ] **Step 8: Commit**

```bash
git add server/modules/storage server/tests/storage server/requirements.txt server/tests/conftest.py
git commit -m "feat: add R2 storage service with boto3 and env config"
```

---

### Task 2: OCR markdown output method

**Files:**
- Modify: `server/modules/ocr/ocrProvider.py:393-402` (add `saveOcrMarkdown` next to `saveOcrText`)
- Test: `server/tests/ocr/test_ocrProvider.py`

**Interfaces:**
- Consumes: existing `OcrPage` dataclass (`text`, `pageNumber`, `confidence`).
- Produces: `OCRService.saveOcrMarkdown(pages: List[OcrPage], outputPath: str) -> str` — writes each page under a `## Page <N>` heading, returns `outputPath`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/ocr/test_ocrProvider.py`:

```python
def test_saveOcrMarkdown_writes_page_headers(tmp_path):
    from modules.ocr.ocrProvider import OCRService, OcrPage
    pages = [
        OcrPage(text="first page text", pageNumber=1),
        OcrPage(text="", pageNumber=2),
        OcrPage(text="third", pageNumber=3),
    ]
    outPath = str(tmp_path / "out.md")
    OCRService().saveOcrMarkdown(pages, outPath)
    with open(outPath, "r", encoding="utf-8") as f:
        content = f.read()
    assert "## Page 1" in content
    assert "first page text" in content
    assert "## Page 2" in content
    assert "## Page 3" in content
    assert "third" in content
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest server\tests\ocr\test_ocrProvider.py::test_saveOcrMarkdown_writes_page_headers -v`
Expected: FAIL — `AttributeError: 'OCRService' object has no attribute 'saveOcrMarkdown'`.

- [ ] **Step 3: Write the implementation**

In `server/modules/ocr/ocrProvider.py`, immediately after `saveOcrText` (line 402), add:

```python
    def saveOcrMarkdown(self, pages: List[OcrPage], outputPath: str) -> str:
        """Save OCR results to a markdown file. Returns the output path."""
        os.makedirs(os.path.dirname(outputPath), exist_ok=True)
        with open(outputPath, "w", encoding="utf-8") as f:
            for page in pages:
                f.write(f"## Page {page.pageNumber}\n\n")
                if page.text:
                    f.write(page.text + "\n")
                f.write("\n")
        return outputPath
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest server\tests\ocr\test_ocrProvider.py::test_saveOcrMarkdown_writes_page_headers -v`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `.venv\Scripts\python.exe -m pytest server\tests -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/modules/ocr/ocrProvider.py server/tests/ocr/test_ocrProvider.py
git commit -m "feat: add saveOcrMarkdown for R2 OCR output"
```

---

### Task 3: Upload flow writes to R2

**Files:**
- Modify: `server/modules/knowledge/service.py` (import line + `_uploadOne`)
- Test: `server/tests/knowledge/test_service.py`

**Interfaces:**
- Consumes: `r2Storage` singleton (`enabled`, `async uploadBytes`), `isR2Key`.
- Produces: `_uploadOne` behavior change — when `R2_ENABLED=true`, content is uploaded to R2 (key `documents/<documentId>/<storedFilename>`) and `create(... filePath=key ...)`; local disk write is skipped.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/knowledge/test_service.py`:

```python
def test__uploadOne_uploads_to_r2_when_r2_enabled():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService, UPLOAD_DIR

    class FakeFile:
        filename = "report.pdf"

        async def read(self):
            return b"%PDF-1.7 fake pdf content"

    record = {
        "id": "doc-r2-1",
        "userId": "user1",
        "filename": "report.pdf",
        "filePath": "documents/doc-r2-1/report.pdf",
    }
    uploadCalls = []

    async def fakeUpload(content, key, contentType):
        uploadCalls.append((key, contentType))
        return key

    with patch("modules.knowledge.service.r2Storage") as mockR2, \
         patch("modules.knowledge.service.documentRepository.create", new=AsyncMock(return_value=record)), \
         patch("modules.knowledge.service.documentRepository.getByHashAndOwner", new=AsyncMock(return_value=None)), \
         patch("modules.knowledge.service.documentRepository.countByFilenamePattern", new=AsyncMock(return_value=0)), \
         patch("modules.knowledge.service.documentService._processDocument", new=AsyncMock()):
        mockR2.enabled = True
        mockR2.uploadBytes = fakeUpload
        result = asyncio.get_event_loop().run_until_complete(
            documentService._uploadOne("user1", FakeFile(), "personal", "user1", "user", None)
        )

    assert result["filePath"].startswith("documents/doc-r2-1/")
    assert uploadCalls[0][1] == "application/pdf"
    localCandidate = UPLOAD_DIR / result["filePath"].split("/")[-1]
    assert not localCandidate.exists(), "must not write to local disk when R2 enabled"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_service.py::test__uploadOne_uploads_to_r2_when_r2_enabled -v`
Expected: FAIL — current `_uploadOne` writes to disk and `import modules.knowledge.service` with `r2Storage` attribute will fail first (`AttributeError: module 'modules.knowledge.service' has no attribute 'r2Storage'`).

- [ ] **Step 3: Update the import in `server/modules/knowledge/service.py`**

Change line 15:

```python
from modules.ocr.ocrProvider import ocrService, needsOcr
```

to:

```python
from modules.ocr.ocrProvider import ocrService, needsOcr
from modules.storage.r2Storage import r2Storage, isR2Key
```

- [ ] **Step 4: Replace the local-disk write in `_uploadOne`**

Replace lines 160-164 (currently):

```python
        storedFilename = f"{uuid.uuid4().hex}_{filename}"
        filePath = UPLOAD_DIR / storedFilename

        with open(filePath, "wb") as f:
            f.write(content)
```

with:

```python
        storedFilename = f"{uuid.uuid4().hex}_{filename}"
        if r2Storage.enabled:
            filePath = content
        else:
            filePath = UPLOAD_DIR / storedFilename
            with open(filePath, "wb") as f:
                f.write(content)
```

- [ ] **Step 5: Replace the `create` + `_processDocument` call in `_uploadOne`**

Replace lines 166-183 (currently):

```python
        record = await documentRepository.create(
            userId=userId,
            filename=filename,
            storedFilename=storedFilename,
            filePath=str(filePath),
            fileType=fileExt.lstrip("."),
            fileSize=len(content),
            contentHash=contentHash,
            scope=scope,
            ownerId=ownerId,
            ownerType=ownerType,
            parentId=parentId,
        )

        asyncio.create_task(
            self._processDocument(record["id"], str(filePath), ownerId, userId, filename)
        )
        return record
```

with:

```python
        storedRef = str(filePath)
        if r2Storage.enabled:
            r2Key = f"documents/{uuid.uuid4().hex}/{storedFilename}"
            try:
                await r2Storage.uploadBytes(content, r2Key, _mimeForExt(fileExt))
                storedRef = r2Key
            except Exception as e:
                logger.error(f"_uploadOne R2 upload failed for '{filename}': {e}")
                raise

        record = await documentRepository.create(
            userId=userId,
            filename=filename,
            storedFilename=storedFilename,
            filePath=storedRef,
            fileType=fileExt.lstrip("."),
            fileSize=len(content),
            contentHash=contentHash,
            scope=scope,
            ownerId=ownerId,
            ownerType=ownerType,
            parentId=parentId,
        )

        asyncio.create_task(
            self._processDocument(record["id"], storedRef, ownerId, userId, filename)
        )
        return record
```

Note: earlier `with open(filePath, "wb")` kept `content` as the source for upload; `_mimeForExt` is defined in Step 7. The R2 key uses a separate uuid (distinct from `storedFilename`) so a batch of same-named files never collide; `storedFilename` (uuid + original name) still lives in its own column.

- [ ] **Step 6: Verify the duplicate-return path in `_uploadOne` still works**
The early return at lines 149-152 (`if existing: return existing`) is unchanged — dedupe still hits the DB before any storage write.

- [ ] **Step 7: Add the MIME helper function**

In `server/modules/knowledge/service.py`, after `_computeHash` (line 28), add:

```python
_MIME_TYPES = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
}


def _mimeForExt(ext: str) -> str:
    return _MIME_TYPES.get(ext.lower(), "application/octet-stream")
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_service.py -v`
Expected: all pass (new + existing).

- [ ] **Step 9: Run the full backend suite**

Run: `.venv\Scripts\python.exe -m pytest server\tests -v`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add server/modules/knowledge/service.py server/tests/knowledge/test_service.py
git commit -m "feat: upload documents to R2 when R2 enabled"
```

---

### Task 4: Processing flow downloads temp, uploads OCR markdown, semaphore

**Files:**
- Modify: `server/modules/knowledge/service.py` (add `__init__` w/ semaphore; replace `_processDocument`)
- Test: `server/tests/knowledge/test_service.py`

**Interfaces:**
- Consumes: `r2Storage` (`async downloadToTemp`, `async uploadBytes`), `isR2Key`, `ocrService.saveOcrMarkdown`, `needsOcr`, `_convertDocToDocx`, `_extractPageCount`, `_readTextContent`.
- Produces: `_processDocument(documentId, filePath, ownerId, userId, filename)` behavior:
  - Downloads R2 objects to per-document temp files; cleans up in `finally`.
  - Converts `.doc`→`.docx`, re-uploads converted docx to R2 when source is an R2 key, updates `filePath`.
  - Writes OCR output as markdown (R2 key `ocr/<documentId>.md`) when source is an R2 key.
  - Bounded by `self._processSem = asyncio.Semaphore(4)`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/knowledge/test_service.py`:

```python
def test__processDocument_r2_downloads_uploads_ocr_markdown(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService
    from modules.ocr.ocrProvider import OcrPage

    ocrUploads = {}

    async def fakeUploadBytes(content, key, contentType):
        ocrUploads[key] = content
        return key

    async def fakeDownloadToTemp(key):
        return _writeTempPdf()

    class FakeTask:
        def __init__(self, coro):
            self._coro = coro

    monkeypatch.setattr("modules.knowledge.service.r2Storage.downloadToTemp", fakeDownloadToTemp)
    monkeypatch.setattr("modules.knowledge.service.r2Storage.uploadBytes", fakeUploadBytes)
    monkeypatch.setattr("modules.knowledge.service.asyncio.create_task", lambda coro, **kw: FakeTask(coro))

    with patch("modules.knowledge.service.documentRepository.updateEmbedding", new=AsyncMock()), \
         patch("modules.knowledge.service.documentRepository.updateOcr", new=AsyncMock()) as mockUpdateOcr, \
         patch("modules.knowledge.service.documentRepository.updateFilePath", new=AsyncMock()), \
         patch("modules.knowledge.service.ragService.index", new=AsyncMock(return_value=7)), \
         patch("modules.knowledge.service.needsOcr", return_value=True), \
         patch("modules.knowledge.service.ocrService.ocrFile", return_value=[OcrPage(text="scanned text", pageNumber=1)]), \
         patch("modules.knowledge.service._extractPageCount", return_value=1):
        asyncio.get_event_loop().run_until_complete(
            documentService._processDocument("doc1", "documents/doc1/a.pdf", "user1", "user1", "a.pdf")
        )

    ocrKey = "ocr/doc1.md"
    assert any(c.kwargs.get("ocrFilePath") == ocrKey for c in mockUpdateOcr.call_args_list)
    assert ocrKey in ocrUploads
    assert b"## Page 1" in ocrUploads[ocrKey]


def _writeTempPdf():
    import os
    import tempfile
    fd, path = tempfile.mkstemp(suffix=".pdf")
    with os.fdopen(fd, "wb") as f:
        f.write(b"%PDF-1.7 fake")
    return path
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_service.py::test__processDocument_r2_downloads_uploads_ocr_markdown -v`
Expected: FAIL — current `_processDocument` never downloads from R2 and never uploads OCR markdown.

- [ ] **Step 3: Add a semaphore to `DocumentService`**

Add `__init__` to `DocumentService` (before `uploadDocuments`, line 109):

```python
    def __init__(self):
        self._processSem = asyncio.Semaphore(int(os.getenv("DOC_PROCESSING_CONCURRENCY", "4")))
```

- [ ] **Step 4: Replace `_processDocument` entirely**

Replace lines 185-239 (the whole `_processDocument` method) with:

```python
    async def _processDocument(
        self, documentId: str, filePath: str, ownerId: str, userId: str, filename: Optional[str] = None
    ) -> None:
        async with self._processSem:
            import tempfile
            tempToClean: List[str] = []
            try:
                workingPath = filePath
                if isR2Key(filePath):
                    workingPath = await r2Storage.downloadToTemp(filePath)
                    tempToClean.append(workingPath)

                t0 = time.perf_counter()
                logger.info(f"_processDocument start documentId={documentId} file={workingPath}")
                await documentRepository.updateEmbedding(documentId, "processing")

                ext = os.path.splitext(workingPath)[1].lower()
                if ext == ".doc":
                    tConvert = time.perf_counter()
                    logger.info(f"_processDocument converting .doc to .docx documentId={documentId}")
                    docxPath = _convertDocToDocx(workingPath)
                    if docxPath:
                        tempToClean.append(docxPath)
                        if isR2Key(filePath):
                            docxKey = f"documents/{documentId}/{os.path.basename(docxPath)}"
                            with open(docxPath, "rb") as f:
                                docxContent = f.read()
                            await r2Storage.uploadBytes(
                                docxContent,
                                docxKey,
                                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            )
                            await documentRepository.updateFilePath(documentId, docxKey, "docx")
                        else:
                            await documentRepository.updateFilePath(documentId, docxPath, "docx")
                        workingPath = docxPath
                        logger.info(f"_processDocument .doc conversion done elapsed={time.perf_counter()-tConvert:.2f}s documentId={documentId}")

                indexPath = workingPath
                tOcrCheck = time.perf_counter()
                isScanned = needsOcr(workingPath)
                logger.info(f"_processDocument needsOcr={isScanned} elapsed={time.perf_counter()-tOcrCheck:.2f}s documentId={documentId}")

                if isScanned:
                    try:
                        await documentRepository.updateOcr(documentId, "processing", isScanned=True)
                        tOcr = time.perf_counter()
                        logger.info(f"_processDocument OCR start documentId={documentId} provider={ocrService.providerName}")
                        ocrPages = ocrService.ocrFile(workingPath)
                        logger.info(f"_processDocument OCR done pages={len(ocrPages)} elapsed={time.perf_counter()-tOcr:.2f}s documentId={documentId}")
                        if isR2Key(filePath):
                            fdRaw, mdPath = tempfile.mkstemp(prefix=f"{documentId}_ocr_", suffix=".md")
                            os.close(fdRaw)
                            tempToClean.append(mdPath)
                            ocrService.saveOcrMarkdown(ocrPages, mdPath)
                            with open(mdPath, "rb") as f:
                                mdBytes = f.read()
                            ocrKey = f"ocr/{documentId}.md"
                            await r2Storage.uploadBytes(mdBytes, ocrKey, "text/markdown")
                            await documentRepository.updateOcr(documentId, "completed", ocrFilePath=ocrKey)
                            indexPath = mdPath
                        else:
                            ocrFilePath = str(OCR_DIR / f"{documentId}_ocr.txt")
                            ocrService.saveOcrText(ocrPages, ocrFilePath)
                            await documentRepository.updateOcr(documentId, "completed", ocrFilePath=ocrFilePath)
                            indexPath = ocrFilePath
                    except Exception as e:
                        logger.error(f"OCR failed for {documentId}: {e}")
                        await documentRepository.updateOcr(documentId, "failed")

                tIndex = time.perf_counter()
                logger.info(f"_processDocument indexing start documentId={documentId} indexPath={indexPath}")
                chunkCount = await ragService.index(indexPath, ownerId, documentId, userId, filename=filename)
                logger.info(f"_processDocument indexing done chunkCount={chunkCount} elapsed={time.perf_counter()-tIndex:.2f}s documentId={documentId}")

                pageCount = _extractPageCount(workingPath)
                await documentRepository.updateEmbedding(
                    documentId, "completed", chunkCount=chunkCount, pageCount=pageCount
                )
                total = time.perf_counter() - t0
                logger.info(f"_processDocument completed documentId={documentId} total={total:.2f}s")
                asyncio.create_task(self._generateSummary(documentId, workingPath, indexPath))
            except Exception as e:
                logger.error(f"_processDocument failed for {documentId}: {e}")
                await documentRepository.updateEmbedding(
                    documentId, "failed", errorMsg="Embedding failed. Please retry."
                )
            finally:
                for tmpPath in tempToClean:
                    try:
                        if tmpPath and os.path.exists(tmpPath):
                            os.remove(tmpPath)
                    except Exception as e:
                        logger.warning(f"_processDocument temp cleanup failed for {tmpPath}: {e}")
```

Note: this keeps the `tempfile` import local (file already imports `time`, `os`, `asyncio`; `tempfile` is imported inside the OCR branch and the `finally` uses only `os`). If `tempfile` is not available at module top, use `import tempfile` inside the method as shown.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_service.py -v`
Expected: all pass.

- [ ] **Step 6: Run the full backend suite**

Run: `.venv\Scripts\python.exe -m pytest server\tests -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/modules/knowledge/service.py server/tests/knowledge/test_service.py
git commit -m "feat: process R2 documents via temp download with concurrency semaphore"
```

---

### Task 5: Serve files and OCR text from R2

**Files:**
- Modify: `server/modules/knowledge/router.py` (imports + `serveDocumentFile` + `getDocumentOcrText`)
- Test: `server/tests/knowledge/test_router_helpers.py`

**Interfaces:**
- Consumes: `r2Storage` (`async downloadToTemp`, `async readText`), `isR2Key`, `documentService.getDocument`.
- Produces:
  - `serveDocumentFile`: R2 keys → temp download + `FileResponse` with `BackgroundTask` cleanup; local paths → existing behavior.
  - `getDocumentOcrText`: R2 keys → `r2Storage.readText(ocrKey)`; local → existing read.
  - Module helper `_removeTempFile(path)`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/knowledge/test_router_helpers.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_router_helpers.py -v`
Expected: FAIL — `ImportError: cannot import name '_removeTempFile' from 'modules.knowledge.router'`.

- [ ] **Step 3: Update router imports**

In `server/modules/knowledge/router.py`, change the `from fastapi.responses import FileResponse` line (line 6) to:

```python
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
```

Then after the imports (line 14), add:

```python
from modules.storage.r2Storage import r2Storage, isR2Key


def _removeTempFile(path: str) -> None:
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass
```

- [ ] **Step 4: Replace the file descriptor check in `serveDocumentFile`**

In `serveDocumentFile`, replace lines 89-97 (currently):

```python
        filePath = doc["filePath"]
        if not os.path.exists(filePath):
            raise HTTPException(status_code=404, detail="File not found on disk")
        mediaType = MIME_TYPES.get(doc.get("fileType", ""), "application/octet-stream")
        return FileResponse(
            path=filePath,
            filename=doc["filename"],
            media_type=mediaType,
        )
```

with:

```python
        filePath = doc["filePath"]
        mediaType = MIME_TYPES.get(doc.get("fileType", ""), "application/octet-stream")
        if r2Storage.enabled and isR2Key(filePath):
            try:
                tempPath = await r2Storage.downloadToTemp(filePath)
                return FileResponse(
                    path=tempPath,
                    filename=doc["filename"],
                    media_type=mediaType,
                    background=BackgroundTask(_removeTempFile, tempPath),
                )
            except Exception as e:
                logger.error(f"serveDocumentFile R2 download failed for {filePath}: {e}")
                raise HTTPException(status_code=404, detail="File not found in storage")
        if not os.path.exists(filePath):
            raise HTTPException(status_code=404, detail="File not found on disk")
        return FileResponse(
            path=filePath,
            filename=doc["filename"],
            media_type=mediaType,
        )
```

- [ ] **Step 5: Replace the OCR text read in `getDocumentOcrText`**

Replace lines 114-120 (currently):

```python
        ocrFilePath = doc.get("ocrFilePath")
        if not ocrFilePath or doc.get("ocrStatus") != "completed":
            raise HTTPException(status_code=404, detail="OCR not available for this document")
        if not os.path.exists(ocrFilePath):
            raise HTTPException(status_code=404, detail="OCR file not found on disk")
        with open(ocrFilePath, "r", encoding="utf-8") as f:
            text = f.read()
```

with:

```python
        ocrFilePath = doc.get("ocrFilePath")
        if not ocrFilePath or doc.get("ocrStatus") != "completed":
            raise HTTPException(status_code=404, detail="OCR not available for this document")
        if r2Storage.enabled and isR2Key(ocrFilePath):
            text = await r2Storage.readText(ocrFilePath, maxChars=1000000)
        else:
            if not os.path.exists(ocrFilePath):
                raise HTTPException(status_code=404, detail="OCR file not found on disk")
            with open(ocrFilePath, "r", encoding="utf-8") as f:
                text = f.read()
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_router_helpers.py -v`
Expected: all pass.

- [ ] **Step 7: Run the full backend suite**

Run: `.venv\Scripts\python.exe -m pytest server\tests -v`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add server/modules/knowledge/router.py server/tests/knowledge/test_router_helpers.py
git commit -m "feat: serve document files and OCR text from R2"
```

---

### Task 6: Delete, retry, and context reads over storage

**Files:**
- Modify: `server/modules/knowledge/service.py` (`_readTextFromStorage`, `getDocumentContext`, `searchDocumentContext`, `retryDocument`, `deleteDocument`)
- Test: `server/tests/knowledge/test_service.py`

**Interfaces:**
- Consumes: `r2Storage` (`async delete`, `async exists`, `async readText`), `isR2Key`.
- Produces:
  - `async _readTextFromStorage(storageRef, maxChars) -> str` — R2 key → `r2Storage.readText`; local → `_readTextContent`.
  - `deleteDocument`: R2 keys → `r2Storage.delete` for source + OCR keys; legacy → `os.remove`.
  - `retryDocument`: existence check uses `r2Storage.exists` for R2 keys.
  - `getDocumentContext` / `searchDocumentContext`: read via `_readTextFromStorage`.
  - `_generateSummary`: read via `_readTextFromStorage`; `_processDocument` passes stable R2 refs (not temp paths) to it when R2 is used.
- Amendment (controller + user approved, 08-17): fix `_generateSummary` R2 temp-path race — Task 4 passed `workingPath`/`indexPath` (temp files deleted in `finally` before the summary task runs). Task 6 additionally updates `_generateSummary` to read via `_readTextFromStorage` and updates the `_processDocument` call-site to pass `ocrKey` (scanned R2) / `filePath` (non-scanned R2) instead of temp paths.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/knowledge/test_service.py`:

```python
def test__readTextFromStorage_r2_uses_readText(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService
    monkeypatch.setattr(
        "modules.knowledge.service.r2Storage.readText",
        AsyncMock(return_value="r2 md content"),
    )
    text = asyncio.get_event_loop().run_until_complete(
        documentService._readTextFromStorage("ocr/doc1.md", 100)
    )
    assert text == "r2 md content"


def test__readTextFromStorage_local_uses_file(monkeypatch, tmp_path):
    import asyncio
    from unittest.mock import patch
    from modules.knowledge.service import documentService
    p = tmp_path / "local.txt"
    p.write_text("local content", encoding="utf-8")
    with patch("modules.knowledge.service._readTextContent", return_value="local content") as mockRead:
        text = asyncio.get_event_loop().run_until_complete(
            documentService._readTextFromStorage(str(p), 100)
        )
    assert text == "local content"
    mockRead.assert_called_once_with(str(p), 100)


def test_retryDocument_r2_uses_exists():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService

    doc = {
        "id": "doc1",
        "userId": "user1",
        "ownerId": "user1",
        "filePath": "documents/doc1/a.pdf",
        "filename": "a.pdf",
        "embeddingStatus": "failed",
        "ocrStatus": None,
    }

    class FakeTask:
        def __init__(self, coro):
            self._coro = coro

    with patch("modules.knowledge.service.documentRepository.getById", new=AsyncMock(return_value=doc)), \
         patch("modules.knowledge.service.r2Storage.exists", new=AsyncMock(return_value=True)) as mockExists, \
         patch("modules.knowledge.service.documentRepository.updateEmbedding", new=AsyncMock()), \
         patch("modules.knowledge.service.documentService._processDocument", new=AsyncMock()), \
         patch("modules.knowledge.service.asyncio.create_task", lambda coro, **kw: FakeTask(coro)):
        asyncio.get_event_loop().run_until_complete(
            documentService.retryDocument("doc1", "user1")
        )
    mockExists.assert_awaited_once_with("documents/doc1/a.pdf")


def test_deleteDocument_r2_deletes_both_keys():
    import asyncio
    from unittest.mock import AsyncMock, MagicMock, patch
    from modules.knowledge.service import documentService

    deleted = []
    async def fakeDelete(key):
        deleted.append(key)

    mockR2 = MagicMock()
    mockR2.enabled = True
    mockR2.delete.side_effect = fakeDelete

    with patch("modules.knowledge.service.r2Storage", mockR2), \
         patch("modules.knowledge.service.documentRepository.delete", new=AsyncMock(return_value=("documents/doc1/a.pdf", "user1"))), \
         patch("modules.knowledge.service.documentRepository.getById", new=AsyncMock(return_value={
             "id": "doc1",
             "userId": "user1",
             "ocrFilePath": "ocr/doc1.md",
         })), \
         patch("modules.knowledge.service.ragService.deleteDocumentChunks", new=AsyncMock()), \
         patch("modules.knowledge.service.ragService.deleteDocumentIndex", new=AsyncMock()):
        result = asyncio.get_event_loop().run_until_complete(
            documentService.deleteDocument("user1", "doc1")
        )
    assert result is True
    assert set(deleted) == {"documents/doc1/a.pdf", "ocr/doc1.md"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_service.py -v`
Expected: FAIL — `AttributeError: 'DocumentService' object has no attribute '_readTextFromStorage'`, and `deleteDocument`/`retryDocument` still use `os` only.

- [ ] **Step 3: Add `_readTextFromStorage` helper**

In `server/modules/knowledge/service.py`, after `_readTextContent` (line 104), add:

```python
async def _readTextFromStorage(storageRef: str, maxChars: int = SUMMARY_MAX_CHARS) -> str:
    if isR2Key(storageRef):
        return await r2Storage.readText(storageRef, maxChars=maxChars)
    return _readTextContent(storageRef, maxChars=maxChars)
```

- [ ] **Step 4: Update `getDocumentContext` and `searchDocumentContext`**

In `getDocumentContext`, replace line 304:

```python
                text = _readTextContent(readPath, maxChars=8000)
```

with:

```python
                text = await _readTextFromStorage(readPath, maxChars=8000)
```

In `searchDocumentContext`, replace line 353 (the fallback branch):

```python
                    text = _readTextContent(readPath, maxChars=8000)
```

with:

```python
                    text = await _readTextFromStorage(readPath, maxChars=8000)
```

Note: both methods already `await` their repository calls and are `async`, so no signature change is needed.

- [ ] **Step 5: Update `retryDocument` existence check**

Replace lines 374-375 (currently):

```python
        if not doc.get("filePath") or not os.path.exists(doc["filePath"]):
            raise ValueError("Source file no longer exists on disk")
```

with:

```python
        if not doc.get("filePath"):
            raise ValueError("Source file no longer exists")
        if isR2Key(doc["filePath"]):
            if not await r2Storage.exists(doc["filePath"]):
                raise ValueError("Source file no longer exists in storage")
        elif not os.path.exists(doc["filePath"]):
            raise ValueError("Source file no longer exists on disk")
```

- [ ] **Step 6: Update `deleteDocument`**

Replace lines 394-419 (from `async def deleteDocument` through the `return True`) with:

```python
    async def deleteDocument(self, userId: str, documentId: str) -> bool:
        doc = await documentRepository.getById(documentId)
        result = await documentRepository.delete(documentId, userId)
        if result is None:
            return False
        filePath, ownerId = result
        ocrKey = (doc or {}).get("ocrFilePath")
        if r2Storage.enabled and isR2Key(filePath):
            try:
                await r2Storage.delete(filePath)
            except Exception as e:
                logger.error(f"deleteDocument R2 file removal failed for {documentId}: {e}")
            if ocrKey and isR2Key(ocrKey):
                try:
                    await r2Storage.delete(ocrKey)
                except Exception as e:
                    logger.error(f"deleteDocument R2 OCR removal failed for {documentId}: {e}")
        else:
            try:
                if filePath and os.path.exists(filePath):
                    os.remove(filePath)
            except Exception as e:
                logger.error(f"deleteDocument file removal failed for {documentId}: {e}")
            ocrPath = str(OCR_DIR / f"{documentId}_ocr.txt")
            try:
                if os.path.exists(ocrPath):
                    os.remove(ocrPath)
            except Exception as e:
                logger.error(f"deleteDocument OCR file removal failed for {documentId}: {e}")
        try:
            await ragService.deleteDocumentChunks(ownerId, documentId)
        except Exception as e:
            logger.error(f"deleteDocument RAG cleanup failed for {documentId}: {e}")
        try:
            await ragService.deleteDocumentIndex(userId, documentId)
        except Exception as e:
            logger.error(f"deleteDocument doc-index cleanup failed for {documentId}: {e}")
        return True
```

- [ ] **Step 7: Make `_generateSummary` storage-aware**

Replace line 314 (currently):

```python
            text = _readTextContent(indexPath or filePath)
```

with:

```python
            text = await _readTextFromStorage(indexPath or filePath)
```

- [ ] **Step 8: Pass stable refs to `_generateSummary` in `_processDocument`**

Replace the call-site line 297 (currently):

```python
                asyncio.create_task(self._generateSummary(documentId, workingPath, indexPath))
```

with:

```python
                if isR2Key(filePath):
                    asyncio.create_task(
                        self._generateSummary(documentId, filePath, ocrKey if isScanned else filePath)
                    )
                else:
                    asyncio.create_task(self._generateSummary(documentId, workingPath, indexPath))
```

Note: `ocrKey` exists only inside the scanned ± R2 branch (line 273), so this reference is safe. For scanned R2 documents the summary reads the uploaded `ocr/<documentId>.md`; for non-scanned R2 documents it reads the source R2 object; local documents keep the temp/local paths (they persist on disk).

- [ ] **Step 9: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_service.py -v`
Expected: all pass.

- [ ] **Step 10: Run the full backend suite**

Run: `.venv\Scripts\python.exe -m pytest server\tests -v`
Expected: all pass.

- [ ] **Step 11: Run a backend smoke import**

Run: `.venv\Scripts\python.exe -c "import server.apiRouter"` from project root.
Expected: no traceback.

- [ ] **Step 12: Commit**

```bash
git add server/modules/knowledge/service.py server/tests/knowledge/test_service.py
git commit -m "feat: storage-aware delete, retry, context, and summary reads"
```

---

### Task 7: Document the R2 environment configuration

**Files:**
- Modify: `.env.example` (add R2 section after `# --- OCR ---`, line ~100, before `# --- Token Quota ---` line 102)
- Modify: `.env.production.example` (same section)

**Interfaces:**
- Produces: documented env vars matching `r2Storage.py` reads: `R2_ENABLED`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_REGION`, `R2_ENDPOINT_URL`, plus a `DOC_PROCESSING_CONCURRENCY` note.

- [ ] **Step 1: Add the R2 section to `.env.example`**

Between the OCR block (ends at `# PADDLEOCR_VL_PRETTIFY=true`) and `# --- Token Quota ---`, insert:

```env
# --- Object Storage (Cloudflare R2) ---
# When R2_ENABLED=true, new uploads are stored in Cloudflare R2 instead of the
# local data/uploads dir. Existing local documents keep working unchanged.
# Create credentials at https://dash.cloudflare.com -> R2 -> Manage R2 API Tokens.
R2_ENABLED=false
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=mera
R2_REGION=auto
# Optional - derived from R2_ACCOUNT_ID when empty:
# R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
# Optional - max concurrent OCR/index background tasks per process (default 4):
# DOC_PROCESSING_CONCURRENCY=4
```

- [ ] **Step 2: Mirror the section into `.env.production.example`**

Open `.env.production.example`, locate its OCR section, and append the identical R2 block after it.

- [ ] **Step 3: Commit**

```bash
git add .env.example .env.production.example
git commit -m "docs: document Cloudflare R2 storage config"
```

---

## Self-Review Map (spec → tasks)

- Env config + boto3 dep + `r2Storage` module → Task 1.
- Reuse `filePath` for R2 key (no schema change) → Tasks 1 (`isR2Key`), 3 (create with key), 4 (docx key).
- Upload to R2 instead of disk → Task 3.
- OCR output as markdown stored on R2 → Tasks 2 (`saveOcrMarkdown`), 4.
- Serve via backend proxy (frontend unchanged) → Task 5.
- Delete / retry / context reads over storage → Task 6.
- Legacy local documents keep working (R2_ENABLED=false) → Tasks 3,4,5,6 branch on `isR2Key`/`enabled`.
- Concurrency: semaphore + `asyncio.to_thread` + unique temp + `finally` cleanup → Task 4 (+ Task 1 `to_thread`).
- Error handling: every try/except logs; `_processDocument` never crashes → Tasks 1,4,6.
- `R2_ENABLED`/`DOC_PROCESSING_CONCURRENCY` doc'd in env files → Task 7.
- Empty `storage` module `__init__.py` and `tests/storage/__init__.py` → Task 1.

## Composite End-to-End Verification (run after all tasks)

- [ ] `.venv\Scripts\python.exe -m pytest server\tests -v` → all green.
- [ ] `.venv\Scripts\python.exe -c "import server.apiRouter"` → no traceback.
- [ ] With real creds: set `R2_ENABLED=true`, fill `R2_*`, restart backend.
  - Upload several documents from two users concurrently → objects appear under `documents/<id>/...` in the R2 bucket; none written to `server/data/uploads`.
  - Scanned/mixed PDF → OCR completes; `ocr/<documentId>.md` present in bucket with `## Page N` headings.
  - Open a document in the web UI → file streams from R2.
  - OCR viewer → markdown text shown.
  - Delete a document → both `documents/<id>/...` and `ocr/<id>.md` objects removed.
  - Retry a failed document → retries without "does not exist" errors.
- [ ] With `R2_ENABLED=false` and a legacy document still on disk: upload/OCR/serve/delete behave exactly as before.