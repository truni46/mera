type StatusKey = 'pending' | 'processing' | 'completed' | 'failed';

interface StatusConfig {
    label: string;
    dot: string;
    pulse?: boolean;
}

const CONFIG: Record<StatusKey, StatusConfig> = {
    pending: { label: 'Pending', dot: '#9ca3af' },
    processing: { label: 'Processing', dot: '#007E6E', pulse: true },
    completed: { label: 'Completed', dot: '#22c55e' },
    failed: { label: 'Failed', dot: '#ef4444' },
};

interface DocumentStatusBadgeProps {
    status?: string;
}

export default function DocumentStatusBadge({ status }: DocumentStatusBadgeProps) {
    const { label, dot, pulse } = CONFIG[status as StatusKey] || CONFIG.pending;

    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-color bg-white text-xs font-medium text-text-primary">
            {pulse ? (
                <span
                    className="w-1.5 h-1.5 rounded-full inline-block animate-pulse"
                    style={{ backgroundColor: dot }}
                />
            ) : (
                <span
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ backgroundColor: dot }}
                />
            )}
            {label}
        </span>
    );
}