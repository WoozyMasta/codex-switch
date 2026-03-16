export interface AuthData {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    accountId?: string;
    chatgptUserId?: string;
    userId?: string;
    subject?: string;
    email: string;
    planType: string;
    authJson?: Record<string, unknown>;
}

export interface ProfileSummary {
    id: string;
    name: string;
    email: string;
    planType: string;
    accountId?: string;
    chatgptUserId?: string;
    userId?: string;
    subject?: string;
    createdAt: string;
    updatedAt: string;
}
