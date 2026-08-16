import type { DocumentItem } from './document';

export interface Folder {
    id: string;
    userId?: string;
    parentId?: string | null;
    name: string;
    createdAt: string;
    updatedAt?: string;
}

export interface FolderContents {
    folders: Folder[];
    documents: DocumentItem[];
}