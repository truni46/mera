export interface QuotaWindow {
    used: number;
    limit: number;
    percent: number;
    remainingSeconds?: number;
    resetDay?: string;
}

export interface QuotaStatus {
    allowed: boolean;
    warning: boolean;
    used?: number;
    limit?: number;
    session?: QuotaWindow;
    weekly?: QuotaWindow;
    [key: string]: unknown;
}
