import { FiChevronRight } from 'react-icons/fi';

export interface BreadcrumbItem {
    id: string | null;
    name: string;
}

interface BreadcrumbProps {
    items: BreadcrumbItem[];
    onNavigate: (id: string | null) => void;
}

export default function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
    if (items.length === 0) return null;

    return (
        <nav className="flex items-center gap-1 text-sm">
            {items.map((item, index) => {
                const isLast = index === items.length - 1;
                return (
                    <div key={item.id ?? 'root'} className="flex items-center gap-1">
                        {index > 0 && <FiChevronRight size={14} className="text-text-muted flex-shrink-0" />}
                        {isLast ? (
                            <span className="font-semibold text-text-primary truncate max-w-xs">{item.name}</span>
                        ) : (
                            <button
                                onClick={() => onNavigate(item.id)}
                                className="text-text-secondary hover:text-primary transition-colors whitespace-nowrap"
                            >
                                {item.name}
                            </button>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}
