import type { BidPriceSettings } from '../types'

export const DEFAULT_BID_PRICE_SETTINGS: BidPriceSettings = {
  upTo20: 3,
  upTo50: 5,
  upTo100: 7,
  upTo150: 10,
  upTo250: 12,
  over250: 15,
}

function parseBidValue(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.round(n * 100) / 100
}

export function normalizeBidPriceSettings(raw: unknown): BidPriceSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BID_PRICE_SETTINGS }
  const value = raw as Partial<BidPriceSettings>
  return {
    upTo20: parseBidValue(value.upTo20, DEFAULT_BID_PRICE_SETTINGS.upTo20),
    upTo50: parseBidValue(value.upTo50, DEFAULT_BID_PRICE_SETTINGS.upTo50),
    upTo100: parseBidValue(value.upTo100, DEFAULT_BID_PRICE_SETTINGS.upTo100),
    upTo150: parseBidValue(value.upTo150, DEFAULT_BID_PRICE_SETTINGS.upTo150),
    upTo250: parseBidValue(value.upTo250, DEFAULT_BID_PRICE_SETTINGS.upTo250),
    over250: parseBidValue(value.over250, DEFAULT_BID_PRICE_SETTINGS.over250),
  }
}

export function bidPriceFromRetail(
  retailPrice: number | null,
  settings: BidPriceSettings,
): number | null {
  if (retailPrice == null || !Number.isFinite(retailPrice) || retailPrice < 0) return null
  if (retailPrice <= 20) return settings.upTo20
  if (retailPrice <= 50) return settings.upTo50
  if (retailPrice <= 100) return settings.upTo100
  if (retailPrice <= 150) return settings.upTo150
  if (retailPrice <= 250) return settings.upTo250
  return settings.over250
}
