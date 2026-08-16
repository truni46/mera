# server/modules/folders/service.py
from typing import Dict, List, Optional

from config.logger import logger
from modules.folders.repository import folderRepository
from modules.knowledge.service import documentService


class FolderService:

    async def createFolder(self, userId: str, name: str, parentId: Optional[str] = None) -> Dict:
        folderName = name.strip()
        if not folderName:
            raise ValueError("Folder name cannot be empty")
        if parentId:
            parent = await folderRepository.getById(parentId)
            if not parent or str(parent.get("userId")) != str(userId):
                raise ValueError("Parent folder not found")
        siblings = await folderRepository.getByParent(userId, parentId)
        if any(str(f.get("name", "")).lower() == folderName.lower() for f in siblings):
            raise ValueError("A folder with this name already exists")
        return await folderRepository.create(userId, folderName, parentId)

    async def getFolderById(self, folderId: str, userId: str) -> Optional[Dict]:
        folder = await folderRepository.getById(folderId)
        if not folder or str(folder.get("userId")) != str(userId):
            return None
        return folder

    async def getContents(self, userId: str, parentId: Optional[str] = None) -> Dict:
        folders = await folderRepository.getByParent(userId, parentId)
        documents = await documentService.getDocuments(userId=userId, parentId=parentId)
        return {"folders": folders, "documents": documents}

    async def renameFolder(self, folderId: str, userId: str, name: str) -> Optional[Dict]:
        folderName = name.strip()
        if not folderName:
            raise ValueError("Folder name cannot be empty")
        folder = await folderRepository.getById(folderId)
        if not folder or str(folder.get("userId")) != str(userId):
            return None
        siblings = await folderRepository.getByParent(userId, folder.get("parentId"))
        if any(
            str(f.get("id")) != str(folderId) and str(f.get("name", "")).lower() == folderName.lower()
            for f in siblings
        ):
            raise ValueError("A folder with this name already exists")
        return await folderRepository.rename(folderId, userId, folderName)

    async def deleteFolder(self, userId: str, folderId: str) -> bool:
        folder = await folderRepository.getById(folderId)
        if not folder or str(folder.get("userId")) != str(userId):
            return False
        allIds = await folderRepository.getAllDescendants(folderId, userId)
        deleted = 0
        for childId in allIds:
            docs = await documentService.getDocuments(userId=userId, parentId=childId)
            for doc in docs:
                try:
                    if await documentService.deleteDocument(userId, doc["id"]):
                        deleted += 1
                except Exception as e:
                    logger.error(f"deleteFolder failed deleting document {doc['id']}: {e}")
        await folderRepository.deleteMany(allIds, userId)
        logger.info(f"deleteFolder folderId={folderId} userId={userId} folders={len(allIds)} documents={deleted}")
        return True


folderService = FolderService()