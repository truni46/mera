# server/modules/folders/router.py
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from common.deps import getCurrentUser
from config.logger import logger
from modules.folders.service import folderService

router = APIRouter(prefix="/folders", tags=["folders"])


@router.post("")
async def createFolder(
    payload: dict,
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        userId = str(currentUser["id"])
        return await folderService.createFolder(
            userId=userId,
            name=payload.get("name", ""),
            parentId=payload.get("parentId"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"POST /folders failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/contents")
async def getFolderContents(
    parentId: Optional[str] = Query(default=None),
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        userId = str(currentUser["id"])
        if parentId:
            folder = await folderService.getFolderById(parentId, userId)
            if not folder:
                raise HTTPException(status_code=404, detail="Folder not found")
        return await folderService.getContents(userId, parentId)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"GET /folders/contents failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{folderId}")
async def renameFolder(
    folderId: str,
    payload: dict,
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        userId = str(currentUser["id"])
        folder = await folderService.renameFolder(
            userId=userId,
            folderId=folderId,
            name=payload.get("name", ""),
        )
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        return folder
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PATCH /folders/{folderId} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{folderId}")
async def deleteFolder(
    folderId: str,
    currentUser: dict = Depends(getCurrentUser),
):
    try:
        success = await folderService.deleteFolder(
            userId=str(currentUser["id"]),
            folderId=folderId,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Folder not found")
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DELETE /folders/{folderId} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
