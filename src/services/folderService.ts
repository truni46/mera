import apiService from './apiService';
import type { Folder, FolderContents } from '../types/folder';

class FolderService {
    async createFolder(parentId: string | null, name: string): Promise<Folder> {
        return apiService.post<Folder>('/folders', { parentId, name });
    }

    async getFolderContents(parentId: string | null): Promise<FolderContents> {
        const suffix = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
        return apiService.get<FolderContents>(`/folders/contents${suffix}`);
    }

    async renameFolder(folderId: string, name: string): Promise<Folder> {
        return apiService.patch<Folder>(`/folders/${folderId}`, { name });
    }

    async deleteFolder(folderId: string): Promise<void> {
        return apiService.delete(`/folders/${folderId}`);
    }
}

export default new FolderService();