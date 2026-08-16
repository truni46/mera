# Cloudflare R2 Document Storage Design Spec

## Goal

Store uploaded documents (and their OCR markdown output) on Cloudflare R2 instead of the local disk, for all newly uploaded documents. Existing documents already on disk keep working unchanged (no migration).

## Context

Today, document storage is fully local:

- `server/modules/knowledge/service.py` writes uploads to `server/data/uploads/<storedFilename>` and stores the absolute `filePath` in the `documents` table.
- `server/modules/knowledge/router.py` serves files via `FileResponse(path=filePath)` and reads OCR text files directly off disk.
- OCR output is a `.txt` file under `server/data/uploads/ocr/` referenced by the `ocrFilePath` column.
- Delete does `os.remove(filePath)` + `os.remove(ocrFilePath)`.
- Retry checks `os.path.exists(filePath)`.

R2 is S3-compatible, so the backend uses `boto3` with the R2 endpoint.

## Decisions (confirmed with user)

- Switch fully to R2 for new uploads; existing local documents are untouched and still served as today.
- Serve files through the existing backend proxy endpoint (`GET /knowledge/documents/{id}/file`) — frontend unchanged.
- OCR output format becomes **markdown (`.md`)** and is uploaded to R2 (consistent with the pdf-inspector direction).
- Reuse the existing `filePath` column to store the R2 object key (no new column).
- Process R2 files by downloading to a local temp, running the existing OCR/index/summary pipeline on the temp path, then cleaning up.
- Concurrency is a first-class concern: simultaneous uploads from one or many users must be stable.

## Proposed approach

### Storage module

New module following the single-file provider pattern (like `ocrProvider`):

`server/modules/storage/r2Storage.py`

- `class R2StorageService`:
  - `uploadBytes(content: bytes, key: str, contentType: str) -> str` — returns key.
  - `downloadToTemp(key: str) -> str` — downloads object to a temp file, returns the path. Caller owns cleanup.
  - `readText(key: str, maxChars: int) -> str` — downloads object text (for `.md`/`.txt`/small content).
  - `delete(key: str) -> None`.
  - `exists(key: str) -> bool`.
- Env gate `R2_ENABLED` (same convention as `USE_DATABASE`): when false, the service is inert and callers fall back to the existing local-disk path.
- Every public method is `async` and runs the sync boto3 call inside `asyncio.to_thread(...)` so the event loop is never blocked.
- A fresh boto3 client is produced per call via a private `_client()` helper (avoids thread-safety issues with shared clients).
- Module singleton `r2Storage = R2StorageService()`.

### Environment variables (`.env`, `.env.example`, `.env.production.example`)

```env
# --- Object Storage (Cloudflare R2) ---
R2_ENABLED=true
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_token_access_key_id
R2_SECRET_ACCESS_KEY=your_token_secret_access_key
R2_BUCKET_NAME=mera
R2_REGION=auto
# Optional — derived from R2_ACCOUNT_ID when empty
# R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
# R2_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev
```

New dependency: `boto3` pinned in `server/requirements.txt`.

### Data model

- `documents.filePath` column stores the R2 object key for new uploads. No schema change.
- Key layout:
  - Source file: `documents/<documentId>/<storedFilename>`
  - Converted `.docx` (from a `.doc` upload): `documents/<documentId>/<stem>.docx`
  - OCR output: `ocr/<documentId>.md`
- `documents.ocrFilePath` stores the OCR R2 key.

### Upload flow (`_uploadOne`)

- Compute `contentHash`, dedupe, and dedupe-rename exactly as today.
- Generate `storedFilename` as today, build key `documents/<documentId>/<storedFilename>`.
- If `R2_ENABLED`: `await r2Storage.uploadBytes(content, key, content_type)` then `create(... filePath=key ...)`; do not write to `UPLOAD_DIR`.
- Else: write to `UPLOAD_DIR` as today.
- On upload failure: exception is caught by `uploadDocuments`, logged, and a per-file `{"error": ...}` is returned.

### Processing flow (`_processDocument`)

- Wrapped in `async with self._sem:` where `self._sem = asyncio.Semaphore(4)` (configurable via env `DOC_PROCESSING_CONCURRENCY`, default 4) so bursts of uploads queue rather than thundering the OCR/index pipeline.
- Download source from R2 to a guarded temp location before any local reads:
  - If `R2_ENABLED`: `tempPath = await r2Storage.downloadToTemp(filePath)`; otherwise `tempPath = filePath` (local path, no download).
- Temp files created with `tempfile.NamedTemporaryFile(delete=False, suffix=...)` or `tempfile.mkstemp`, named per `documentId`, and removed in a `finally` block (even on exception).
- `.doc` → `.docx` conversion runs on the temp file as today. After successful conversion, upload the `.docx` to R2 (`documents/<documentId>/<stem>.docx`) and call `updateFilePath(documentId, docxKey, "docx")` so retry/index/serve always reference the converted artifact.
- OCR: run on the temp path as today. Serialize `ocrPages` to **markdown** and upload to `ocr/<documentId>.md` on R2; then `updateOcr(documentId, "completed", ocrFilePath=ocrKey)`.
- Index and summary read from the temp path exactly as today.
- Delete the temp file in `finally`.

### Serving flow (`router.serveDocumentFile`)

- If the stored `filePath` is a local path (legacy document): keep `FileResponse(path=filePath)`.
- If it is an R2 key: `await r2Storage.downloadToTemp(filePath)` (or stream), return `StreamingResponse` with the same MIME type from the existing MIME map. Cleanup temp after streaming.
- OCR endpoint (`GET /documents/{id}/ocr`): if `ocrFilePath` is an R2 key, `await r2Storage.readText(ocrKey, ...)`; else read local file as today. Response shape unchanged.

### Delete flow (`deleteDocument`)

- If `R2_ENABLED` and the stored path is an R2 key: `await r2Storage.delete(docKey)` and `await r2Storage.delete(ocrKey)` instead of `os.remove`.
- Legacy local paths still use `os.remove`.
- RAG chunk/index cleanup unchanged.

### Retry flow (`retryDocument`)

- Replace `os.path.exists(doc["filePath"])` with a storage-aware check: `R2_ENABLED` → `await r2Storage.exists(key)`; else `os.path.exists(...)`. Same for deciding retryability.

### Document context reads

- `getDocumentContext` / `searchDocumentContext` read `ocrFilePath`/`filePath` off disk today. Add `_readTextFromStorage(key, maxChars)`:
  - R2 key → `await r2Storage.readText(key, maxChars)`.
  - Local path → existing `_readTextContent(path, maxChars)`.
- These methods become `async` (they already are async callers).

## Concurrency design

- `asyncio.Semaphore` bounds concurrent `_processDocument` runs (default 4; env `DOC_PROCESSING_CONCURRENCY`).
- All boto3 calls go through `asyncio.to_thread` — no blocking of the event loop during bursts.
- Unique temp files per `documentId` (never shared names) so parallel processing never collides.
- Temp cleanup in `finally` prevents disk leaks under parallel load and on errors.
- A document deleted while its `_processDocument` is still running causes a handled download/index failure: caught by the existing outer try/except, logged, status set to failed — no crash.
- `_processDocument` background tasks run via `asyncio.create_task` as today (no change); each task self-contains its semaphore acquire/release.

## Error handling

- Every R2 call is wrapped in try/except with `logger.error(...)` before returning/raising (CLAUDE.md standard).
- Upload failure → per-file error dictionary returned to the client (current behavior).
- Process-time download/index failure → `updateEmbedding("failed", errorMsg="Embedding failed. Please retry.")` (current behavior preserved).
- Temp cleanup always in `finally`.
- No bare `except:` anywhere.

## Files touched

- Create: `server/modules/storage/r2Storage.py`
- Create: `server/tests/storage/test_r2Storage.py`
- Modify: `server/modules/knowledge/service.py`
- Modify: `server/modules/knowledge/router.py`
- Modify: `server/requirements.txt` (add boto3)
- Modify: `.env.example`, `.env.production.example`

## Testing

### Unit tests (`server/tests/storage/test_r2Storage.py`)

Mock boto3 via `monkeypatch` (fake S3 client) — no real R2 needed:

- `uploadBytes` calls `put_object` with correct bucket/key/content type/BytesIO, returns key.
- `downloadToTemp` yields a temp path containing the object bytes.
- `delete` calls `delete_object` with correct bucket/key.
- `exists` reflects `head_object` success/failure.
- `readText` returns content within `maxChars`.
- `R2_ENABLED=false` → service inert; methods raise/logged appropriately.

### Service tests (`server/tests/knowledge/`)

With `r2Storage` mocked (`AsyncMock`):

- `_uploadOne` uploads to R2 (not disk), record `filePath` is the R2 key.
- `_processDocument` downloads temp → runs pipeline → uploads OCR markdown → `updateOcr` with OCR key.
- `deleteDocument` calls `r2Storage.delete` for both keys.
- `retryDocument` uses `r2Storage.exists` instead of `os.path.exists`.
- Legacy/local path branches still work (R2_ENABLED=false).

### End-to-end verification

- `.venv\Scripts\python.exe -m pytest server\tests -v` all green.
- Manual with real creds: set `R2_ENABLED=true`, upload many files from multiple users concurrently; verify objects in the R2 bucket, files serve correctly, OCR markdown present, delete removes objects.

## Out of scope

- Migrating existing local documents to R2.
- Public R2 URL / CDN serving; frontend stays on the backend proxy.
- The smart OCR pipeline work (deferred).