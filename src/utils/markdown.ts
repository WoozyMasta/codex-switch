export function escapeMarkdown(text: string): string {
  // Escapes Markdown control chars so untrusted values (email/plan/etc)
  // can't inject formatting or links into tooltips.
  const markdownEscaped = text.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&')
  // Also escape HTML-significant chars because tooltip markdown enables HTML.
  return markdownEscaped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
