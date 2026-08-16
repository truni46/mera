import { useRef, useState, useCallback } from 'react';

interface OverlayScrollAreaProps {
    children: React.ReactNode;
    className?: string;
}

export default function OverlayScrollArea({ children, className = '' }: OverlayScrollAreaProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const hideTimerRef = useRef<number | null>(null);
    const [thumbStyle, setThumbStyle] = useState({ height: 0, top: 0 });
    const [visible, setVisible] = useState(false);

    const updateThumb = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const scrollHeight = el.scrollHeight;
        const clientHeight = el.clientHeight;
        const scrollTop = el.scrollTop;
        const maxScroll = scrollHeight - clientHeight;
        if (maxScroll <= 0) {
            setVisible(false);
            return;
        }
        const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * clientHeight);
        const thumbTop = (scrollTop / maxScroll) * (clientHeight - thumbHeight);
        setThumbStyle({ height: thumbHeight, top: thumbTop });
        setVisible(true);
        if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = window.setTimeout(() => setVisible(false), 800);
    }, []);

    const handleScroll = useCallback(() => {
        updateThumb();
    }, [updateThumb]);

    const handleMouseEnter = useCallback(() => {
        updateThumb();
    }, [updateThumb]);

    const handleMouseLeave = useCallback(() => {
        if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
        setVisible(false);
    }, []);

    return (
        <div
            className={`relative min-h-0 overflow-hidden ${className}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className="h-full overflow-y-auto pr-2 -mr-2 overlay-scroll"
            >
                {children}
            </div>
            <div
                ref={thumbRef}
                className={`absolute right-0 w-1.5 rounded-full bg-gray-400 transition-opacity duration-300 pointer-events-none ${visible ? 'opacity-100' : 'opacity-0'}`}
                style={{ height: thumbStyle.height, top: thumbStyle.top }}
            />
        </div>
    );
}
