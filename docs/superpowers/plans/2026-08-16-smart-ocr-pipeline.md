# Smart OCR Pipeline Implementation Plan (pdf-inspector + PaddleOCR-VL-1.6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-or-nothing OCR flow with a smart pipeline: Firecrawl `pdf-inspector` classifies PDFs and extracts native text; only pages that truly need OCR are sent to a self-hosted PaddleOCR-VL-1.6 vLLM server.

**Architecture:** `pdf-inspector` (Python) becomes both the PDF text parser (replacing `pymupdf4llm`) and the OCR router. A new `PaddleVLvLLMProvider` calls a self-hosted vLLM OpenAI-compatible `/v1/chat/completions` endpoint. `_processDocument` decides: text_based → index native markdown (no OCR); mixed/scanned → OCR only `pages_needing_ocr`, merge with native page text.

**Tech Stack:** Python 3.12, FastAPI, PyMuPDF (`fitz`), `pdf-inspector` (PyPI, Rust binding), httpx, pytest, vLLM self-hosted PaddleOCR-VL-1.6.

## Global Constraints

- All Python function/method/variable names camelCase (`inspectPdf`, `smartOcrPages`).
- Cross-module rule: modules import other modules only via their public facade (`ocrService`). `documentParser.py` (rag module) must NOT import from the ocr module — it imports the third-party `pdf_inspector` package directly.
- Every try/except must call `logger.error(...)` or `logger.warning(...)` before returning (per CLAUDE.md). No bare except.
- Background task `_processDocument` must never crash: any OCR per-page failure yields an empty `OcrPage`, log, continue.
- Env gates read at call time via `os.getenv(...)` so tests can monkeypatch.
- Run backend tests from project root with: `.venv\Scripts\python.exe -m pytest server\tests -v`
- Existing file `ocrProvider.py` is kept; new code appends to it per the single-file provider pattern.

---

## Task B1: Install pdf-inspector and add env vars

**Files:**
- Modify: `server/requirements.txt`
- Modify: `.env.example` (the `# --- OCR ---` section, lines ~90-100)

**Interfaces:**
- Produces: `pdf-inspector` installable as `import pdf_inspector`; env vars `PDF_INSPECTOR_ENABLED`, `PADDLE_VL_VLLM_URL`, `PADDLE_VL_VLLM_MODEL`, `PADDLE_VL_VLLM_TIMEOUT`.

- [ ] **Step 1: Install the package in the root venv**

```bash
.venv\Scripts\python.exe -m pip install pdf-inspector
```

Then pin the exact installed version in `server/requirements.txt`:

```text
pdf-inspector==<installed-version>
```

- [ ] **Step 2: Verify the import works**

Run: `.venv\Scripts\python.exe -c "import pdf_inspector; print('ok')"`
Expected: prints `ok`, no traceback.

- [ ] **Step 3: Update `.env.example` OCR section**

After `# PADDLEOCR_VL_PRETTIFY=true`, add:

```env
# PaddleOCR-VL self-hosted via vLLM server (OpenAI-compatible /v1/chat/completions).
# Requires OCR_PROVIDER=paddle-vl-vllm. Server URL defaults to http://127.0.0.1:8080/v1.
PADDLE_VL_VLLM_URL=http://127.0.0.1:8080/v1
PADDLE_VL_VLLM_MODEL=PaddleOCR-VL-1.6
PADDLE_VL_VLLM_TIMEOUT=180
# pdf-inspector smart routing: classify PDFs + extract native text, OCR only scanned pages.
# Set to false to fall back to the legacy whole-document OCR flow.
PDF_INSPECTOR_ENABLED=true
```

Update the `# OCR_PROVIDER: tesseract | paddle | ...` comment line to include `| paddle-vl-vllm`.

- [ ] **Step 4: Commit**

```bash
git add server/requirements.txt .env.example
git commit -m "feat: add pdf-inspector dependency and new OCR env vars"
```

---

## Task B2: Add the `PaddleVLvLLMProvider` provider

**Files:**
- Modify: `server/modules/ocr/ocrProvider.py`

**Interfaces:**
- Produces: class `PaddleVLvLLMProvider` implementing the existing `OcrProvider` protocol (`ocrImages(imagePaths, lang) -> List[OcrPage]`, property `providerName -> str`); registered in `OCRService._getProvider` for `OCR_PROVIDER=paddle-vl-vllm`.
- Also adds public `OCRService.ocrImages(imagePaths, lang=None)` and `OCRService.getProvider()`.

- [ ] **Step 1: Append the provider class to `ocrProvider.py`**

Add after `VisionLLMOcrProvider` (before `_pdfToImages`):

```python
class PaddleVLvLLMProvider:
    """OCR via a self-hosted PaddleOCR-VL vLLM server (OpenAI-compatible API)."""

    _PROMPT = (
        "Extract all text from this document image exactly as it appears. "
        "Preserve line breaks and paragraph structure. Return only the extracted text, no commentary."
    )

    def __init__(self, url: str = None, model: str = None, timeout: float = None):
        self._url = (url or os.getenv("PADDLE_VL_VLLM_URL") or "http://127.0.0.1:8080/v1").rstrip("/")
        self._model = model or os.getenv("PADDLE_VL_VLLM_MODEL") or "PaddleOCR-VL-1.6"
        self._timeout = float(timeout if timeout is not None else os.getenv("PADDLE_VL_VLLM_TIMEOUT", "180"))

    def _encodeImage(self, imagePath: str) -> str:
        import base64
        with open(imagePath, "rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")
        return f"data:image/png;base64,{data}"

    def _ocrOne(self, imagePath: str) -> str:
        import httpx
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": self._encodeImage(imagePath)}},
                        {"type": "text", "text": self._PROMPT},
                    ],
                }
            ],
            "max_tokens": 4096,
        }
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(f"{self._url}/chat/completions", json=payload)
            resp.raise_for_status()
            body = resp.json()
        choices = body.get("choices", []) if isinstance(body, dict) else []
        if not choices:
            return ""
        return (choices[0].get("message", {}).get("content") or "").strip()

    def ocrImages(self, imagePaths: List[str], lang: str) -> List[OcrPage]:
        results: List[OcrPage] = []
        for i, imgPath in enumerate(imagePaths):
            try:
                text = self._ocrOne(imgPath)
                results.append(OcrPage(text=text, pageNumber=i + 1, confidence=None))
            except Exception as e:
                logger.error(f"PaddleVLvLLMProvider.ocrImages failed on page {i + 1}: {e}")
                results.append(OcrPage(text="", pageNumber=i + 1, confidence=0.0))
        return results

    @property
    def providerName(self) -> str:
        return "paddle-vl-vllm"
```

- [ ] **Step 2: Register it in `OCRService._getProvider`**

```python
                elif self._providerName in ("paddle-vl-vllm", "vllm"):
                    self._provider = PaddleVLvLLMProvider()
```

Add public methods to `OCRService`:

```python
    def getProvider(self) -> OcrProvider:
        return self._getProvider()

    def ocrImages(self, imagePaths: List[str], lang: str = None) -> List[OcrPage]:
        lang = lang or self._lang
        return self._getProvider().ocrImages(imagePaths, lang)
```

- [ ] **Step 3: Write the failing tests**

Create `server/tests/ocr/test_ocrProvider.py`:

```python
# server/tests/ocr/test_ocrProvider.py
def test_paddlevlvllm_providerName():
    from modules.ocr.ocrProvider import PaddleVLvLLMProvider
    provider = PaddleVLvLLMProvider(url="http://127.0.0.1:8080/v1")
    assert provider.providerName == "paddle-vl-vllm"


def test_paddlevlvllm_ocrImages_uses_provider_text(monkeypatch, tmp_path):
    from modules.ocr.ocrProvider import PaddleVLvLLMProvider
    provider = PaddleVLvLLMProvider(url="http://127.0.0.1:8080/v1")
    monkeypatch.setattr(provider, "_ocrOne", lambda p: "extracted text")

    img1 = tmp_path / "p1.png"
    img2 = tmp_path / "p2.png"
    img1.write_bytes(b"x")
    img2.write_bytes(b"x")

    pages = provider.ocrImages([str(img1), str(img2)], "vie")
    assert len(pages) == 2
    assert pages[0].text == "extracted text"
    assert pages[1].pageNumber == 2


def test_paddlevlvllm_ocrImages_failure_returns_empty(monkeypatch, tmp_path):
    from modules.ocr.ocrProvider import PaddleVLvLLMProvider

    def boom(path):
        raise RuntimeError("server down")

    provider = PaddleVLvLLMProvider(url="http://127.0.0.1:8080/v1")
    monkeypatch.setattr(provider, "_ocrOne", boom)
    img = tmp_path / "p1.png"
    img.write_bytes(b"x")

    pages = provider.ocrImages([str(img)], "vie")
    assert pages[0].text == ""
    assert pages[0].confidence == 0.0


def test_ocrService_selects_paddlevlvllm(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "paddle-vl-vllm")
    from modules.ocr.ocrProvider import OCRService, PaddleVLvLLMProvider
    svc = OCRService()
    assert isinstance(svc._getProvider(), PaddleVLvLLMProvider)
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest server\tests\ocr\test_ocrProvider.py -v`
Expected: FAIL — `ModuleNotFoundError` or `AttributeError` for `PaddleVLvLLMProvider`.

- [ ] **Step 5: Verify tests pass**

Run: `.venv\Scripts\python.exe -m pytest server\tests\ocr\test_ocrProvider.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add server/modules/ocr/ocrProvider.py server/tests/ocr/test_ocrProvider.py
git commit -m "feat: add self-hosted PaddleOCR-VL vLLM OCR provider"
```

---

## Task B3: pdf-inspector classification + smart per-page OCR

**Files:**
- Modify: `server/modules/ocr/ocrProvider.py`

**Interfaces:**
- Produces:
  - Module dataclass `PdfInspection` with fields `pdfType: str`, `pagesNeedingOcr: List[int]` (1-indexed), `pageCount: int`, `markdown: Optional[str] = None`.
  - Module singleton `pdfInspectorService = PdfInspectorService()`:
    - `inspect(filePath) -> Optional[PdfInspection]`
    - `smartOcrPages(filePath, ocrFn) -> Optional[List[OcrPage]]` where `ocrFn(imagePaths) -> List[OcrPage]`.
  - Module helper `_renderPdfPages(pdfPath, outputDir, pageNumbers) -> List[str]`.

- [ ] **Step 1: Add the dataclass + render helper**

Add `PdfInspection` right after the `OcrPage` dataclass:

```python
@dataclass
class PdfInspection:
    pdfType: str
    pagesNeedingOcr: List[int]
    pageCount: int
    markdown: Optional[str] = None
```

Add `_renderPdfPages` right after `_pdfToImages`:

```python
def _renderPdfPages(pdfPath: str, outputDir: str, pageNumbers: List[int]) -> List[str]:
    """Render only the given 1-indexed page numbers to PNG using PyMuPDF."""
    import fitz
    doc = fitz.open(pdfPath)
    imagePaths: List[str] = []
    try:
        for pageNum in pageNumbers:
            page = doc[pageNum - 1]
            pix = page.get_pixmap(dpi=300)
            imgPath = os.path.join(outputDir, f"page_{pageNum}.png")
            pix.save(imgPath)
            imagePaths.append(imgPath)
    finally:
        doc.close()
    return imagePaths
```

- [ ] **Step 2: Add `PdfInspectorService` before `OCRService`**

```python
class PdfInspectorService:
    """Wraps pdf-inspector (Firecrawl) for PDF classification and per-page OCR routing."""

    @staticmethod
    def _enabled() -> bool:
        return os.getenv("PDF_INSPECTOR_ENABLED", "true").lower() in ("1", "true", "yes", "on")

    def inspect(self, filePath: str) -> Optional[PdfInspection]:
        if not self._enabled():
            return None
        try:
            import pdf_inspector
            result = pdf_inspector.process_pdf(filePath)
            if result is None:
                logger.warning(f"PdfInspectorService.inspect: pdf_inspector returned None for '{filePath}'")
                return None
            return PdfInspection(
                pdfType=getattr(result, "pdf_type", "unknown"),
                pagesNeedingOcr=list(getattr(result, "pages_needing_ocr", None) or []),
                pageCount=int(getattr(result, "page_count", 0) or 0),
                markdown=getattr(result, "markdown", None),
            )
        except Exception as e:
            logger.warning(f"PdfInspectorService.inspect: pdf-inspector unavailable for '{filePath}': {e}")
            return None

    def smartOcrPages(self, filePath: str, ocrFn) -> Optional[List[OcrPage]]:
        """Return per-page text: native markdown where extractable, OCR text where needed.

        ocrFn(imagePaths: List[str]) -> List[OcrPage]
        Returns None if pdf-inspector unavailable, [] if text-based, else merged pages.
        """
        inspection = self.inspect(filePath)
        if inspection is None:
            return None
        if inspection.pdfType == "text_based" and not inspection.pagesNeedingOcr:
            return []
        try:
            import tempfile
            import pdf_inspector
            pagesResult = pdf_inspector.extract_pages_markdown(filePath)
            if pagesResult is None or not getattr(pagesResult, "pages", None):
                logger.warning(f"PdfInspectorService.smartOcrPages: no pages extracted for '{filePath}'")
                return None
            needNums = [p.page + 1 for p in pagesResult.pages if getattr(p, "needs_ocr", False)]
            if not needNums:
                needNums = inspection.pagesNeedingOcr
            with tempfile.TemporaryDirectory() as tmpDir:
                imagePaths = _renderPdfPages(filePath, tmpDir, needNums)
                ocrResults = ocrFn(imagePaths) if imagePaths else []
                ocrByPage = dict(zip(needNums, ocrResults))
                merged: List[OcrPage] = []
                for p in pagesResult.pages:
                    pageNum = p.page + 1
                    ocr = ocrByPage.get(pageNum)
                    text = (ocr.text if ocr else "") or (getattr(p, "markdown", "") or "")
                    merged.append(
                        OcrPage(text=text.strip(), pageNumber=pageNum, confidence=ocr.confidence if ocr else None)
                    )
            return merged
        except Exception as e:
            logger.error(f"PdfInspectorService.smartOcrPages failed for '{filePath}': {e}")
            return None
```

Add the singleton next to the existing `ocrService = OCRService()` at the bottom of the file:

```python
pdfInspectorService = PdfInspectorService()
```

- [ ] **Step 3: Write the failing tests**

Append to `server/tests/ocr/test_ocrProvider.py`:

```python
import sys
import types


def _installFakePdfInspector(monkeypatch, pdfType="mixed", pagesNeedingOcr=(2,), pageCount=3):
    fake = types.ModuleType("pdf_inspector")

    class FakePage:
        def __init__(self, page, markdown, needs_ocr):
            self.page = page
            self.markdown = markdown
            self.needs_ocr = needs_ocr

    class FakeInspection:
        pdf_type = pdfType
        pages_needing_ocr = list(pagesNeedingOcr)
        page_count = pageCount

    class FakeExtraction:
        pages = [
            FakePage(0, "native text one", False),
            FakePage(1, None, True),
            FakePage(2, "native text three", False),
        ]

    fake.process_pdf = lambda p: FakeInspection()
    fake.extract_pages_markdown = lambda p: FakeExtraction()
    monkeypatch.setitem(sys.modules, "pdf_inspector", fake)
    monkeypatch.setenv("PDF_INSPECTOR_ENABLED", "true")


def test_pdfInspectorService_disabled_returns_none(monkeypatch):
    monkeypatch.setenv("PDF_INSPECTOR_ENABLED", "false")
    from modules.ocr.ocrProvider import pdfInspectorService
    assert pdfInspectorService.inspect("any.pdf") is None


def test_pdfInspectorService_inspect_returns_inspection(monkeypatch):
    _installFakePdfInspector(monkeypatch)
    from modules.ocr.ocrProvider import pdfInspectorService
    inspection = pdfInspectorService.inspect("doc.pdf")
    assert inspection is not None
    assert inspection.pdfType == "mixed"
    assert inspection.pagesNeedingOcr == [2]
    assert inspection.pageCount == 3


def test_smartOcrPages_text_based_returns_empty(monkeypatch):
    _installFakePdfInspector(monkeypatch, pdfType="text_based", pagesNeedingOcr=())
    from modules.ocr.ocrProvider import pdfInspectorService
    result = pdfInspectorService.smartOcrPages("doc.pdf", ocrFn=lambda paths: [])
    assert result == []


def test_smartOcrPages_mixed_merges_native_and_ocr(monkeypatch):
    _installFakePdfInspector(monkeypatch, pagesNeedingOcr=(2,))
    from modules.ocr.ocrProvider import pdfInspectorService, OcrPage

    def ocrFn(imagePaths):
        assert len(imagePaths) == 1
        return [OcrPage(text="ocr text page 2", pageNumber=1)]

    monkeypatch.setattr(
        "modules.ocr.ocrProvider._renderPdfPages",
        lambda pdf, out, nums: ["/tmp/p2.png"],
    )

    pages = pdfInspectorService.smartOcrPages("doc.pdf", ocrFn=ocrFn)
    assert pages is not None
    assert len(pages) == 3
    assert pages[0].text == "native text one"
    assert pages[1].text == "ocr text page 2"
    assert pages[1].pageNumber == 2
    assert pages[2].text == "native text three"


def test_smartOcrPages_exception_returns_none(monkeypatch):
    _installFakePdfInspector(monkeypatch, pagesNeedingOcr=(2,))
    from modules.ocr.ocrProvider import pdfInspectorService

    monkeypatch.setattr(
        "modules.ocr.ocrProvider._renderPdfPages",
        lambda pdf, out, nums: (_ for _ in ()).throw(IOError("no file")),
    )

    pages = pdfInspectorService.smartOcrPages("doc.pdf", ocrFn=lambda paths: [])
    assert pages is None
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest server\tests\ocr\test_ocrProvider.py -v`
Expected: FAIL — `AttributeError` for `pdfInspectorService` or `PdfInspection` not found.

- [ ] **Step 5: Verify tests pass**

Run same command. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/modules/ocr/ocrProvider.py server/tests/ocr/test_ocrProvider.py
git commit -m "feat: pdf-inspector classification and per-page OCR routing"
```

---

## Task B4: Wire smart OCR routing into `_processDocument`

**Files:**
- Modify: `server/modules/knowledge/service.py`

**Interfaces:**
- Consumes: `pdfInspectorService`, `ocrService.ocrImages(...)`, `needsOcr(filePath)` (legacy fallback).
- Produces: `_processDocument` behavior:
  - PDF + text_based → `smartOcrPages` returns `[]` → no OCR, index native PDF.
  - PDF + mixed/scanned → smart OCR, write merged `ocrFilePath`, index it.
  - PDF + pdf-inspector unavailable → `smartOcrPages` returns `None` → legacy `needsOcr` + `ocrService.ocrFile` fallback.

- [ ] **Step 1: Update the import**

Change line 15 from:

```python
from modules.ocr.ocrProvider import ocrService, needsOcr
```

to:

```python
from modules.ocr.ocrProvider import ocrService, needsOcr, pdfInspectorService
```

- [ ] **Step 2: Replace the OCR block in `_processDocument`**

Replace the block from `indexPath = filePath` through the end of the `if isScanned:` clause (currently lines 203-222) with:

```python
            isScanned = False
            ocrFilePath = None
            if ext == ".pdf":
                ocrPages = pdfInspectorService.smartOcrPages(
                    filePath,
                    ocrFn=lambda imagePaths: ocrService.ocrImages(imagePaths),
                )
                if ocrPages is not None and ocrPages:
                    logger.info(f"_processDocument OCR start documentId={documentId} pdfType=mixed/scanned")
                    try:
                        await documentRepository.updateOcr(documentId, "processing", isScanned=True)
                        tOcr = time.perf_counter()
                        ocrFilePath = str(OCR_DIR / f"{documentId}_ocr.txt")
                        ocrService.saveOcrText(ocrPages, ocrFilePath)
                        await documentRepository.updateOcr(documentId, "completed", ocrFilePath=ocrFilePath)
                        indexPath = ocrFilePath
                        isScanned = True
                        logger.info(f"_processDocument OCR done pages={len(ocrPages)} elapsed={time.perf_counter()-tOcr:.2f}s documentId={documentId}")
                    except Exception as e:
                        logger.error(f"OCR failed for {documentId}: {e}")
                        await documentRepository.updateOcr(documentId, "failed")
                elif ocrPages == []:
                    logger.info(f"_processDocument text_based PDF, no OCR needed documentId={documentId}")
                    await documentRepository.updateOcr(documentId, "completed", isScanned=False)
                else:
                    isScanned = needsOcr(filePath)
                    if isScanned:
                        try:
                            await documentRepository.updateOcr(documentId, "processing", isScanned=True)
                            tOcr = time.perf_counter()
                            logger.info(f"_processDocument OCR start documentId={documentId} provider={ocrService.providerName}")
                            ocrPages = ocrService.ocrFile(filePath)
                            logger.info(f"_processDocument OCR done pages={len(ocrPages)} elapsed={time.perf_counter()-tOcr:.2f}s documentId={documentId}")
                            ocrFilePath = str(OCR_DIR / f"{documentId}_ocr.txt")
                            ocrService.saveOcrText(ocrPages, ocrFilePath)
                            await documentRepository.updateOcr(documentId, "completed", ocrFilePath=ocrFilePath)
                            indexPath = ocrFilePath
                        except Exception as e:
                            logger.error(f"OCR failed for {documentId}: {e}")
                            await documentRepository.updateOcr(documentId, "failed")
            else:
                isScanned = needsOcr(filePath)
                if isScanned:
                    try:
                        await documentRepository.updateOcr(documentId, "processing", isScanned=True)
                        tOcr = time.perf_counter()
                        logger.info(f"_processDocument OCR start documentId={documentId} provider={ocrService.providerName}")
                        ocrPages = ocrService.ocrFile(filePath)
                        logger.info(f"_processDocument OCR done pages={len(ocrPages)} elapsed={time.perf_counter()-tOcr:.2f}s documentId={documentId}")
                        ocrFilePath = str(OCR_DIR / f"{documentId}_ocr.txt")
                        ocrService.saveOcrText(ocrPages, ocrFilePath)
                        await documentRepository.updateOcr(documentId, "completed", ocrFilePath=ocrFilePath)
                        indexPath = ocrFilePath
                    except Exception as e:
                        logger.error(f"OCR failed for {documentId}: {e}")
                        await documentRepository.updateOcr(documentId, "failed")
```

Note: the branch order matters — `None` from `smartOcrPages` falls into legacy `needsOcr` fallback; `[]` skips OCR.

- [ ] **Step 3: Write the failing tests**

Append to `server/tests/knowledge/test_service.py`:

```python
def test__processDocument_pdf_uses_pdfInspector_smartOcr():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService, OCR_DIR
    from modules.ocr.ocrProvider import OcrPage

    pages = [OcrPage(text="native one", pageNumber=1), OcrPage(text="ocr two", pageNumber=2)]
    with patch("modules.knowledge.service.pdfInspectorService.smartOcrPages", return_value=pages) as mockSmart, \
         patch("modules.knowledge.service.documentRepository.updateEmbedding", new=AsyncMock()), \
         patch("modules.knowledge.service.documentRepository.updateOcr", new=AsyncMock()) as mockOcr, \
         patch("modules.knowledge.service.documentRepository.updateFilePath", new=AsyncMock()), \
         patch("modules.knowledge.service.ragService.index", new=AsyncMock(return_value=4)), \
         patch("modules.knowledge.service._extractPageCount", return_value=2), \
         patch("modules.knowledge.service._generateSummary", new=AsyncMock()), \
         patch("modules.knowledge.service.ocrService.saveOcrText", return_value=str(OCR_DIR / "doc1_ocr.txt")) as mockSave:
        asyncio.get_event_loop().run_until_complete(
            documentService._processDocument("doc1", "/fake/a.pdf", "user1", "user1", "a.pdf")
        )
    mockSmart.assert_called_once()
    mockSave.assert_called_once()
    assert mockOcr.call_args_list[-1][0][0] == "completed"


def test__processDocument_pdf_textBased_skips_ocr():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService

    with patch("modules.knowledge.service.pdfInspectorService.smartOcrPages", return_value=[]) as mockSmart, \
         patch("modules.knowledge.service.documentRepository.updateEmbedding", new=AsyncMock()), \
         patch("modules.knowledge.service.documentRepository.updateOcr", new=AsyncMock()) as mockOcr, \
         patch("modules.knowledge.service.documentRepository.updateFilePath", new=AsyncMock()), \
         patch("modules.knowledge.service.ragService.index", new=AsyncMock(return_value=3)), \
         patch("modules.knowledge.service._extractPageCount", return_value=1), \
         patch("modules.knowledge.service._generateSummary", new=AsyncMock()):
        asyncio.get_event_loop().run_until_complete(
            documentService._processDocument("doc1", "/fake/a.pdf", "user1", "user1", "a.pdf")
        )
    mockSmart.assert_called_once()
    assert mockOcr.call_args_list[-1][0][0] == "completed"


def test__processDocument_pdf_legacy_fallback_when_inspector_unavailable():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService

    with patch("modules.knowledge.service.pdfInspectorService.smartOcrPages", return_value=None), \
         patch("modules.knowledge.service.documentRepository.updateEmbedding", new=AsyncMock()), \
         patch("modules.knowledge.service.documentRepository.updateOcr", new=AsyncMock()), \
         patch("modules.knowledge.service.documentRepository.updateFilePath", new=AsyncMock()), \
         patch("modules.knowledge.service.ragService.index", new=AsyncMock(return_value=2)), \
         patch("modules.knowledge.service._extractPageCount", return_value=1), \
         patch("modules.knowledge.service._generateSummary", new=AsyncMock()), \
         patch("modules.knowledge.service.needsOcr", return_value=False) as mockNeeds:
        asyncio.get_event_loop().run_until_complete(
            documentService._processDocument("doc1", "/fake/a.pdf", "user1", "user1", "a.pdf")
        )
    mockNeeds.assert_called_once()
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest server\tests\knowledge\test_service.py -v`
Expected: FAIL against the current `_processDocument`.

- [ ] **Step 5: Verify tests pass (full backend suite)**

Run: `.venv\Scripts\python.exe -m pytest server\tests -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/modules/knowledge/service.py server/tests/knowledge/test_service.py
git commit -m "feat: wire pdf-inspector smart OCR routing into document processing"
```

---

## Task B5: Replace `PdfParser` with pdf-inspector (native extraction)

**Files:**
- Modify: `server/modules/rag/documentParser.py`

**Interfaces:**
- Produces: `PdfInspectorParser` with the same `.parse(filePath) -> List[ParsedPage]` contract; registered as the `.pdf` parser; falls back to `PdfParser` (pymupdf4llm) when disabled or on failure.
- Consumes: third-party `pdf_inspector`, `ParsedPage`, `logger`.

- [ ] **Step 1: Add `PdfInspectorParser` before `DocumentParserService`**

```python
class PdfInspectorParser:
    """Parse PDFs with pdf-inspector (Firecrawl); fall back to pymupdf4llm PdfParser."""

    def parse(self, filePath: str) -> List[ParsedPage]:
        if os.getenv("PDF_INSPECTOR_ENABLED", "true").lower() not in ("1", "true", "yes", "on"):
            return PdfParser().parse(filePath)
        try:
            import pdf_inspector
            result = pdf_inspector.extract_pages_markdown(filePath)
            if result is None or not getattr(result, "pages", None):
                logger.warning(f"PdfInspectorParser: no pages extracted for '{filePath}', falling back")
                return PdfParser().parse(filePath)
            pages = []
            for p in result.pages:
                text = (getattr(p, "markdown", "") or "").strip()
                if text:
                    pages.append(ParsedPage(text=text, pageNumber=getattr(p, "page", 0) + 1))
            if not pages:
                return PdfParser().parse(filePath)
            return pages
        except Exception as e:
            logger.warning(f"PdfInspectorParser: falling back to PdfParser for '{filePath}': {e}")
            return PdfParser().parse(filePath)
```

- [ ] **Step 2: Register it in `DocumentParserService.__init__`**

Replace the `.pdf` entry in `_parsers`:

```python
        self._parsers = {
            ".pdf": PdfInspectorParser(),
            ".docx": DocxParser(),
            ".doc": DocxParser(),
            ".xlsx": XlsxParser(),
            ".xls": XlsxParser(),
        }
```

- [ ] **Step 3: Write the failing tests**

Append to `server/tests/rag/test_documentParser.py`:

```python
import sys
import types


def test_pdfInspectorParser_falls_back_when_disabled(monkeypatch, tmp_path):
    import fitz
    pdfPath = tmp_path / "doc.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Hello pdf-inspector")
    doc.save(str(pdfPath))
    doc.close()

    monkeypatch.setenv("PDF_INSPECTOR_ENABLED", "false")
    from modules.rag.documentParser import PdfInspectorParser
    pages = PdfInspectorParser().parse(str(pdfPath))
    assert any("Hello" in p.text for p in pages)


def test_documentParserService_registers_pdfInspectorParser(monkeypatch):
    monkeypatch.setenv("PDF_INSPECTOR_ENABLED", "true")
    from modules.rag.documentParser import documentParserService
    assert documentParserService._parsers[".pdf"].__class__.__name__ == "PdfInspectorParser"


def test_pdfInspectorParser_uses_inspector_when_available(monkeypatch):
    monkeypatch.setenv("PDF_INSPECTOR_ENABLED", "true")

    fake = types.ModuleType("pdf_inspector")

    class FakePage:
        def __init__(self, page, markdown):
            self.page = page
            self.markdown = markdown

    class FakeResult:
        pages = [FakePage(0, "# Heading\nnative text"), FakePage(1, None)]

    fake.extract_pages_markdown = lambda p: FakeResult()
    monkeypatch.setitem(sys.modules, "pdf_inspector", fake)

    from modules.rag.documentParser import PdfInspectorParser
    pages = PdfInspectorParser().parse("x.pdf")
    assert len(pages) == 1
    assert pages[0].pageNumber == 1
```

Note: ensure `import sys`/`import types` are at the top of the test file (merge with existing imports if already present).

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest server\tests\rag\test_documentParser.py -v`
Expected: FAIL — `ImportError`/`AttributeError` for `PdfInspectorParser`.

- [ ] **Step 5: Verify tests pass**

Run same command. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/modules/rag/documentParser.py server/tests/rag/test_documentParser.py
git commit -m "feat: parse PDFs with pdf-inspector native markdown, fallback to pymupdf4llm"
```

---

## Task B6: Self-hosted PaddleOCR-VL-1.6 deployment guide

**Files:**
- Create: `server/docs/paddle-ocr-vl-deploy.md`
- Modify: `server/README.md`

**Interfaces:**
- Produces: runnable deployment instructions for the vLLM server that `PaddleVLvLLMProvider` connects to.

- [ ] **Step 1: Create `server/docs/paddle-ocr-vl-deploy.md`**

```markdown
# Self-hosted PaddleOCR-VL-1.6 (vLLM server)

`PaddleVLvLLMProvider` (OCR_PROVIDER=paddle-vl-vllm) calls the OpenAI-compatible
endpoint of a self-hosted PaddleOCR-VL-1.6 server.

## Option A: Official PaddleOCR Docker image (NVIDIA GPU required)

docker run --rm --gpus all --network host \
  ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-genai-vllm-server:latest-nvidia-gpu \
  paddleocr genai_server --model_name PaddleOCR-VL-1.6 --host 0.0.0.0 --port 8080 --backend vllm

## Option B: vLLM directly

vllm serve PaddlePaddle/PaddleOCR-VL-1.6 \
  --trust-remote-code --port 8080 \
  --max-num-batched-tokens 16384 --no-enable-prefix-caching

## Verify

curl http://127.0.0.1:8080/v1/models

## Configure the backend

PADDLE_VL_VLLM_URL=http://127.0.0.1:8080/v1
PADDLE_VL_VLLM_MODEL=PaddleOCR-VL-1.6
PADDLE_VL_VLLM_TIMEOUT=180
OCR_PROVIDER=paddle-vl-vllm
```

- [ ] **Step 2: Add a short pointer in `server/README.md`**

After the "Quick Start" section, add:

```markdown
## OCR

Processing of scanned/mixed PDFs runs through a self-hosted PaddleOCR-VL-1.6 vLLM server.
See `docs/paddle-ocr-vl-deploy.md` for deployment, and `PDF_INSPECTOR_ENABLED`/`PADDLE_VL_VLLM_*` in `.env`.
```

- [ ] **Step 3: Commit**

```bash
git add server/docs/paddle-ocr-vl-deploy.md server/README.md
git commit -m "docs: add self-hosted PaddleOCR-VL deployment guide"
```

---

## Self-Review Map (spec → tasks)

- pdf-inspector as classifier + native extractor, replacing PdfParser → Task B5 (+ B3 for classification).
- Text-based → skip OCR, index native markdown → Task B3 (`smartOcrPages == []`) + Task B4.
- Mixed/scanned → OCR only `pages_needing_ocr` → Task B3/B4.
- Per-page merge of native + OCR → Task B3 (`smartOcrPages`).
- `PaddleVLvLLMProvider` self-hosted vLLM → Task B2.
- Env: `OCR_PROVIDER`, `PADDLE_VL_VLLM_URL/MODEL/TIMEOUT`, `PDF_INSPECTOR_ENABLED` → Task B1.
- Deployment guide → Task B6.
- Fallbacks: pdf-inspector unavailable → legacy `needsOcr`/`ocrFile` (B4); provider down per page → empty page, log (B2); never crash pipeline (Global Constraints).
- All exceptions logged, camelCase naming, facade-only cross-module imports → every task.

## Composite End-to-End Verification (run after all tasks)

- [ ] Run full backend suite: `.venv\Scripts\python.exe -m pytest server\tests -v` → all green.
- [ ] Start vLLM server per `server/docs/paddle-ocr-vl-deploy.md` (if GPU available); otherwise confirm `PaddleVLvLLMProvider` degrades to empty pages + logs (no crash).
- [ ] Upload a scanned PDF and a text PDF; confirm:
  - text PDF → embeds without OCR (ocrStatus completed, isScanned false);
  - scanned/mixed PDF → `ocrFilePath` produced and embedding completes (or empty OCR pages logged when server down).
- [ ] Confirm both PDFs are searchable via RAG in the web UI.