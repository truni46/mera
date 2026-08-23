import { FiFolder, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { TableRow, TableCell } from '../ui/Table';
import KebabMenu from '../ui/KebabMenu';
import type { Folder } from '../../types/folder';

function formatDate(dateStr?: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric',
    });
}

interface FolderCardProps {
    folder: Folder;
    onOpen: () => void;
    onRename: () => void;
    onDelete: () => void;
}

export default function FolderCard({ folder, onOpen, onRename, onDelete }: FolderCardProps) {
    return (
        <TableRow onClick={onOpen}>
            <TableCell compact>
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
            <TableCell className="text-sm text-text-primary">
                
            </TableCell>
            <TableCell className="text-sm text-text-primary">
                {formatDate(folder.createdAt)}
            </TableCell>
            <TableCell isLast compact>
                <KebabMenu
                    title="Folder actions"
                    actions={[
                        {
                            id: 'rename',
                            label: 'Rename',
                            icon: <FiEdit2 size={12} />,
                            onClick: onRename,
                        },
                        {
                            id: 'delete',
                            label: 'Delete',
                            icon: <FiTrash2 size={12} />,
                            danger: true,
                            onClick: onDelete,
                        },
                    ]}
                />
            </TableCell>
        </TableRow>
    );
}
