def test_processDocument_legacy_doc_conversion_keeps_docx(monkeypatch, tmp_path):
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService

    docPath = tmp_path / "old.doc"
    docxPath = tmp_path / "old.docx"
    docPath.write_bytes(b"% old doc")
    docxPath.write_bytes(b"converted")

    monkeypatch.setattr("modules.knowledge.service.isR2Key", lambda _: False)
    monkeypatch.setattr("modules.knowledge.service._convertDocToDocx", lambda p: str(docxPath))
    monkeypatch.setattr("modules.knowledge.service.asyncio.create_task", lambda coro, **kw: None)

    with patch("modules.knowledge.service.documentRepository.updateEmbedding", new=AsyncMock()), \
         patch("modules.knowledge.service.documentRepository.updateFilePath", new=AsyncMock()) as mockUpdatePath, \
         patch("modules.knowledge.service.documentRepository.updateOcr", new=AsyncMock()), \
         patch("modules.knowledge.service.needsOcr", return_value=False), \
         patch("modules.knowledge.service.ragService.index", new=AsyncMock(return_value=5)), \
         patch("modules.knowledge.service._extractPageCount", return_value=1):
        asyncio.get_event_loop().run_until_complete(
            documentService._processDocument("doc1", str(docPath), "user1", "user1", "old.doc")
        )

    assert mockUpdatePath.await_args.args[1] == str(docxPath)
    assert docxPath.exists(), "legacy converted docx must survive on disk"


def test_processDocument_r2_ocr_failure_keeps_embedding_status(monkeypatch, tmp_path):
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService

    pdfPath = tmp_path / "a.pdf"
    pdfPath.write_bytes(b"%PDF-1.7 fake")

    async def fakeDownloadToTemp(key):
        return str(pdfPath)

    monkeypatch.setattr("modules.knowledge.service.isR2Key", lambda _: True)
    monkeypatch.setattr("modules.knowledge.service.r2Storage.downloadToTemp", fakeDownloadToTemp)
    monkeypatch.setattr("modules.knowledge.service.r2Storage.uploadBytes", AsyncMock(return_value="x"))
    monkeypatch.setattr("modules.knowledge.service.asyncio.create_task", lambda coro, **kw: None)

    with patch("modules.knowledge.service.documentRepository.updateEmbedding", new=AsyncMock()) as mockEmbed, \
         patch("modules.knowledge.service.documentRepository.updateOcr", new=AsyncMock()), \
         patch("modules.knowledge.service.needsOcr", return_value=True), \
         patch("modules.knowledge.service.ocrService.ocrFile", side_effect=RuntimeError("ocr boom")), \
         patch("modules.knowledge.service.ragService.index", new=AsyncMock(return_value=7)), \
         patch("modules.knowledge.service._extractPageCount", return_value=2):
        asyncio.get_event_loop().run_until_complete(
            documentService._processDocument("doc1", "documents/doc1/a.pdf", "user1", "user1", "a.pdf")
        )

    statuses = [c.args[1] for c in mockEmbed.await_args_list if c.args]
    assert statuses and statuses[-1] == "completed", f"embedding flipped to failed after OCR error: {statuses}"


def test_readTextFromStorage_r2_pdf_parses_via_temp(monkeypatch, tmp_path):
    import asyncio
    from unittest.mock import MagicMock
    from modules.knowledge.service import documentService

    pdfPath = tmp_path / "a.pdf"
    pdfPath.write_bytes(b"%PDF-1.7 fake")

    async def fakeDownloadToTemp(key):
        return str(pdfPath)

    monkeypatch.setattr("modules.knowledge.service.isR2Key", lambda _: True)
    monkeypatch.setattr("modules.knowledge.service.r2Storage.downloadToTemp", fakeDownloadToTemp)
    monkeypatch.setattr("modules.knowledge.service.r2Storage.readText", MagicMock(side_effect=AssertionError("readText must not be used for binary R2 objects")))
    monkeypatch.setattr("modules.knowledge.service._readTextContent", lambda p, maxChars=4000: "parsed-from-temp")

    text = asyncio.get_event_loop().run_until_complete(
        documentService._readTextFromStorage("documents/doc1/a.pdf", 8000)
    )
    assert text == "parsed-from-temp"