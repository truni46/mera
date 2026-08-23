import { FiAlignLeft, FiTrash2 } from 'react-icons/fi';
import DocumentStatusBadge from './DocumentStatusBadge';
import { TableRow, TableCell } from '../ui/Table';
import Checkbox from '../ui/Checkbox';
import KebabMenu from '../ui/KebabMenu';
import type { DocumentItem } from '../../types';

interface DocumentCardProps {
    document: DocumentItem;
    selected: boolean;
    onToggleSelect: () => void;
    onView: (doc: DocumentItem) => void;
    onDelete: (id: string) => void;
    onViewOcr: (doc: DocumentItem) => void;
}

export default function DocumentCard({ document, selected, onToggleSelect, onView, onDelete, onViewOcr }: DocumentCardProps) {
    const date = new Date(document.createdAt).toLocaleDateString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric',
    });

    return (
        <TableRow onClick={() => onView(document)}>
            <TableCell compact>
                <div className="flex items-center justify-center">
                    <Checkbox
                        checked={!!selected}
                        onChange={e => { e.stopPropagation(); onToggleSelect(); }}
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-3">
                    <span
                        className="font-medium text-sm truncate max-w-xs"
                        title={document.filename}
                    >
                        {document.filename}
                    </span>
                </div>
            </TableCell>
            <TableCell>
                <DocumentStatusBadge status={document.embeddingStatus} />
            </TableCell>
            <TableCell className="text-sm text-text-primary">
                {date}
            </TableCell>
            <TableCell isLast compact>
                <KebabMenu
                    title="Document actions"
                    actions={[
                        ...(document.isScanned && document.ocrStatus === 'completed'
                            ? [{
                                id: 'view-ocr',
                                label: 'View OCR',
                                icon: <FiAlignLeft size={15} />,
                                onClick: () => onViewOcr(document),
                            }]
                            : []),
                        {
                            id: 'delete',
                            label: 'Delete',
                            icon: <FiTrash2 size={15} />,
                            danger: true,
                            onClick: () => onDelete(document.id),
                        },
                    ]}
                />
            </TableCell>
        </TableRow>
    );
}
