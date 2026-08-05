import apiService from './apiService';
import type { DocumentItem } from '../types';

type ProgressCallback = (percent: number) => void;
type XhrCallback = (xhr: XMLHttpRequest) => void;

interface ApiError extends Error {
    status?: number;
}

interface OcrTextResponse {
    text?: string;
}

class DocumentService {
    uploadDocuments(
        files: File[],
        onProgress?: ProgressCallback,
        scope = 'personal',
        onXhr?: XhrCallback
    ): Promise<DocumentItem[]> {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            files.forEach(file => formData.append('files', file));

            const xhr = new XMLHttpRequest();
            const token = localStorage.getItem('accessToken');

            if (onXhr) onXhr(xhr);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && onProgress) {
                    onProgress(Math.round((event.loaded / event.total) * 100));
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch {
                        resolve([]);
                    }
                } else {
                    reject(new Error(xhr.responseText || 'Upload failed'));
                }
            };

            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.onabort = () => reject(new Error('Upload aborted'));

            const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
            xhr.open('POST', `${baseUrl}/knowledge/documents/upload?scope=${scope}`);
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);
        });
    }

    async getDocuments(scope: string | null = null): Promise<DocumentItem[]> {
        const params = scope ? `?scope=${scope}` : '';
        return apiService.get<DocumentItem[]>(`/knowledge/documents${params}`);
    }

    async getDocument(documentId: string): Promise<DocumentItem> {
        return apiService.get<DocumentItem>(`/knowledge/documents/${documentId}`);
    }

    async getDocumentFileUrl(documentId: string): Promise<string> {
        const token = localStorage.getItem('accessToken');
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
        const response = await fetch(
            `${baseUrl}/knowledge/documents/${documentId}/file`,
            { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (response.status === 404) {
            const err: ApiError = new Error('Document not found');
            err.status = 404;
            throw err;
        }
        if (!response.ok) throw new Error('Failed to fetch file');
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    }

    async getDocumentOcrText(documentId: string): Promise<OcrTextResponse> {
        return apiService.get<OcrTextResponse>(`/knowledge/documents/${documentId}/ocr`);
    }

    async deleteDocument(documentId: string): Promise<void> {
        return apiService.delete(`/knowledge/documents/${documentId}`);
    }
}

export default new DocumentService();
