export interface QuotaStatus {
    allowed: boolean;
    warning: boolean;
    used?: number;
    limit?: number;
    [key: string]: unknown;
}
