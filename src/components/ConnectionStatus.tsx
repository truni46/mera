interface StatusConfig {
    color: string;
    text: string;
    icon: string;
}

interface ConnectionStatusProps {
    status: string;
}

export default function ConnectionStatus({ status }: ConnectionStatusProps) {
    const statusConfig: Record<string, StatusConfig> = {
        connected: {
            color: 'bg-green-500',
            text: 'Connected',
            icon: '✓'
        },
        connecting: {
            color: 'bg-yellow-500',
            text: 'Connecting...',
            icon: '⟳'
        },
        disconnected: {
            color: 'bg-red-500',
            text: 'Disconnected',
            icon: '✗'
        }
    };

    const config = statusConfig[status] || statusConfig.disconnected;

    return (
        <div className="flex items-center space-x-2 text-xs text-text-secondary font-medium">
            <div className={`w-2 h-2 ${config.color} rounded-full ${status === 'connecting' ? 'animate-pulse' : ''}`}></div>
            <span>{config.text}</span>
        </div>
    );
}
