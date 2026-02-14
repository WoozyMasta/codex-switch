export function escapeMarkdown(text: string): string {
  // Escapes Markdown control chars so untrusted values (email/plan/etc)
  // can't inject formatting or links into tooltips.
  return text.replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&')
}

