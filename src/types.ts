export interface AuthData {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    accountId?: string;
    email: string;
    planType: string;
}

export interface ProfileSummary {
    id: string;
    name: string;
    email: string;
    planType: string;
    accountId?: string;
    createdAt: string;
    updatedAt: string;
}
