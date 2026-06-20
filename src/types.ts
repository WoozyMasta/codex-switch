/** Stores authentication tokens and user metadata for a Codex API profile. */
export interface AuthData {
  /** OpenID Connect identity token. */
  idToken: string
  /** OAuth2 access token for API requests. */
  accessToken: string
  /** OAuth2 refresh token for renewing the access token. */
  refreshToken: string
  /** Unique account identifier from the OpenAI backend. */
  accountId?: string
  /** Default organization ID if the account is part of an organization. */
  defaultOrganizationId?: string
  /** Display name of the default organization. */
  defaultOrganizationTitle?: string
  /** ChatGPT-specific user identifier. */
  chatgptUserId?: string
  /** General-purpose user ID. */
  userId?: string
  /** OpenID Connect subject claim. */
  subject?: string
  /** Email address associated with the account. */
  email: string
  /** Subscription plan type (e.g., 'free', 'pro', 'team'). */
  planType: string
  /** Raw auth.json object from the Codex CLI for debugging or recovery. */
  authJson?: Record<string, unknown>
}

/** Represents usage and reset information for a single rate-limit window. */
export interface ProfileRateLimitWindow {
  /** Percentage of quota consumed (0–100). */
  usedPercent: number
  /** Percentage of quota remaining (0–100). */
  remainingPercent: number
  /** Unix timestamp (ms) when the window resets, or null if unknown. */
  resetsAt?: number | null
}

/** Contains rate-limit windows for both 5-hour and weekly quotas. */
export interface ProfileRateLimits {
  /** 5-hour rolling window rate limit, or null if unavailable. */
  fiveHour: ProfileRateLimitWindow | null
  /** Weekly rolling window rate limit, or null if unavailable. */
  weekly: ProfileRateLimitWindow | null
}

/** Determines where secret profile data (tokens) are persisted. */
export type StorageMode = 'auto' | 'secretStorage' | 'remoteFiles'

/** Indicates the source of the Codex home directory configuration. */
export type CodexHomeSource = 'default' | 'environment'

/** Summary of a stored profile, including metadata and rate limits. */
export interface ProfileSummary {
  /** Unique identifier for this profile within the shared store. */
  id: string
  /** User-friendly display name for the profile. */
  name: string
  /** Email associated with the profile. */
  email: string
  /** Subscription plan type. */
  planType: string
  /** Unique account identifier. */
  accountId?: string
  /** Default organization ID. */
  defaultOrganizationId?: string
  /** Display name of the default organization. */
  defaultOrganizationTitle?: string
  /** ChatGPT-specific user ID. */
  chatgptUserId?: string
  /** General user ID. */
  userId?: string
  /** OpenID Connect subject. */
  subject?: string
  /** ISO 8601 timestamp when the profile was created. */
  createdAt: string
  /** ISO 8601 timestamp of the last update. */
  updatedAt: string
  /** Current rate-limit status, if available. */
  rateLimits?: ProfileRateLimits | null
}

/** Resolved Codex home directory path and configuration after environment inspection. */
export interface ResolvedCodexHome {
  /** Unique identifier for this Codex home instance. */
  id: string
  /** Display name derived from the path or environment. */
  name: string
  /** Absolute filesystem path to the Codex home directory. */
  fsPath: string
  /** Environment variable value (e.g., CODEX_HOME) that resolved to fsPath, or the default. */
  envValue: string
  /** Filesystem path to the auth.json file within this Codex home. */
  authPath: string
  /** Where this home was resolved from: 'default' (built-in location) or 'environment' (env var). */
  source: CodexHomeSource
  /** True if this is the default Codex home used when no CODEX_HOME is set. */
  isDefault: boolean
  /** True if this Codex home maintains per-home state (shared across VS Code windows). */
  usesPerHomeState: boolean
}
