export interface AuthData {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    accountId?: string;
    defaultOrganizationId?: string;
    defaultOrganizationTitle?: string;
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
    defaultOrganizationId?: string;
    defaultOrganizationTitle?: string;
    createdAt: string;
    updatedAt: string;
}
