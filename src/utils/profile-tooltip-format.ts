import { ProfileRateLimitWindow } from '../types'
import { escapeMarkdown } from './markdown'

export function buildCommandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
}

export function escapeLinkTitle(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function escapeTableCell(text: string): string {
  return escapeMarkdown(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function formatRateLimitCell(
  window: ProfileRateLimitWindow | null | undefined,
): string {
  if (!window) {
    return '-'
  }

  return `${Math.round(window.remainingPercent)}%`
}

export function padTableCell(content: string): string {
  return `&nbsp;${content}&nbsp;`
}
