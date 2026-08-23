import { useLayoutEffect, useRef, useState } from 'react';
import { FiChevronRight } from 'react-icons/fi';

export interface BreadcrumbItem {
    id: string | null;
    name: string;
}

interface BreadcrumbProps {
    items: BreadcrumbItem[];
    onNavigate: (id: string | null) => void;
}

const GAP = 4; // gap-1 = 0.25rem

export default function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const [start, setStart] = useState(0);

    useLayoutEffect(() => {
        const wrapper = wrapperRef.current;
        const measure = measureRef.current;
        if (!wrapper || !measure) return;

        const compute = () => {
            const containerW = wrapper.clientWidth;
            const n = items.length;
            if (n === 0) {
                setStart(0);
                return;
            }

            const segs = Array.from(measure.children) as HTMLElement[];
            const widths = segs.slice(0, n).map(el => el.offsetWidth);
            const ellWidth = (segs[n] ? segs[n].offsetWidth : 40) + GAP;

            let full = widths.reduce((acc, w, i) => acc + (i > 0 ? GAP : 0) + w, 0);
            if (full <= containerW) {
                setStart(0);
                return;
            }

            for (let s = n - 1; s >= 0; s--) {
                let w = ellWidth;
                for (let i = s; i < n; i++) {
                    w += (i > s ? GAP : 0) + widths[i];
                }
                if (w <= containerW) {
                    setStart(s);
                    return;
                }
            }
            setStart(n - 1);
        };

        compute();
        const ro = new ResizeObserver(compute);
        ro.observe(wrapper);
        window.addEventListener('resize', compute);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', compute);
        };
    }, [items]);

    if (items.length === 0) return null;

    const truncated = start > 0;

    return (
        <div ref={wrapperRef} className="min-w-0 max-w-full">
            <nav className="flex items-center gap-1 text-md min-w-0 max-w-full overflow-hidden">
                {truncated && (
                    <button
                        onClick={() => onNavigate(null)}
                        className="text-text-secondary hover:text-primary transition-colors whitespace-nowrap px-1"
                        title="Go to root"
                    >
                        ...
                    </button>
                )}
                {items.map((item, index) => {
                    if (index < start) return null;
                    const isFirstShown = index === start;
                    const isLast = index === items.length - 1;
                    return (
                        <div key={item.id ?? 'crumb-' + index} className="flex items-center gap-1 min-w-0">
                            {(!isFirstShown || truncated) && (
                                <FiChevronRight size={14} className="text-text-muted flex-shrink-0" />
                            )}
                            {isLast ? (
                                <span className="font-semibold text-text-primary truncate max-w-[10rem] min-w-0">
                                    {item.name}
                                </span>
                            ) : (
                                <button
                                    onClick={() => onNavigate(item.id)}
                                    className="text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap max-w-[10rem] truncate"
                                >
                                    {item.name}
                                </button>
                            )}
                        </div>
                    );
                })}
            </nav>

            <div
                ref={measureRef}
                aria-hidden
                className="invisible absolute left-0 top-0 flex items-center gap-1 text-md whitespace-nowrap"
            >
                {items.map((item, index) => (
                    <span key={item.id ?? 'm-' + index} className="flex items-center gap-1">
                        {index > 0 && <FiChevronRight size={14} className="flex-shrink-0" />}
                        <span className="max-w-[10rem] truncate">{item.name}</span>
                    </span>
                ))}
                <span className="px-1">...</span>
            </div>
        </div>
    );
}