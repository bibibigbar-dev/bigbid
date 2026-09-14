import type { BidStrategy, SellerSettings } from '../types'

const STORAGE_KEY = 'bigbid.seller'

const DEFAULTS: SellerSettings = {
  sellerCode: '',
  remember: true,
  bidStrategy: 'recommended',
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
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSellerSettings(settings: SellerSettings): void {
  const bidStrategy: BidStrategy =
    settings.bidStrategy === 'aggressive' ? 'aggressive' : 'recommended'
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sellerCode: settings.remember ? settings.sellerCode.trim() : '',
        remember: settings.remember,
        bidStrategy,
      }),
    )
  } catch {
    // Private mode / blocked storage — keep session in memory only
  }
}
