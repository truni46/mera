# server/modules/knowledge/router.py
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from common.deps import getCurrentUser
from config.logger import logger
from modules.knowledge.service import documentService
from modules.folders.service import folderService
from modules.storage.r2Storage import r2Storage, isR2Key

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _removeTempFile(path: str) -> None:
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError as e:
        logger.warning(f"_removeTempFile failed for {path}: {e}")


@router.post("/documents/upload")
async def uploadDocuments(
    files: List[UploadFile] = File(...),
    scope: str = Query(default="personal"),
    ownerId: Optional[str] = Query(default=None),
    ownerType: str = Query(default="user"),
    parentId: Optional[str] = Query(default=None),
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        userId = str(currentUser["id"])
        if parentId:
            folder = await folderService.getFolderById(parentId, userId)
            if not folder:
                raise HTTPException(status_code=404, detail="Folder not found")
        results = await documentService.uploadDocuments(
            userId=userId,
            files=files,
            scope=scope,
            ownerId=ownerId or userId,
            ownerType=ownerType,
            parentId=parentId,
        )
        return results
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"POST /knowledge/documents/upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documents")
async def getDocuments(
    scope: Optional[str] = Query(default=None),
    parentId: Optional[str] = Query(default=None),
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        userId = str(currentUser["id"])
        if parentId:
            folder = await folderService.getFolderById(parentId, userId)
            if not folder:
                raise HTTPException(status_code=404, detail="Folder not found")
        return await documentService.getDocuments(
            userId=userId, scope=scope, parentId=parentId
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"GET /knowledge/documents failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documents/{documentId}/file")
async def serveDocumentFile(
    documentId: str,
    currentUser: dict = Depends(getCurrentUser),
):
    MIME_TYPES = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
        "txt": "text/plain",
        "md": "text/markdown",
        "csv": "text/csv",
        "tsv": "text/tab-separated-values",
    }
    try:
        doc = await documentService.getDocument(documentId, str(currentUser["id"]))
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"GET /knowledge/documents/{documentId}/file failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documents/{documentId}/ocr")
async def getDocumentOcrText(
    documentId: str,
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        doc = await documentService.getDocument(documentId, str(currentUser["id"]))
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
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
        return {
            "documentId": documentId,
            "text": text,
            "ocrStatus": doc.get("ocrStatus"),
            "isScanned": doc.get("isScanned"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"GET /knowledge/documents/{documentId}/ocr failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documents/{documentId}")
async def getDocument(
    documentId: str,
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        doc = await documentService.getDocument(documentId, str(currentUser["id"]))
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        return doc
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"GET /knowledge/documents/{documentId} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/documents/{documentId}/retry")
async def retryDocument(
    documentId: str,
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        doc = await documentService.retryDocument(documentId, str(currentUser["id"]))
        return doc
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"POST /knowledge/documents/{documentId}/retry failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/documents/{documentId}")
async def deleteDocument(
    documentId: str,
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        success = await documentService.deleteDocument(
            userId=str(currentUser["id"]),
            documentId=documentId,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Document not found")
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DELETE /knowledge/documents/{documentId} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/documents/{documentId}")
async def updateDocument(
    documentId: str,
    payload: dict,
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        doc = await documentService.updateDocument(documentId, str(currentUser["id"]), payload)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        return doc
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PATCH /knowledge/documents/{documentId} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
