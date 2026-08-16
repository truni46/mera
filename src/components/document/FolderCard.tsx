import { useState } from 'react';
import { FiFolder, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { HiTrash } from 'react-icons/hi2';
import { TableRow, TableCell } from '../ui/Table';
import type { Folder } from '../../types/folder';

function formatDate(dateStr?: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
    });
}

interface FolderCardProps {
    folder: Folder;
    onOpen: () => void;
    onRename: () => void;
    onDelete: () => void;
}

export default function FolderCard({ folder, onOpen, onRename, onDelete }: FolderCardProps) {
    const [hovered, setHovered] = useState(false);
    const [deleteHovered, setDeleteHovered] = useState(false);

    return (
        <TableRow onClick={onOpen}>
            <TableCell>
                <div className="flex items-center justify-center">
                    <FiFolder size={16} className="text-primary" />
                </div>
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate max-w-xs" title={folder.name}>
                        {folder.name}
                    </span>
                </div>
            </TableCell>
            <TableCell className="text-sm text-text-secondary">
                —
            </TableCell>
            <TableCell className="text-sm text-text-secondary">
                {formatDate(folder.createdAt)}
            </TableCell>
            <TableCell isLast>
                <div className="flex items-center justify-end gap-0.5">
                    <button
                        onClick={e => { e.stopPropagation(); onRename(); }}
                        onMouseEnter={() => setHovered(true)}
                        onMouseLeave={() => setHovered(false)}
                        className="p-2 text-gray-400 hover:text-primary hover:bg-primary-light rounded transition-colors"
                        title="Rename folder"
                    >
                        <FiEdit2 size={15} />
                    </button>
                    <button
                        onClick={e => { e.stopPropagation(); onDelete(); }}
                        onMouseEnter={() => setDeleteHovered(true)}
                        onMouseLeave={() => setDeleteHovered(false)}
                        className="p-2 transition-colors rounded"
                        title="Delete folder"
                    >
                        {deleteHovered
                            ? <HiTrash size={16} className="text-red-700" />
                            : <FiTrash2 size={16} className="text-gray-400" />
                        }
                    </button>
                </div>
            </TableCell>
        </TableRow>
    );
}
