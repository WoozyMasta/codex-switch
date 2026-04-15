export interface AuthData {
  idToken: string
  accessToken: string
  refreshToken: string
  accountId?: string
  defaultOrganizationId?: string
  defaultOrganizationTitle?: string
  chatgptUserId?: string
  userId?: string
  subject?: string
  email: string
  planType: string
  authJson?: Record<string, unknown>
}

export interface ProfileRateLimitWindow {
  usedPercent: number
  remainingPercent: number
  resetsAt?: number | null
}

export interface ProfileRateLimits {
  fiveHour: ProfileRateLimitWindow | null
  weekly: ProfileRateLimitWindow | null
}

export type StorageMode = 'auto' | 'secretStorage' | 'remoteFiles'

export interface ProfileSummary {
  id: string
  name: string
  email: string
  planType: string
  accountId?: string
  defaultOrganizationId?: string
  defaultOrganizationTitle?: string
  chatgptUserId?: string
  userId?: string
  subject?: string
  createdAt: string
  updatedAt: string
  rateLimits?: ProfileRateLimits | null
}
