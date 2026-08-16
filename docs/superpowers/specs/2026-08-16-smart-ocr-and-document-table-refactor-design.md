# Document Page Refactor + Smart OCR Pipeline Design

Date: 2026-08-16

## Goal

1. Refactor the frontend `DocumentTable` (currently 541 lines) into smaller, single-purpose units.
2. Add a smart OCR pipeline on the backend:
   - Use Firecrawl `pdf-inspector` (Python binding) to classify PDFs (TextBased/Scanned/Mixed), extract native text as Markdown, and report per-page OCR routing (`pages_needing_ocr`).
   - Use self-hosted PaddleOCR-VL-1.6 (via vLLM server, OpenAI-compatible API) as the OCR provider.
   - Only OCR pages that actually need it; merge native + OCR text per page.

## Scope

### In scope
- Frontend refactor of `DocumentTable.tsx` into focused hooks/components.
- Backend: new `PaddleVLProvider` calling self-hosted vLLM PaddleOCR-VL-1.6.
- Backend: `pdf-inspector` integration replacing `PdfParser` (pymupdf4llm) and serving as OCR router.
- Backend: per-page merge of native text + OCR text.
- Env config: `OCR_PROVIDER`, `PADDLE_VL_VLLM_URL`, `PADDLE_VL_VLLM_MODEL`, `PDF_INSPECTOR_ENABLED`.
- Deployment instructions for self-hosted PaddleOCR-VL-1.6 (vLLM / Docker).

### Out of scope
- `DocumentUploadZone.tsx` (370 lines) — not refactored this round.
- `DocumentsPage.tsx` — stays a layout shell.
- Any change to embedding/RAG indexing flow (only the input to indexing changes).

## Frontend Refactor

`DocumentTable.tsx` (541 lines) is split into:

| Unit | Responsibility |
|---|---|
| `useDocumentContents` (new hook) | Fetch + polling of folders & documents by `folderId`; exposes `{ folders, documents, loading, refresh }` |
| `DocumentToolbar` (new) | Search input, select-all checkbox, bulk delete button, New-folder button |
| `NewFolderForm` / `RenameFolderForm` (new) | Inline inputs for create/rename folder (Enter=submit, Esc=cancel) |
| `DeleteConfirmDialogs` (new) | ConfirmDialog wrappers for bulk document delete + folder delete |
| `DocumentTable` | Slim orchestration: render rows (DocumentCard/FolderCard), pagination, modals (DocumentDetailModal, OcrViewerModal) |

- `FolderCard`, `DocumentCard`, `DocumentStatusBadge`, `Table`, `Checkbox`, `Breadcrumb` unchanged.
- `DocumentsPage` keeps the same props contract with `DocumentTable` (`refreshTrigger`, `folderId`, `onNavigateFolder`).

### New file layout
```
src/components/document/
├── DocumentTable.tsx          # slimmed orchestration
├── useDocumentContents.ts     # NEW: fetch + polling hook
├── DocumentToolbar.tsx        # NEW
├── NewFolderForm.tsx          # NEW
├── RenameFolderForm.tsx       # NEW
└── DeleteConfirmDialogs.tsx   # NEW
```

## Backend OCR Pipeline

### New flow in `knowledge/service.py:_processDocument`
```
PDF arrives
  → pdf_inspector.process_pdf(filePath)
       ├─ pdf_type in {TextBased, Mixed, Scanned}
       ├─ markdown (native text, position-aware)
       └─ pages_needing_ocr: list[int]  (1-indexed)
  → TextBased + high confidence + no pages_needing_ocr
       → index native markdown directly, skip OCR
  → Mixed / Scanned
       → native pages: keep pdf-inspector markdown
       → scanned pages: render page (PyMuPDF, dpi 300) → PaddleVLProvider (vLLM server) → text
       → merge by pageNumber → save ocrFilePath → index
```

### `pdf-inspector` integration
- Install: `pip install pdf-inspector`
- Replaces `PdfParser` (pymupdf4llm) in `documentParser.py`.
- API (Python): `pdf_inspector.process_pdf(path)` → `result.pdf_type`, `result.markdown`, `result.pages_needing_ocr`.
- If `PDF_INSPECTOR_ENABLED=false` or import/exec fails → fallback to existing `PdfParser` (pymupdf4llm) with zero behavior change.

### New `PaddleVLProvider` (self-hosted vLLM)
- Lives in `server/modules/ocr/ocrProvider.py` (single-file provider pattern per CLAUDE.md).
- Env:
  - `OCR_PROVIDER=paddle-vl-vllm`
  - `PADDLE_VL_VLLM_URL` (default `http://127.0.0.1:8080/v1`)
  - `PADDLE_VL_VLLM_MODEL` (default `PaddleOCR-VL-1.6`)
  - `PADDLE_VL_VLLM_TIMEOUT` (default 180)
- Calls OpenAI-compatible `/v1/chat/completions` with an image (base64) + extraction prompt; returns extracted text/Markdown.
- `ocrImages(imagePaths, lang)` → `List[OcrPage]` (per-image, pageNumber=i+1).
- On HTTP/network failure → fallback chain: `paddle-vl-cloud` (AI Studio) → `paddle` local → log error, page text empty (never crashes pipeline).

### Per-page merge
- `OcrPage` already carries `pageNumber`.
- Native text (pdf-inspector markdown) mapped to pages; OCR text mapped to scanned pages; merge into a single ordered page list → `saveOcrText()` → `ocrFilePath` → indexing unchanged.

## Env additions (.env)
```
OCR_PROVIDER=paddle-vl-vllm
PADDLE_VL_VLLM_URL=http://127.0.0.1:8080/v1
PADDLE_VL_VLLM_MODEL=PaddleOCR-VL-1.6
PADDLE_VL_VLLM_TIMEOUT=180
PDF_INSPECTOR_ENABLED=true
```

## Error handling & fallback
- pdf-inspector failure → fallback `PdfParser`.
- vLLM server down → fallback `paddle-vl-cloud` → `paddle` local.
- Individual page OCR failure → empty `OcrPage`, pipeline continues.
- All exceptions logged via `logger.error` per CLAUDE.md conventions.

## Deployment guide (self-hosted PaddleOCR-VL-1.6)
Documented in plan; two options:
1. Official Docker image: `ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-genai-vllm-server:latest-nvidia-gpu` with `paddleocr genai_server --model_name PaddleOCR-VL-1.6`.
2. vLLM directly: `vllm serve PaddlePaddle/PaddleOCR-VL-1.6 --port 8080 --trust-remote-code`.

## Testing
- Script (temp or `server/tests/`): run `process_pdf` on a text-based sample and a mixed sample; assert `pdf_type`, `pages_needing_ocr`, non-empty markdown.
- Test `PaddleVLProvider` against a running vLLM server with a sample image (if available).
- Frontend: `npm run build`; verify DocumentTable renders after refactor.
- Manual: upload a scanned PDF + a text PDF; verify both index successfully.

## Success criteria
- `DocumentTable.tsx` reduced to orchestration (~<250 lines); new units each single-purpose.
- Text-based PDFs index without invoking OCR.
- Scanned/mixed PDFs route only scanned pages to OCR; merged text indexes.
- Fallbacks work (pdf-inspector absent / vLLM down) without breaking uploads.
- Frontend builds clean.
