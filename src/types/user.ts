export interface User {
    id: string;
    email: string;
    username?: string;
    fullName?: string;
    role?: string;
    preferences?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
}
