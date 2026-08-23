import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FiSearch, FiTrash2, FiPlus, FiEdit2, FiArrowLeft, FiDownload } from 'react-icons/fi';
import DocumentCard from './DocumentCard';
import FolderCard from './FolderCard';
import DocumentDetailModal from './DocumentDetailModal';
import OcrViewerModal from './OcrViewerModal';
import ConfirmDialog from '../ui/ConfirmDialog';
import Table, { TableCell } from '../ui/Table';
import Checkbox from '../ui/Checkbox';
import documentService from '../../services/documentService';
import folderService from '../../services/folderService';
import apiService from '../../services/apiService';
import type { DocumentItem } from '../../types';
import type { Folder } from '../../types/folder';
import gradientSpinner from '../../assets/svg/gradientSpinner.svg';

const POLL_INTERVAL_MS = 3000;
const PAGE_SIZE = 10;

function hasProcessingDocs(docs: DocumentItem[]): boolean {
    return docs.some(
        d => d.embeddingStatus === 'processing' || d.embeddingStatus === 'pending',
    );
}

type DeleteTarget =
    | { bulk?: false; id: string; filename: string }
    | { bulk: true; ids: string[]; count: number };

interface DocumentTableProps {
    refreshTrigger: number;
    folderId: string | null;
    onNavigateFolder: (folderId: string, name: string) => void;
    onGoBack?: () => void;
}

type FolderDeleteTarget = { id: string; name: string } | null;
type RenameTarget = { id: string; name: string } | null;

export default function DocumentTable({ refreshTrigger, folderId, onNavigateFolder, onGoBack }: DocumentTableProps) {
    const [folders, setFolders] = useState<Folder[]>([]);
    const [documents, setDocuments] = useState<DocumentItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null);
    const [ocrDoc, setOcrDoc] = useState<DocumentItem | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [folderName, setFolderName] = useState('');
    const [folderDeleting, setFolderDeleting] = useState(false);
    const [folderDeleteTarget, setFolderDeleteTarget] = useState<FolderDeleteTarget>(null);
    const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
    const [renameValue, setRenameValue] = useState('');
    const [error, setError] = useState('');
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const newFolderInputRef = useRef<HTMLInputElement>(null);

    const fetchContents = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const contents = await folderService.getFolderContents(folderId);
            setFolders(contents.folders);
            setDocuments(contents.documents);
        } catch (err) {
            console.error('fetchContents failed:', err);
        } finally {
            setLoading(false);
        }
    }, [folderId]);

    useEffect(() => {
        fetchContents(true);
    }, [fetchContents]);

    useEffect(() => {
        if (refreshTrigger > 0) fetchContents(false);
    }, [refreshTrigger, fetchContents]);

    useEffect(() => {
        const needsPolling = hasProcessingDocs(documents);
        if (needsPolling && !pollingRef.current) {
            pollingRef.current = setInterval(async () => {
                try {
                    const contents = await folderService.getFolderContents(folderId);
                    setFolders(contents.folders);
                    setDocuments(contents.documents);
                    if (!hasProcessingDocs(contents.documents) && pollingRef.current) {
                        clearInterval(pollingRef.current);
                        pollingRef.current = null;
                    }
                } catch (err) {
                    console.error('Polling failed:', err);
                }
            }, POLL_INTERVAL_MS);
        } else if (!needsPolling && pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
    }, [documents, folderId]);

    useEffect(() => {
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, []);

    const filteredDocs = useMemo(() => {
        if (!searchQuery.trim()) return documents;
        const q = searchQuery.toLowerCase();
        return documents.filter(doc =>
            doc.filename?.toLowerCase().includes(q) ||
            doc.fileType?.toLowerCase().includes(q)
        );
    }, [documents, searchQuery]);

    const filteredFolders = useMemo(() => {
        if (!searchQuery.trim()) return folders;
        const q = searchQuery.toLowerCase();
        return folders.filter(folder => folder.name?.toLowerCase().includes(q));
    }, [folders, searchQuery]);

    const combinedItems = useMemo(() => [...filteredFolders, ...filteredDocs], [filteredFolders, filteredDocs]);
    const totalPages = Math.max(1, Math.ceil(combinedItems.length / PAGE_SIZE));

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, folderId]);

    const paginatedItems = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return combinedItems.slice(start, start + PAGE_SIZE);
    }, [combinedItems, currentPage]);

    const paginatedDocs = useMemo(
        () => paginatedItems.filter((i): i is DocumentItem => 'filename' in i),
        [paginatedItems],
    );

    const allSelected = paginatedDocs.length > 0 && paginatedDocs.every(d => selectedIds.has(d.id));
    const someSelected = !allSelected && paginatedDocs.some(d => selectedIds.has(d.id));

    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(paginatedDocs.map(d => d.id)));
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
    const [bulkDeleting, setBulkDeleting] = useState(false);

    const handleDeleteRequest = useCallback((documentId: string) => {
        const doc = documents.find(d => d.id === documentId);
        setDeleteTarget({ id: documentId, filename: doc?.filename || 'this document' });
    }, [documents]);

    const handleBulkDeleteRequest = useCallback(() => {
        if (selectedIds.size === 0) return;
        setDeleteTarget({ bulk: true, ids: [...selectedIds], count: selectedIds.size });
    }, [selectedIds]);

    const handleBulkDownload = useCallback(() => {
        if (selectedIds.size === 0) return;
        const ids = [...selectedIds];
        ids.forEach(id => {
            const doc = documents.find(d => d.id === id);
            apiService.download(
                `/knowledge/documents/${id}/file`,
                doc?.filename || 'document',
            );
        });
    }, [selectedIds, documents]);

    const handleDeleteConfirm = useCallback(async () => {
        if (!deleteTarget) return;
        try {
            if (deleteTarget.bulk) {
                setBulkDeleting(true);
                const ids = deleteTarget.ids;
                await Promise.all(ids.map(id => documentService.deleteDocument(id)));
                setDocuments(prev => prev.filter(d => !ids.includes(d.id)));
                setSelectedIds(new Set());
            } else {
                await documentService.deleteDocument(deleteTarget.id);
                setDocuments(prev => prev.filter(d => d.id !== deleteTarget.id));
                setSelectedIds(prev => {
                    const next = new Set(prev);
                    next.delete(deleteTarget.id);
                    return next;
                });
            }
        } catch (err) {
            console.error('Delete failed:', err);
        } finally {
            setDeleteTarget(null);
            setBulkDeleting(false);
        }
    }, [deleteTarget]);

    const handleDeleteCancel = useCallback(() => {
        setDeleteTarget(null);
    }, []);

    const handleCreateFolderStart = () => {
        setCreatingFolder(true);
        setFolderName('');
        setError('');
        setTimeout(() => newFolderInputRef.current?.focus(), 0);
    };

    const handleCreateFolderSubmit = async () => {
        const name = folderName.trim();
        if (!name) {
            setCreatingFolder(false);
            return;
        }
        try {
            await folderService.createFolder(folderId, name);
            setFolderName('');
            setCreatingFolder(false);
            setError('');
            fetchContents(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create folder');
        }
    };

    const handleCreateFolderCancel = () => {
        setCreatingFolder(false);
        setError('');
    };

    const handleFolderDeleteRequest = (folder: Folder) => {
        setFolderDeleteTarget({ id: folder.id, name: folder.name });
    };

    const handleFolderDeleteConfirm = async () => {
        if (!folderDeleteTarget) return;
        try {
            setFolderDeleting(true);
            await folderService.deleteFolder(folderDeleteTarget.id);
            setFolders(prev => prev.filter(f => f.id !== folderDeleteTarget.id));
        } catch (err) {
            console.error('Delete folder failed:', err);
        } finally {
            setFolderDeleteTarget(null);
            setFolderDeleting(false);
        }
    };

    const handleRenameRequest = (folder: Folder) => {
        setRenameTarget({ id: folder.id, name: folder.name });
        setRenameValue(folder.name);
        setError('');
        setTimeout(() => newFolderInputRef.current?.focus(), 0);
    };

    const handleRenameSubmit = async () => {
        if (!renameTarget) return;
        const name = renameValue.trim();
        if (!name) {
            setRenameTarget(null);
            return;
        }
        try {
            await folderService.renameFolder(renameTarget.id, name);
            setFolders(prev => prev.map(f => f.id === renameTarget.id ? { ...f, name } : f));
            setRenameTarget(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to rename folder');
        }
    };

    const buildPageNumbers = (): (number | string)[] => {
        const pages: (number | string)[] = [];
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
            return pages;
        }
        pages.push(1);
        if (currentPage > 3) pages.push('...');
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (currentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
        return pages;
    };

    const hasSelection = selectedIds.size > 0;

    return (
        <>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    {folderId && onGoBack ? (
                        <button
                            onClick={onGoBack}
                            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
                            title="Go back"
                        >
                            <FiArrowLeft size={12} className="text-text-secondary" />
                        </button>
                    ) : (
                        <div aria-hidden className="w-9 h-9" />
                    )}
                    {!loading && filteredDocs.length > 0 && (
                        <div className="flex items-center h-9 border border-gray-300 bg-white rounded-lg overflow-hidden">
                            <label className="flex items-center gap-2 px-3 h-full cursor-pointer select-none">
                                <Checkbox
                                    checked={allSelected}
                                    indeterminate={someSelected}
                                    onChange={toggleSelectAll}
                                    uncheckedBgClassName="bg-white border-gray-400 hover:border-gray-600"
                                />
                                {hasSelection && (
                                    <span className="text-sm text-text-secondary whitespace-nowrap">{selectedIds.size}</span>
                                )}
                            </label>
                            <div className="w-px bg-gray-300 self-stretch" />
                            <button
                                onClick={handleBulkDownload}
                                disabled={!hasSelection}
                                className={`w-9 h-full px-2.5 flex items-center justify-center transition-colors ${hasSelection
                                    ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                                    : 'text-gray-400 cursor-not-allowed'
                                    }`}
                                title={hasSelection ? `Download ${selectedIds.size} selected` : 'Select items to download'}
                            >
                                <FiDownload size={12} />
                            </button>
                            <div className="w-px bg-gray-300 self-stretch" />
                            <button
                                onClick={handleBulkDeleteRequest}
                                disabled={!hasSelection || bulkDeleting}
                                className={`w-9 h-full px-2.5 flex items-center justify-center transition-colors ${hasSelection
                                    ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                                    : 'text-gray-400 cursor-not-allowed'
                                    }`}
                                title={hasSelection ? `Delete ${selectedIds.size} selected` : 'Select items to delete'}
                            >
                                <FiTrash2 size={12} />
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative group">
                        <FiSearch size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-gray-600" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search documents..."
                            className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:border-gray-600 transition-colors w-64"
                        />
                    </div>
                    <button
                        onClick={handleCreateFolderStart}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                    >
                        <FiPlus size={12} />
                        New
                    </button>
                </div>
            </div>
            {error && (
                <div className="mb-3 px-4 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
                    {error}
                </div>
            )}
            <div className="bg-white rounded-xl border border-border-color overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <div className="w-12 h-12">
                            <img src={gradientSpinner} alt="Loading" className="w-full h-full" />
                        </div>
                        <p className="text-sm text-text-secondary">Loading documents...</p>
                    </div>
                ) : combinedItems.length === 0 && !creatingFolder ? (
                    <div className="p-12 text-center text-sm text-text-secondary">
                        {searchQuery ? 'No items match your search.' : 'No folders or documents here yet.'}
                    </div>
                ) : (
                    <>
                        <Table headers={['', 'Name', 'Status', 'Uploaded', '']}>
                            {creatingFolder && (
                                <tr className="bg-gray-50">
                                    <TableCell colSpan={5}>
                                        <div className="flex items-center gap-2">
                                            <input
                                                ref={newFolderInputRef}
                                                type="text"
                                                value={folderName}
                                                onChange={e => setFolderName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') handleCreateFolderSubmit();
                                                    if (e.key === 'Escape') handleCreateFolderCancel();
                                                }}
                                                placeholder="Folder name"
                                                className="ml-10 w-[calc((100%-8.5rem)/3)] px-3 py-1.5 text-sm border border-primary rounded-md focus:outline-none shrink-0"
                                            />
                                            <button
                                                onClick={handleCreateFolderSubmit}
                                                className="ml-auto px-3 py-1.5 text-sm text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
                                            >
                                                Create
                                            </button>
                                            <button
                                                onClick={handleCreateFolderCancel}
                                                className="px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100 rounded-lg transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </TableCell>
                                </tr>
                            )}
                            {renameTarget && paginatedItems.filter(i => i.id === renameTarget.id).length === 0 && (
                                <tr className="bg-gray-50">
                                    <TableCell colSpan={5}>
                                        <div className="flex items-center gap-2">
                                            <input
                                                ref={newFolderInputRef}
                                                type="text"
                                                value={renameValue}
                                                onChange={e => setRenameValue(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') handleRenameSubmit();
                                                    if (e.key === 'Escape') setRenameTarget(null);
                                                }}
                                                className="ml-3 w-[calc((100%-8.5rem)/3)] px-3 py-1.5 text-sm border border-primary rounded-lg focus:outline-none shrink-0"
                                            />
                                            <button
                                                onClick={handleRenameSubmit}
                                                className="ml-auto px-3 py-1.5 text-sm text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
                                            >
                                                Save
                                            </button>
                                            <button
                                                onClick={() => setRenameTarget(null)}
                                                className="px-3 py-1.5 text-sm text-text-secondary  hover:bg-gray-200 rounded-lg transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </TableCell>
                                </tr>
                            )}
                            {paginatedItems.map(item => {
                                if ('filename' in item) {
                                    return (
                                        <DocumentCard
                                            key={item.id}
                                            document={item}
                                            selected={selectedIds.has(item.id)}
                                            onToggleSelect={() => toggleSelect(item.id)}
                                            onView={setSelectedDoc}
                                            onDelete={handleDeleteRequest}
                                            onViewOcr={setOcrDoc}
                                        />
                                    );
                                }
                                return renameTarget?.id === item.id ? (
                                    <tr key={item.id} className="bg-gray-50">
                                        <TableCell colSpan={5}>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    ref={newFolderInputRef}
                                                    type="text"
                                                    value={renameValue}
                                                    onChange={e => setRenameValue(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleRenameSubmit();
                                                        if (e.key === 'Escape') setRenameTarget(null);
                                                    }}
                                                    className="ml-3 w-[calc((100%-8.5rem)/3)] px-3 py-1.5 text-sm border border-primary rounded-lg focus:outline-none shrink-0"
                                                />
                                                <button
                                                    onClick={handleRenameSubmit}
                                                    className="ml-auto px-3 py-1.5 text-sm text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    onClick={() => setRenameTarget(null)}
                                                    className="px-3 py-1.5 text-sm text-text-secondary  hover:bg-gray-200 rounded-lg transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </TableCell>
                                    </tr>
                                ) : (
                                    <FolderCard
                                        key={item.id}
                                        folder={item}
                                        onOpen={() => onNavigateFolder(item.id, item.name)}
                                        onRename={() => handleRenameRequest(item)}
                                        onDelete={() => handleFolderDeleteRequest(item)}
                                    />
                                );
                            })}
                        </Table>

                        {totalPages > 1 && (
                            <div className="px-6 py-4 border-t border-border-color flex items-center justify-center gap-1">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    &lt;
                                </button>
                                {buildPageNumbers().map((page, i) =>
                                    page === '...' ? (
                                        <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-sm text-text-muted">...</span>
                                    ) : (
                                        <button
                                            key={page}
                                            onClick={() => setCurrentPage(page as number)}
                                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${currentPage === page
                                                ? 'bg-primary text-white font-medium'
                                                : 'hover:bg-gray-100 text-text-secondary'
                                                }`}
                                        >
                                            {page}
                                        </button>
                                    )
                                )}
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    &gt;
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {selectedDoc && (
                <DocumentDetailModal
                    document={selectedDoc}
                    onClose={() => setSelectedDoc(null)}
                />
            )}

            {ocrDoc && (
                <OcrViewerModal
                    document={ocrDoc}
                    onClose={() => setOcrDoc(null)}
                />
            )}

            <ConfirmDialog
                open={!!folderDeleteTarget}
                title="Delete folder?"
                description={
                    folderDeleteTarget
                        ? `"${folderDeleteTarget.name}" and everything inside it will be permanently deleted. This action cannot be undone.`
                        : ''
                }
                confirmLabel={folderDeleting ? 'Deleting...' : 'Delete'}
                cancelLabel="Cancel"
                onConfirm={handleFolderDeleteConfirm}
                onCancel={() => setFolderDeleteTarget(null)}
            />

            <ConfirmDialog
                open={!!deleteTarget}
                title={deleteTarget?.bulk ? `Delete ${deleteTarget.count} documents?` : 'Delete document?'}
                description={
                    deleteTarget?.bulk
                        ? `${deleteTarget.count} documents will be permanently deleted. This action cannot be undone.`
                        : deleteTarget
                            ? `"${deleteTarget.filename}" will be permanently deleted. This action cannot be undone.`
                            : ''
                }
                confirmLabel={bulkDeleting ? 'Deleting...' : 'Delete'}
                cancelLabel="Cancel"
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
            />
        </>
    );
}
