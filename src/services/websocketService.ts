import { io, Socket } from 'socket.io-client';

const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

type VoidCallback = () => void;
type ErrorCallback = (error: Error) => void;
type DataCallback = (data: unknown) => void;

class WebSocketService {
    private socket: Socket | null = null;
    isConnected = false;
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts = 5;

    connect(onConnect?: VoidCallback, onDisconnect?: VoidCallback, onError?: ErrorCallback): void {
        if (this.socket) {
            return;
        }

        this.socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: 1000,
        });

        this.socket.on('connect', () => {
            console.log('WebSocket connected:', this.socket?.id);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            if (onConnect) onConnect();
        });

        this.socket.on('disconnect', () => {
            console.log('WebSocket disconnected');
            this.isConnected = false;
            if (onDisconnect) onDisconnect();
        });

        this.socket.on('connect_error', (error: Error) => {
            console.error('WebSocket connection error:', error);
            this.reconnectAttempts++;
            if (onError) onError(error);
        });

        this.socket.on('connected', (data: unknown) => {
            console.log('Server welcome:', data);
        });
    }

    sendMessage(message: string, conversationId: string): void {
        if (!this.isConnected || !this.socket) {
            throw new Error('WebSocket not connected');
        }
        this.socket.emit('sendMessage', { message, conversationId });
    }

    sendMessageStreaming(message: string, conversationId: string): void {
        if (!this.isConnected || !this.socket) {
            throw new Error('WebSocket not connected');
        }
        this.socket.emit('sendMessageStreaming', { message, conversationId });
    }

    onMessage(callback: DataCallback): void {
        this.socket?.on('receiveMessage', callback);
    }

    onMessageChunk(callback: DataCallback): void {
        this.socket?.on('messageChunk', callback);
    }

    onMessageComplete(callback: DataCallback): void {
        this.socket?.on('messageComplete', callback);
    }

    onTyping(callback: DataCallback): void {
        this.socket?.on('typing', callback);
    }

    onError(callback: DataCallback): void {
        this.socket?.on('error', callback);
    }

    sendTyping(isTyping: boolean): void {
        if (this.isConnected) {
            this.socket?.emit('typing', { isTyping });
        }
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }

    removeAllListeners(): void {
        this.socket?.removeAllListeners();
    }
}

export default new WebSocketService();
