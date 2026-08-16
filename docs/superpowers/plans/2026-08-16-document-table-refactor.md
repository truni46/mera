# DocumentTable Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `DocumentTable.tsx` (541 lines) into focused hooks/components so each unit has one clear responsibility.

**Architecture:** Extract data-fetching+polling into a `useDocumentContents` hook; extract the toolbar, folder inline forms, and delete dialogs into standalone components. `DocumentTable` keeps selection/pagination/row-rendering state and orchestrates the pieces.

**Tech Stack:** React 18 + TypeScript + Vite, react-icons (fi/hi2), Tailwind CSS classes from existing components.

## Global Constraints

- No test runner exists for the frontend (no vitest/jest). Verification = `npm run typecheck` then `npm run build` from project root `E:\Project\mera`.
- Do NOT modify `DocumentsPage.tsx`, `DocumentUploadZone.tsx`, `FolderCard.tsx`, `DocumentCard.tsx`, `Breadcrumb.tsx`, `DocumentDetailModal.tsx`, `OcrViewerModal.tsx`, `Table`, `Checkbox`, `ConfirmDialog`.
- Preserve the public contract of `DocumentTable` exactly: props `{ refreshTrigger: number; folderId: string | null; onNavigateFolder: (folderId: string, name: string) => void }` and identical behavior to the original 541-line version.
- All frontend functions/variables in camelCase; components PascalCase; file names PascalCase (e.g. `DocumentToolbar.tsx`).
- No comments unless code is not self-explanatory. Match existing formatting (4-space indent, single quotes, semicolons).

---

### Task 1: `useDocumentContents` hook

**Files:**
- Create: `src/components/document/useDocumentContents.ts`

**Interfaces:**
- Consumes: `folderService.getFolderContents(parentId) -> Promise<FolderContents>` from `src/services/folderService.ts`.
- Produces:
  ```ts
  export default function useDocumentContents(folderId: string | null, refreshTrigger: number): {
      folders: Folder[];
      documents: DocumentItem[];
      loading: boolean;
      refresh: (showLoading?: boolean) => Promise<void>;
  }
  ```

- [ ] **Step 1: Create `src/components/document/useDocumentContents.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import folderService from '../../services/folderService';
import type { DocumentItem } from '../../types';
import type { Folder } from '../../types/folder';

const POLL_INTERVAL_MS = 3000;

function hasProcessingDocs(docs: DocumentItem[]): boolean {
    return docs.some(
        d => d.embeddingStatus === 'processing' || d.embeddingStatus === 'pending',
    );
}

export default function useDocumentContents(folderId: string | null, refreshTrigger: number) {
    const [folders, setFolders] = useState<Folder[]>([]);
    const [documents, setDocuments] = useState<DocumentItem[]>([]);
    const [loading, setLoading] = useState(true);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    return { folders, documents, loading, refresh: fetchContents };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/components/document/useDocumentContents.ts
git commit -m "refactor: extract useDocumentContents hook from DocumentTable"
```

---

### Task 2: `DocumentToolbar` component

**Files:**
- Create: `src/components/document/DocumentToolbar.tsx`

**Interfaces:**
- Consumes (as props, all passed from `DocumentTable`):
  ```ts
  interface DocumentToolbarProps {
      searchQuery: string;
      onSearchChange: (value: string) => void;
      showSelection: boolean;          // !loading && filteredDocs.length > 0
      allSelected: boolean;
      someSelected: boolean;
      hasSelection: boolean;           // selectedIds.size > 0
      selectedCount: number;           // selectedIds.size
      bulkDeleting: boolean;
      onToggleSelectAll: () => void;
      onBulkDelete: () => void;
      onCreateFolder: () => void;
  }
  ```
- Produces: default-exported component rendering the toolbar. No state lives here.

- [ ] **Step 1: Create `src/components/document/DocumentToolbar.tsx`**

```tsx
import { FiSearch, FiTrash2, FiPlus } from 'react-icons/fi';
import Checkbox from '../ui/Checkbox';

interface DocumentToolbarProps {
    searchQuery: string;
    onSearchChange: (value: string) => void;
    showSelection: boolean;
    allSelected: boolean;
    someSelected: boolean;
    hasSelection: boolean;
    selectedCount: number;
    bulkDeleting: boolean;
    onToggleSelectAll: () => void;
    onBulkDelete: () => void;
    onCreateFolder: () => void;
}

export default function DocumentToolbar({
    searchQuery,
    onSearchChange,
    showSelection,
    allSelected,
    someSelected,
    hasSelection,
    selectedCount,
    bulkDeleting,
    onToggleSelectAll,
    onBulkDelete,
    onCreateFolder,
}: DocumentToolbarProps) {
    return (
        <div className="flex items-center justify-between mb-3">
            <div className="relative group">
                <FiSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-gray-600" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    placeholder="Search documents..."
                    className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:bg-white focus:outline-none focus:border-gray-600 transition-colors w-64"
                />
            </div>
            <div className="flex items-center gap-2">
                {showSelection && (
                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={allSelected}
                            indeterminate={someSelected}
                            onChange={onToggleSelectAll}
                        />
                        {hasSelection && (
                            <span className="text-sm text-text-secondary">({selectedCount})</span>
                        )}
                        <button
                            onClick={onBulkDelete}
                            disabled={!hasSelection || bulkDeleting}
                            className={`p-1.5 rounded-md transition-colors ${hasSelection
                                ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                : 'text-gray-300 cursor-not-allowed'
                                }`}
                            title={hasSelection ? `Delete ${selectedCount} selected` : 'Select items to delete'}
                        >
                            <FiTrash2 size={16} />
                        </button>
                    </div>
                )}
                <button
                    onClick={onCreateFolder}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                >
                    <FiPlus size={15} />
                    New
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (component not yet imported by `DocumentTable`)

- [ ] **Step 3: Commit**

```bash
git add src/components/document/DocumentToolbar.tsx
git commit -m "refactor: extract DocumentToolbar component from DocumentTable"
```

---

### Task 3: `NewFolderForm` + `RenameFolderForm` components

**Files:**
- Create: `src/components/document/NewFolderForm.tsx`
- Create: `src/components/document/RenameFolderForm.tsx`

**Interfaces:**
- Both render the inline `<tr>` rows currently embedded directly in `DocumentTable.tsx`.
- `NewFolderForm` props:
  ```ts
  interface NewFolderFormProps {
      inputRef: React.RefObject<HTMLInputElement | null>;
      folderName: string;
      onFolderNameChange: (value: string) => void;
      onCreate: () => void;
      onCancel: () => void;
  }
  ```
- `RenameFolderForm` props:
  ```ts
  interface RenameFolderFormProps {
      inputRef: React.RefObject<HTMLInputElement | null>;
      renameValue: string;
      onRenameValueChange: (value: string) => void;
      onSave: () => void;
      onCancel: () => void;
  }
  ```
- Produces: default-exported components rendering the inline text-input rows (must be identical markup to the originals).

- [ ] **Step 1: Create `src/components/document/NewFolderForm.tsx`**

```tsx
import { FiPlus } from 'react-icons/fi';

interface NewFolderFormProps {
    inputRef: React.RefObject<HTMLInputElement | null>;
    folderName: string;
    onFolderNameChange: (value: string) => void;
    onCreate: () => void;
    onCancel: () => void;
}

export default function NewFolderForm({
    inputRef,
    folderName,
    onFolderNameChange,
    onCreate,
    onCancel,
}: NewFolderFormProps) {
    return (
        <tr className="bg-primary-light/40">
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center justify-center">
                    <FiPlus size={16} className="text-primary" />
                </div>
            </td>
            <td className="px-6 py-4">
                <input
                    ref={inputRef}
                    type="text"
                    value={folderName}
                    onChange={e => onFolderNameChange(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') onCreate();
                        if (e.key === 'Escape') onCancel();
                    }}
                    placeholder="Folder name"
                    className="w-full max-w-sm px-3 py-1.5 text-sm border border-primary rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </td>
            <td className="px-6 py-4" />
            <td className="px-6 py-4" />
            <td className="px-6 py-4 whitespace-nowrap text-right">
                <button
                    onClick={onCreate}
                    className="px-3 py-1.5 text-sm text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors mr-2"
                >
                    Create
                </button>
                <button
                    onClick={onCancel}
                    className="px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100 rounded-lg transition-colors"
                >
                    Cancel
                </button>
            </td>
        </tr>
    );
}
```

- [ ] **Step 2: Create `src/components/document/RenameFolderForm.tsx`**

```tsx
import { FiEdit2 } from 'react-icons/fi';

interface RenameFolderFormProps {
    inputRef: React.RefObject<HTMLInputElement | null>;
    renameValue: string;
    onRenameValueChange: (value: string) => void;
    onSave: () => void;
    onCancel: () => void;
}

export default function RenameFolderForm({
    inputRef,
    renameValue,
    onRenameValueChange,
    onSave,
    onCancel,
}: RenameFolderFormProps) {
    return (
        <tr className="bg-primary-light/40">
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center justify-center">
                    <FiEdit2 size={16} className="text-primary" />
                </div>
            </td>
            <td className="px-6 py-4">
                <input
                    ref={inputRef}
                    type="text"
                    value={renameValue}
                    onChange={e => onRenameValueChange(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') onSave();
                        if (e.key === 'Escape') onCancel();
                    }}
                    className="w-full max-w-sm px-3 py-1.5 text-sm border border-primary rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </td>
            <td className="px-6 py-4" />
            <td className="px-6 py-4" />
            <td className="px-6 py-4 whitespace-nowrap text-right">
                <button
                    onClick={onSave}
                    className="px-3 py-1.5 text-sm text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors mr-2"
                >
                    Save
                </button>
                <button
                    onClick={onCancel}
                    className="px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100 rounded-lg transition-colors"
                >
                    Cancel
                </button>
            </td>
        </tr>
    );
}
```

- [ ] **Step 3: Verify they typecheck**

Run: `npm run typecheck`
Expected: PASS (components not yet imported)

- [ ] **Step 4: Commit**

```bash
git add src/components/document/NewFolderForm.tsx src/components/document/RenameFolderForm.tsx
git commit -m "refactor: extract folder inline create/rename forms"
```

---

### Task 4: `DeleteConfirmDialogs` component

**Files:**
- Create: `src/components/document/DeleteConfirmDialogs.tsx`

**Interfaces:**
- Consumes (as props):
  ```ts
  export type DeleteTarget =
      | { bulk?: false; id: string; filename: string }
      | { bulk: true; ids: string[]; count: number };

  interface DeleteConfirmDialogsProps {
      folderDeleteTarget: { id: string; name: string } | null;
      folderDeleting: boolean;
      onConfirmFolderDelete: () => void;
      onCancelFolderDelete: () => void;
      deleteTarget: DeleteTarget | null;
      bulkDeleting: boolean;
      onConfirmDelete: () => void;
      onCancelDelete: () => void;
  }
  ```
- Produces: default-exported component rendering both `ConfirmDialog`s (document/bulk + folder). Also re-exports `DeleteTarget` type so `DocumentTable` imports it from here.

- [ ] **Step 1: Create `src/components/document/DeleteConfirmDialogs.tsx`**

```tsx
import ConfirmDialog from '../ui/ConfirmDialog';

export type DeleteTarget =
    | { bulk?: false; id: string; filename: string }
    | { bulk: true; ids: string[]; count: number };

interface DeleteConfirmDialogsProps {
    folderDeleteTarget: { id: string; name: string } | null;
    folderDeleting: boolean;
    onConfirmFolderDelete: () => void;
    onCancelFolderDelete: () => void;
    deleteTarget: DeleteTarget | null;
    bulkDeleting: boolean;
    onConfirmDelete: () => void;
    onCancelDelete: () => void;
}

export default function DeleteConfirmDialogs({
    folderDeleteTarget,
    folderDeleting,
    onConfirmFolderDelete,
    onCancelFolderDelete,
    deleteTarget,
    bulkDeleting,
    onConfirmDelete,
    onCancelDelete,
}: DeleteConfirmDialogsProps) {
    return (
        <>
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
                onConfirm={onConfirmFolderDelete}
                onCancel={onCancelFolderDelete}
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
                onConfirm={onConfirmDelete}
                onCancel={onCancelDelete}
            />
        </>
    );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (component not yet imported)

- [ ] **Step 3: Commit**

```bash
git add src/components/document/DeleteConfirmDialogs.tsx
git commit -m "refactor: extract delete confirm dialogs into DeleteConfirmDialogs"
```

---

### Task 5: Rewire `DocumentTable` to use the extracted units

**Files:**
- Modify: `src/components/document/DocumentTable.tsx`

**Interfaces:**
- Consumes: `useDocumentContents` (Task 1), `DocumentToolbar` (Task 2), `NewFolderForm` + `RenameFolderForm` (Task 3), `DeleteConfirmDialogs` + type `DeleteTarget` (Task 4).
- Produces: same public props `{ refreshTrigger, folderId, onNavigateFolder }`.

- [ ] **Step 1: Replace `src/components/document/DocumentTable.tsx`**

Delete the whole file and write the following (this is the exact intended final state):

```tsx
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import DocumentCard from './DocumentCard';
import FolderCard from './FolderCard';
import DocumentDetailModal from './DocumentDetailModal';
import OcrViewerModal from './OcrViewerModal';
import DocumentToolbar from './DocumentToolbar';
import NewFolderForm from './NewFolderForm';
import RenameFolderForm from './RenameFolderForm';
import DeleteConfirmDialogs, { type DeleteTarget } from './DeleteConfirmDialogs';
import useDocumentContents from './useDocumentContents';
import Table from '../ui/Table';
import gradientSpinner from '../../assets/svg/gradientSpinner.svg';
import documentService from '../../services/documentService';
import folderService from '../../services/folderService';
import type { DocumentItem } from '../../types';
import type { Folder } from '../../types/folder';

const PAGE_SIZE = 10;

type FolderDeleteTarget = { id: string; name: string } | null;
type RenameTarget = { id: string; name: string } | null;

interface DocumentTableProps {
    refreshTrigger: number;
    folderId: string | null;
    onNavigateFolder: (folderId: string, name: string) => void;
}

export default function DocumentTable({ refreshTrigger, folderId, onNavigateFolder }: DocumentTableProps) {
    const { folders, documents, loading, refresh } = useDocumentContents(folderId, refreshTrigger);

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
    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const newFolderInputRef = useRef<HTMLInputElement | null>(null);

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

    const handleDeleteRequest = useCallback((documentId: string) => {
        const doc = documents.find(d => d.id === documentId);
        setDeleteTarget({ id: documentId, filename: doc?.filename || 'this document' });
    }, [documents]);

    const handleBulkDeleteRequest = useCallback(() => {
        if (selectedIds.size === 0) return;
        setDeleteTarget({ bulk: true, ids: [...selectedIds], count: selectedIds.size });
    }, [selectedIds]);

    const handleDeleteConfirm = useCallback(async () => {
        if (!deleteTarget) return;
        try {
            if (deleteTarget.bulk) {
                setBulkDeleting(true);
                const ids = deleteTarget.ids;
                await Promise.all(ids.map(id => documentService.deleteDocument(id)));
                setSelectedIds(new Set());
            } else {
                await documentService.deleteDocument(deleteTarget.id);
                setSelectedIds(prev => {
                    const next = new Set(prev);
                    next.delete(deleteTarget.id);
                    return next;
                });
            }
            refresh(false);
        } catch (err) {
            console.error('Delete failed:', err);
        } finally {
            setDeleteTarget(null);
            setBulkDeleting(false);
        }
    }, [deleteTarget, refresh]);

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
            refresh(false);
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
            refresh(false);
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
            refresh(false);
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
            <DocumentToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                showSelection={!loading && filteredDocs.length > 0}
                allSelected={allSelected}
                someSelected={someSelected}
                hasSelection={hasSelection}
                selectedCount={selectedIds.size}
                bulkDeleting={bulkDeleting}
                onToggleSelectAll={toggleSelectAll}
                onBulkDelete={handleBulkDeleteRequest}
                onCreateFolder={handleCreateFolderStart}
            />
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
                ) : combinedItems.length === 0 ? (
                    <div className="p-12 text-center text-sm text-text-secondary">
                        {searchQuery ? 'No items match your search.' : 'No folders or documents here yet.'}
                    </div>
                ) : (
                    <>
                        <Table headers={['', 'Name', 'Status', 'Uploaded', 'Actions']}>
                            {creatingFolder && (
                                <NewFolderForm
                                    inputRef={newFolderInputRef}
                                    folderName={folderName}
                                    onFolderNameChange={setFolderName}
                                    onCreate={handleCreateFolderSubmit}
                                    onCancel={handleCreateFolderCancel}
                                />
                            )}
                            {renameTarget && (
                                <RenameFolderForm
                                    inputRef={newFolderInputRef}
                                    renameValue={renameValue}
                                    onRenameValueChange={setRenameValue}
                                    onSave={handleRenameSubmit}
                                    onCancel={() => setRenameTarget(null)}
                                />
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
                                return (
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

            <DeleteConfirmDialogs
                folderDeleteTarget={folderDeleteTarget}
                folderDeleting={folderDeleting}
                onConfirmFolderDelete={handleFolderDeleteConfirm}
                onCancelFolderDelete={() => setFolderDeleteTarget(null)}
                deleteTarget={deleteTarget}
                bulkDeleting={bulkDeleting}
                onConfirmDelete={handleDeleteConfirm}
                onCancelDelete={handleDeleteCancel}
            />
        </>
    );
}
```

**Behavior notes (read before coding):**
- Deletes now call `refresh(false)` after a successful server delete instead of mutating local `setDocuments`. This is equivalent UX (row disappears after reload) and simpler.
- Renames call `refresh(false)` to update the folder name from the server instead of local `setFolders` mutation.
- `newFolderInputRef` is a single `useRef` shared by both inline forms (only one shows at a time), same as the original.

- [ ] **Step 2: Verify typecheck + build**

Run: `npm run typecheck`
Run: `npm run build`
Expected: Both PASS with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/document/DocumentTable.tsx
git commit -m "refactor: rewire DocumentTable to use extracted hook and components"
```

---

### Self-Review Map (spec → tasks)

- DocumentTable (541 lines) split into single-purpose units → Tasks 1-5.
- `useDocumentContents` (fetch + polling) → Task 1.
- `DocumentToolbar` (search + select-all + bulk delete + New) → Task 2.
- `NewFolderForm` / `RenameFolderForm` → Task 3.
- `DeleteConfirmDialogs` (document bulk + folder) → Task 4.
- DocumentTable keeps orchestration: selection, pagination, modals, row rendering, folder state → Task 5.
- `DocumentsPage`, `DocumentUploadZone` untouched → Global Constraints.
- Build clean → each task's typecheck/build gate.