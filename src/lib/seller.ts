import type { BidStrategy, SellerSettings } from '../types'
import { DEFAULT_BID_PRICE_SETTINGS, normalizeBidPriceSettings } from './bid'
import { DEFAULT_LOT_DESCRIPTION_SETTINGS, normalizeConditionNotesAndDamage } from './description'

const STORAGE_KEY = 'bigbid.seller'

const DEFAULTS: SellerSettings = {
  sellerCode: '',
  remember: true,
  bidStrategy: 'recommended',
  bidPriceSettings: DEFAULT_BID_PRICE_SETTINGS,
  lotDescription: DEFAULT_LOT_DESCRIPTION_SETTINGS,
}

function parseLotDescription(raw: unknown): SellerSettings['lotDescription'] {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LOT_DESCRIPTION_SETTINGS }
  const value = raw as Partial<SellerSettings['lotDescription']>
  const hasSavedDamage = value.damage === 'Yes' || value.damage === 'No'
  const normalizedCondition = normalizeConditionNotesAndDamage(
    typeof value.conditionNotes === 'string'
      ? value.conditionNotes
      : DEFAULT_LOT_DESCRIPTION_SETTINGS.conditionNotes,
    hasSavedDamage ? value.damage : DEFAULT_LOT_DESCRIPTION_SETTINGS.damage,
    { preserveDamage: hasSavedDamage },
  )
  return {
    condition:
      value.condition === 'New' || value.condition === 'Open Box' || value.condition === 'Used'
        ? value.condition
        : DEFAULT_LOT_DESCRIPTION_SETTINGS.condition,
    conditionNotes: normalizedCondition.conditionNotes,
    damage: normalizedCondition.damage,
    functional:
      value.functional === 'Yes' ||
      value.functional === 'No' ||
      value.functional === 'Unable to Test'
        ? value.functional
        : DEFAULT_LOT_DESCRIPTION_SETTINGS.functional,
    missingParts:
      value.missingParts === 'Yes' || value.missingParts === 'No'
        ? value.missingParts
        : DEFAULT_LOT_DESCRIPTION_SETTINGS.missingParts,
    packaging:
      value.packaging === 'Yes' || value.packaging === 'No'
        ? value.packaging
        : DEFAULT_LOT_DESCRIPTION_SETTINGS.packaging,
    description:
      typeof value.description === 'string'
        ? value.description.slice(0, 1000)
        : DEFAULT_LOT_DESCRIPTION_SETTINGS.description,
  }
}

export function loadSellerSettings(): SellerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<SellerSettings>
    const strategy = parsed.bidStrategy
    return {
      sellerCode: parsed.sellerCode ?? '',
      remember: parsed.remember ?? true,
      bidStrategy: strategy === 'aggressive' ? 'aggressive' : 'recommended',
      bidPriceSettings: normalizeBidPriceSettings(parsed.bidPriceSettings),
      lotDescription: parseLotDescription(parsed.lotDescription),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSellerSettings(settings: SellerSettings): void {
  const bidStrategy: BidStrategy =
    settings.bidStrategy === 'aggressive' ? 'aggressive' : 'recommended'
  const normalizedLotDescription = parseLotDescription(settings.lotDescription)
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sellerCode: settings.remember ? settings.sellerCode.trim() : '',
        remember: settings.remember,
        bidStrategy,
        bidPriceSettings: normalizeBidPriceSettings(settings.bidPriceSettings),
        lotDescription: {
          ...normalizedLotDescription,
          description: settings.lotDescription.description.trim().slice(0, 1000),
        },
      }),
    )
  } catch {
    // Private mode / blocked storage — keep session in memory only
  }
}

export function clearSellerSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
