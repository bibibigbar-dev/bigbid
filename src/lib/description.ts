export const HIBID_TITLE_MAX = 50

const DESCRIPTION_PREFIX = [
  'Condition: Open Box / Customer Return',
  'Condition Notes:',
  'Damage: No',
  'Functional: Unable to Test',
  'Missing Parts/Pieces: No',
  'Packaging: Yes',
  '',
  'The item description below is copied and pasted from third-party retail websites. Any warranties, guarantees, or representations expressed in those descriptions do not apply and are not valid for this sale.',
  '',
  '*Description',
].join('\n')

/** Format price like 399 or 79.99 (no trailing .00 when whole). */
export function formatSaleAmount(salePrice: number): string {
  if (Number.isInteger(salePrice)) return String(salePrice)
  return String(Math.round(salePrice * 100) / 100)
}

/** Remove a leading "$399 " style prefix from a title/name. */
export function stripLeadingPrice(text: string): string {
  return text.replace(/^\$\s*\d+(?:[.,]\d+)?\s+/i, '').trim()
}

export function truncateTitle(text: string, max = HIBID_TITLE_MAX): string {
  const t = text.trim()
  if (t.length <= max) return t
  const sliced = t.slice(0, max - 1)
  const cut = sliced.lastIndexOf(' ')
  const base = cut >= Math.floor(max * 0.5) ? sliced.slice(0, cut) : sliced
  return `${base.trimEnd()}…`
}

/**
 * Title = Retail/Reference price + product name, max 50 chars (HiBid limit).
 * e.g. "$79.99 Lasko Ceramic Tower Space Heater…"
 */
export function buildTitle(productName: string, retailPrice: number | null): string {
  const name = stripLeadingPrice(productName) || 'Untitled item'
  if (retailPrice == null || !Number.isFinite(retailPrice)) {
    return truncateTitle(name)
  }
  const prefix = `$${formatSaleAmount(retailPrice)} `
  const room = HIBID_TITLE_MAX - prefix.length
  if (room <= 4) return truncateTitle(`$${formatSaleAmount(retailPrice)}`)
  const clippedName =
    name.length <= room
      ? name
      : truncateTitle(name, room).replace(/…$/, '').trimEnd() + (name.length > room ? '…' : '')
  return truncateTitle(`${prefix}${clippedName}`)
}

/**
 * Fixed HiBid boilerplate, then product detail under *Description.
 * If detail is missing, use title.
 */
export function buildHibidDescription(detail: string, fallbackTitle: string): string {
  const body = detail.trim() || fallbackTitle.trim() || 'Untitled item'
  return `${DESCRIPTION_PREFIX}\n${body}`
}

/** Pull only the free-text under *Description (or whole text if marker missing). */
export function extractDescriptionBody(description: string): string {
  const marker = '*Description'
  const idx = description.indexOf(marker)
  if (idx < 0) return description.trim()
  return description.slice(idx + marker.length).trim()
}

/** Rebuild title + description into the required export format. */
export function normalizeLotContent(input: {
  title: string
  description: string
  salePrice: number | null
}): { title: string; description: string } {
  const title = buildTitle(input.title, input.salePrice)
  const detail = extractDescriptionBody(input.description)
  const body = detail && detail !== title ? detail : title
  return {
    title,
    description: buildHibidDescription(body, title),
  }
}
