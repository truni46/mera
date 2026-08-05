import Badge from '../ui/Badge';

type StatusKey = 'pending' | 'processing' | 'completed' | 'failed';

interface StatusConfig {
    label: string;
    variant: 'default' | 'primary' | 'success' | 'error';
    spinner?: boolean;
}

const CONFIG: Record<StatusKey, StatusConfig> = {
    pending: { label: 'Pending', variant: 'default' },
    processing: { label: 'Processing', variant: 'primary', spinner: true },
    completed: { label: 'Completed', variant: 'success' },
    failed: { label: 'Failed', variant: 'error' },
};

interface DocumentStatusBadgeProps {
    status?: string;
}

export default function DocumentStatusBadge({ status }: DocumentStatusBadgeProps) {
    const { label, variant, spinner } = CONFIG[status as StatusKey] || CONFIG.pending;

    return (
        <Badge variant={variant} showSpinner={spinner}>
            {label}
        </Badge>
    );
}
