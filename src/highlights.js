// Keep the contract text intact and mark every finding with an exact source quote.
// A missing clause has no source span and therefore cannot be highlighted.
export function highlightSegments(text, issues = []) {
  const ranges = issues.flatMap(issue => {
    const quote = issue.quote || issue.excerpt || ''
    const start = quote ? text.indexOf(quote) : -1
    return start < 0 ? [] : [{ start, end: start + quote.length, id: issue.id }]
  })
  if (!ranges.length) return [{ text, issueIds: [] }]
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b)
  return boundaries.slice(1).map((end, index) => {
    const start = boundaries[index]
    return { text: text.slice(start, end), issueIds: [...new Set(ranges.filter(range => range.start < end && range.end > start).map(range => range.id))] }
  }).filter(segment => segment.text)
}
