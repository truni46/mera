import type { ReactNode, MouseEvent } from 'react';

interface TableProps {
    headers?: ReactNode[];
    children: ReactNode;
    className?: string;
}

export default function Table({ headers = [], children, className = '' }: TableProps) {
    return (
        <div className={`overflow-x-auto w-full ${className}`}>
            <table className="w-full text-left border-separate border-spacing-0 table-fixed">
                <thead className="text-sm md:text-md text-text-secondary">
                    <tr>
                        {headers.map((header, index) => {
                            const isEmptyHeader = typeof header === 'string' && header === '';
                            return (
                                <th
                                    key={index}
                                    className={`py-5 whitespace-nowrap font-normal bg-white border-b border-border-color ${isEmptyHeader ? 'px-1' : 'px-2'} ${index === 0 ? 'w-10' : ''} ${index === headers.length - 1 ? 'w-24 text-right' : ''} ${index === 0 ? 'rounded-tl-[2px]' : ''} ${index === headers.length - 1 ? 'rounded-tr-[2px]' : ''}`}
                                >
                                    {header}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody className="divide-y divide-border-color bg-white">
                    {children}
                </tbody>
            </table>
        </div>
    );
}

interface TableRowProps {
    children: ReactNode;
    className?: string;
    onClick?: (e: MouseEvent<HTMLTableRowElement>) => void;
}

export function TableRow({ children, className = '', onClick }: TableRowProps) {
    return (
        <tr
            className={`hover:bg-gray-50 transition-colors ${onClick ? 'cursor-pointer' : ''} ${className}`}
            onClick={onClick}
        >
            {children}
        </tr>
    );
}

interface TableCellProps {
    children?: ReactNode;
    className?: string;
    isLast?: boolean;
    compact?: boolean;
    colSpan?: number;
}

export function TableCell({ children, className = '', isLast = false, compact = false, colSpan }: TableCellProps) {
    return (
        <td colSpan={colSpan} className={`${compact ? 'pl-3' : 'px-2'} ${isLast ? 'pr-2' : ''} py-3 whitespace-nowrap ${isLast ? 'text-right' : ''} ${className}`}>
            {children}
        </td>
    );
}
