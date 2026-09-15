import type {
  FunctionalStatus,
  LotCondition,
  LotDescriptionSettings,
  YesNo,
} from '../types'

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
  return `${buildDescriptionHeader(settings)}\n\n${descriptionBody}`
}

function stripStructuredHeader(description: string): string | null {
  const labels = [
    'Condition',
    'Condition Notes',
    'Damage',
    'Functional',
    'Missing Parts/Pieces',
    'Packaging',
  ]
  const lines = description.replace(/\r\n/g, '\n').split('\n')
  if (lines.length < labels.length) return null
  for (let i = 0; i < labels.length; i += 1) {
    if (!lines[i].startsWith(`${labels[i]}:`)) return null
  }
  let bodyStart = labels.length
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart += 1
  return lines.slice(bodyStart).join('\n').trim()
}

/** Pull only the free-text item body from both current and legacy formats. */
export function extractDescriptionBody(description: string): string {
  const marker = '*Description'
  const idx = description.indexOf(marker)
  if (idx >= 0) return description.slice(idx + marker.length).trim()
  const stripped = stripStructuredHeader(description)
  if (stripped != null) return stripped
  return description.trim()
}

function pickEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function getHeaderValue(description: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = description.match(new RegExp(`^${escaped}:\\s*(.*)$`, 'm'))
  return match?.[1] ?? null
}

export function parseDescriptionForEditing(
  description: string,
  fallbackSettings: LotDescriptionSettings = DEFAULT_LOT_DESCRIPTION_SETTINGS,
): { settings: LotDescriptionSettings; body: string } {
  const condition = pickEnum<LotCondition>(
    getHeaderValue(description, 'Condition')?.trim() ?? fallbackSettings.condition,
    ['New', 'Open Box', 'Used'],
    fallbackSettings.condition,
  )
  const damage = pickEnum<YesNo>(
    getHeaderValue(description, 'Damage')?.trim() ?? fallbackSettings.damage,
    ['Yes', 'No'],
    fallbackSettings.damage,
  )
  const functional = pickEnum<FunctionalStatus>(
    getHeaderValue(description, 'Functional')?.trim() ?? fallbackSettings.functional,
    ['Yes', 'No', 'Unable to Test'],
    fallbackSettings.functional,
  )
  const missingParts = pickEnum<YesNo>(
    getHeaderValue(description, 'Missing Parts/Pieces')?.trim() ?? fallbackSettings.missingParts,
    ['Yes', 'No'],
    fallbackSettings.missingParts,
  )
  const packaging = pickEnum<YesNo>(
    getHeaderValue(description, 'Packaging')?.trim() ?? fallbackSettings.packaging,
    ['Yes', 'No'],
    fallbackSettings.packaging,
  )
  const conditionNotes =
    getHeaderValue(description, 'Condition Notes')?.trim() ?? fallbackSettings.conditionNotes

  return {
    settings: {
      condition,
      conditionNotes,
      damage,
      functional,
      missingParts,
      packaging,
      description: fallbackSettings.description,
    },
    body: extractDescriptionBody(description),
  }
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
