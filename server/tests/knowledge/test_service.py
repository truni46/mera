# server/tests/knowledge/test_service.py
import hashlib
import pytest


def test_computeHash_returns_sha256_hex():
    from modules.knowledge.service import _computeHash
    content = b"hello world"
    expected = hashlib.sha256(content).hexdigest()
    assert _computeHash(content) == expected


def test_computeHash_different_content_gives_different_hash():
    from modules.knowledge.service import _computeHash
    assert _computeHash(b"aaa") != _computeHash(b"bbb")


def test_computeHash_empty_bytes():
    from modules.knowledge.service import _computeHash
    result = _computeHash(b"")
    assert len(result) == 64


def test_computeHash_same_content_gives_same_hash():
    from modules.knowledge.service import _computeHash
    assert _computeHash(b"test") == _computeHash(b"test")


def test_chunkCount_not_hardcoded():
    import inspect
    from modules.knowledge import service as svc
    source = inspect.getsource(svc.DocumentService._processDocument)
    assert "chunkCount=1" not in source, "chunkCount must not be hardcoded to 1"


def test_searchDocumentContext_returns_tuple():
    import asyncio
    from unittest.mock import AsyncMock, patch
    from modules.knowledge.service import documentService

    mockDoc = {
        "id": "doc1",
        "userId": "user1",
        "ownerId": "user1",
        "filename": "test.pdf",
        "filePath": "/fake/path.pdf",
    }

    with patch("modules.knowledge.service.documentRepository.getById", new=AsyncMock(return_value=mockDoc)), \
         patch("modules.knowledge.service.ragService.searchContextByDocumentIds", new=AsyncMock(return_value=[])), \
         patch("modules.knowledge.service.documentService.getDocument", new=AsyncMock(return_value=mockDoc)), \
         patch("modules.knowledge.service._readTextContent", return_value="some text"):
        result = asyncio.get_event_loop().run_until_complete(
            documentService.searchDocumentContext(["doc1"], "user1", "query")
        )

    contextText, sources = result
    assert isinstance(contextText, str)
    assert isinstance(sources, list)


def test_searchDocumentContext_uses_vector_when_score_high():
    import asyncio
    from unittest.mock import AsyncMock, patch, MagicMock
    from modules.knowledge.service import documentService
    from modules.rag.repository import SearchResult, Document

    mockDoc = {
        "id": "doc1",
        "userId": "user1",
        "ownerId": "user1",
        "filename": "test.pdf",
        "filePath": "/fake/path.pdf",
    }
    mockResult = SearchResult(
        document=Document(
            id="doc1",
            content="chunk text",
            metadata={"filename": "test.pdf", "pageNumber": 2},
        ),
        score=0.9,
    )

    with patch("modules.knowledge.service.documentRepository.getById", new=AsyncMock(return_value=mockDoc)), \
         patch("modules.knowledge.service.ragService.searchContextByDocumentIds", new=AsyncMock(return_value=[mockResult])):
        contextText, sources = asyncio.get_event_loop().run_until_complete(
            documentService.searchDocumentContext(["doc1"], "user1", "query")
        )

    assert "chunk text" in contextText
    assert sources[0]["filename"] == "test.pdf"
    assert sources[0]["pageNumber"] == 2


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
