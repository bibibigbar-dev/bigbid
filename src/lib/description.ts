import type { LotDescriptionSettings } from '../types'

export const HIBID_TITLE_MAX = 50

export const DEFAULT_LOT_DESCRIPTION_SETTINGS: LotDescriptionSettings = {
  condition: 'Open Box',
  conditionNotes: '',
  damage: 'No',
  functional: 'Unable to Test',
  missingParts: 'No',
  packaging: 'Yes',
  description: '',
}

export function buildDescriptionHeader(settings: LotDescriptionSettings): string {
  return [
    `Condition: ${settings.condition}`,
    `Condition Notes: ${settings.conditionNotes.trim()}`,
    `Damage: ${settings.damage}`,
    `Functional: ${settings.functional}`,
    `Missing Parts/Pieces: ${settings.missingParts}`,
    `Packaging: ${settings.packaging}`,
    '',
    'The item description below is copied and pasted from third-party retail websites. Any warranties, guarantees, or representations expressed in those descriptions do not apply and are not valid for this sale.',
    '',
    '*Description',
  ].join('\n')
}

export const DEFAULT_HIBID_DESCRIPTION = buildDescriptionHeader(DEFAULT_LOT_DESCRIPTION_SETTINGS)

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

/** Title = product name, with retail prefix only when retail > $100. */
export function buildTitle(productName: string, retailPrice: number | null): string {
  const name = stripLeadingPrice(productName) || 'Untitled item'
  if (retailPrice == null || !Number.isFinite(retailPrice) || retailPrice <= 100) {
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
  return buildHibidDescriptionWithSettings(detail, fallbackTitle)
}

export function buildHibidDescriptionWithSettings(
  detail: string,
  fallbackTitle: string,
  settings: LotDescriptionSettings = DEFAULT_LOT_DESCRIPTION_SETTINGS,
): string {
  const body = detail.trim() || fallbackTitle.trim() || 'Untitled item'
  const sharedDescription = settings.description.trim()
  const descriptionBody = sharedDescription ? `${sharedDescription}\n\n${body}` : body
  return `${buildDescriptionHeader(settings)}\n${descriptionBody}`
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
  lotDescriptionSettings?: LotDescriptionSettings
}): { title: string; description: string } {
  const title = buildTitle(input.title, input.salePrice)
  const detail = extractDescriptionBody(input.description)
  const body = detail && detail !== title ? detail : title
  return {
    title,
    description: buildHibidDescriptionWithSettings(body, title, input.lotDescriptionSettings),
  }
}
