class Logger {
    private isDevelopment: boolean;

    constructor() {
        this.isDevelopment = import.meta.env.DEV;
    }

    private formatMessage(level: string, message: unknown, ...args: unknown[]): unknown[] {
        const timestamp = new Date().toISOString();
        return [`[${timestamp}] [${level}]`, message, ...args];
    }

    info(message: unknown, ...args: unknown[]): void {
        if (this.isDevelopment) {
            console.log(...this.formatMessage('INFO', message), ...args);
        }
    }

    warn(message: unknown, ...args: unknown[]): void {
        console.warn(...this.formatMessage('WARN', message), ...args);
    }

    error(message: unknown, ...args: unknown[]): void {
        console.error(...this.formatMessage('ERROR', message), ...args);
    }

    debug(message: unknown, ...args: unknown[]): void {
        if (this.isDevelopment) {
            console.debug(...this.formatMessage('DEBUG', message), ...args);
        }
    }

    chat(message: unknown, ...args: unknown[]): void {
        if (this.isDevelopment) {
            console.log(...this.formatMessage('CHAT', message), ...args);
        }
    }
}

export default new Logger();
