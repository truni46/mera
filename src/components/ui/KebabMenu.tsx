import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiMoreVertical } from 'react-icons/fi';
import type { ReactNode } from 'react';

export interface KebabMenuAction {
    id: string;
    label: string;
    icon?: ReactNode;
    danger?: boolean;
    onClick: () => void;
}

interface KebabMenuProps {
    actions: KebabMenuAction[];
    title?: string;
    className?: string;
}

export default function KebabMenu({ actions, title = 'Actions', className = '' }: KebabMenuProps) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const close = useCallback(() => setOpen(false), []);

    const toggle = () => {
        if (!open) {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) {
                setPos({ top: rect.bottom + 4, left: rect.right - 176 });
            }
            setOpen(true);
        } else {
            setOpen(false);
        }
    };

    useLayoutEffect(() => {
        if (!open) return;

        const onScroll = () => close();
        const onResize = () => close();

        // Close on outside click (menu + trigger excluded)
        const onDown = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node;
            if (menuRef.current?.contains(target)) return;
            if (triggerRef.current?.contains(target)) return;
            close();
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };

        window.addEventListener('mousedown', onDown);
        window.addEventListener('touchstart', onDown);
        window.addEventListener('keydown', onKey);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('touchstart', onDown);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [open, close]);

    return (
        <div className={`inline-flex ${className}`} onClick={(e) => e.stopPropagation()}>
            <button
                ref={triggerRef}
                onClick={(e) => { e.stopPropagation(); toggle(); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                title={title}
                aria-label={title}
                aria-expanded={open}
            >
                <FiMoreVertical size={16} className="text-text-secondary" />
            </button>

            {open && pos && createPortal(
                <div
                    ref={menuRef}
                    className="fixed w-40 bg-white border border-border rounded-lg shadow-xl py-1 animate-fade-in"
                    style={{ top: pos.top, left: pos.left, zIndex: 200 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {actions.map((action) => (
                        <div className="px-1">
                            <button
                                key={action.id}
                                onClick={() => { close(); action.onClick(); }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm rounded-md transition-colors ${action.danger
                                    ? 'text-red-600 hover:bg-red-50'
                                    : 'text-text-primary hover:bg-gray-50'
                                    }`}
                            >
                                {action.icon && <span className="flex-shrink-0">{action.icon}</span>}
                                <span>{action.label}</span>
                            </button>
                        </div>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}