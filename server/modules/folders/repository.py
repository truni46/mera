# server/modules/folders/repository.py
from typing import Dict, List, Optional
import uuid
from datetime import datetime, timezone

from config.database import db


class FolderRepository:

    async def create(self, userId: str, name: str, parentId: Optional[str] = None) -> Dict:
        folderId = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        record = {
            "id": folderId,
            "userId": userId,
            "parentId": parentId,
            "name": name,
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
        }
        if db.useDatabase and db.pool:
            async with db.pool.acquire() as conn:
                row = await conn.fetchrow(
                    """INSERT INTO folders (id, "userId", "parentId", name, "createdAt", "updatedAt")
                       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
                    folderId, userId, parentId, name, now, now,
                )
                return dict(row)
        else:
            data = db.read_json("folders")
            data[folderId] = record
            db.write_json("folders", data)
            return record

    async def getById(self, folderId: str) -> Optional[Dict]:
        if db.useDatabase and db.pool:
            async with db.pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT * FROM folders WHERE id = $1", folderId
                )
                return dict(row) if row else None
        else:
            data = db.read_json("folders")
            return data.get(folderId)

    async def getByParent(self, userId: str, parentId: Optional[str] = None) -> List[Dict]:
        if db.useDatabase and db.pool:
            async with db.pool.acquire() as conn:
                if parentId is None:
                    rows = await conn.fetch(
                        """SELECT * FROM folders
                           WHERE "userId" = $1 AND "parentId" IS NULL
                           ORDER BY "createdAt" DESC""",
                        userId,
                    )
                else:
                    rows = await conn.fetch(
                        """SELECT * FROM folders
                           WHERE "userId" = $1 AND "parentId" = $2
                           ORDER BY "createdAt" DESC""",
                        userId, parentId,
                    )
                return [dict(r) for r in rows]
        else:
            data = db.read_json("folders")
            folders = [f for f in data.values() if str(f.get("userId")) == str(userId)]
            if parentId is None:
                folders = [f for f in folders if not f.get("parentId")]
            else:
                folders = [f for f in folders if str(f.get("parentId")) == str(parentId)]
            folders.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
            return folders

    async def getAllDescendants(self, folderId: str, userId: str) -> List[str]:
        """Return all descendant folder ids (including folderId itself)."""
        result: List[str] = [folderId]
        frontier = [folderId]
        if db.useDatabase and db.pool:
            async with db.pool.acquire() as conn:
                while frontier:
                    rows = await conn.fetch(
                        """SELECT id FROM folders
                           WHERE "userId" = $1 AND "parentId" = ANY($2::uuid[])""",
                        userId, frontier,
                    )
                    frontier = [str(r["id"]) for r in rows]
                    result.extend(frontier)
        else:
            data = db.read_json("folders")
            while frontier:
                children = [
                    str(f["id"]) for f in data.values()
                    if str(f.get("userId")) == str(userId) and str(f.get("parentId")) in frontier
                ]
                frontier = children
                result.extend(children)
        return result

    async def rename(self, folderId: str, userId: str, name: str) -> Optional[Dict]:
        now = datetime.now(timezone.utc)
        if db.useDatabase and db.pool:
            async with db.pool.acquire() as conn:
                row = await conn.fetchrow(
                    """UPDATE folders SET name = $3, "updatedAt" = $4
                       WHERE id = $1 AND "userId" = $2 RETURNING *""",
                    folderId, userId, name, now,
                )
                return dict(row) if row else None
        else:
            data = db.read_json("folders")
            folder = data.get(folderId)
            if not folder or str(folder.get("userId")) != str(userId):
                return None
            folder["name"] = name
            folder["updatedAt"] = now.isoformat()
            db.write_json("folders", data)
            return folder

    async def deleteMany(self, folderIds: List[str], userId: str) -> None:
        if not folderIds:
            return
        if db.useDatabase and db.pool:
            async with db.pool.acquire() as conn:
                await conn.execute(
                    """DELETE FROM folders WHERE id = ANY($1::uuid[]) AND "userId" = $2""",
                    folderIds, userId,
                )
        else:
            data = db.read_json("folders")
            for folderId in folderIds:
                if folderId in data:
                    del data[folderId]
            db.write_json("folders", data)

    async def delete(self, folderId: str, userId: str) -> bool:
        if db.useDatabase and db.pool:
            async with db.pool.acquire() as conn:
                row = await conn.fetchrow(
                    """SELECT id FROM folders WHERE id = $1 AND "userId" = $2""",
                    folderId, userId,
                )
                if not row:
                    return False
                await conn.execute(
                    """DELETE FROM folders WHERE id = $1 AND "userId" = $2""",
                    folderId, userId,
                )
                return True
        else:
            data = db.read_json("folders")
            folder = data.get(folderId)
            if not folder or str(folder.get("userId")) != str(userId):
                return False
            del data[folderId]
            db.write_json("folders", data)
            return True


folderRepository = FolderRepository()
