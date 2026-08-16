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