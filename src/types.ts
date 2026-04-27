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

export type StorageMode = 'auto' | 'secretStorage' | 'remoteFiles'

export type CodexHomeSource = 'default' | 'environment'

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
}

export interface ResolvedCodexHome {
  id: string
  name: string
  fsPath: string
  envValue: string
  authPath: string
  source: CodexHomeSource
  isDefault: boolean
  usesPerHomeState: boolean
}
