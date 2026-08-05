// Named DocumentItem (not `Document`) to avoid colliding with the DOM lib's
// global `Document` type — most component files also reference the global
// `document` object, and a local `Document` interface shadows/conflicts with it.
export interface DocumentItem {
    id: string;
    filename: string;
    fileType?: string;
    fileSize?: number;
    embeddingStatus?: string;
    scope?: string;
    ownerId?: string;
    storedFilename?: string;
    chunkCount?: number;
    pageCount?: number;
    summary?: string;
    description?: string;
    tags?: string[];
    ocrStatus?: string | null;
    isScanned?: boolean;
    createdAt: string;
    updatedAt?: string;
}
