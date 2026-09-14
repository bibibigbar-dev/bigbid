import type { PalletConfig, PartMode } from '../types'

const STORAGE_KEY = 'bigbid.pallet'

export function formatProductNo(num: string, alpha: string): string {
  return `${num}${alpha}`
}

export function validateNumPart(value: string): string | null {
  if (!/^\d{1,5}$/.test(value)) return 'Digits must be 1–5 characters.'
  return null
}

export function validateAlphaPart(value: string): string | null {
  if (value === '') return null
  if (!/^[a-zA-Z]{1,5}$/.test(value)) return 'Letters must be up to 5 A–Z characters.'
  return null
}

/** Increment decimal string, preserving width when possible (max 5 digits). */
export function incrementNum(value: string): string {
  const width = value.length
  const next = Number.parseInt(value, 10) + 1
  if (!Number.isFinite(next) || next > 99999) {
    throw new Error('Digit part exceeds 99999.')
  }
  return String(next).padStart(Math.min(width, 5), '0').slice(-5)
}

/** Increment a–z letter string like base-26 (ff → fg). Max length 5. */
export function incrementAlpha(value: string): string {
  if (!value) return 'a'
  const chars = value.toLowerCase().split('')
  let i = chars.length - 1
  while (i >= 0) {
    if (chars[i] < 'z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1)
      return chars.join('')
    }
    chars[i] = 'a'
    i -= 1
  }
  if (chars.length >= 5) {
    throw new Error('Letter part exceeds zzzzz.')
  }
  return `a${chars.join('')}`
}

export function peekSequence(
  config: Pick<PalletConfig, 'nextNum' | 'nextAlpha' | 'numMode' | 'alphaMode'>,
  count = 3,
): string[] {
  const out: string[] = []
  let num = config.nextNum
  let alpha = config.nextAlpha
  for (let i = 0; i < count; i++) {
    out.push(formatProductNo(num, alpha))
    if (config.numMode === 'seq') num = incrementNum(num)
    if (config.alphaMode === 'seq') alpha = incrementAlpha(alpha)
  }
  return out
}

/**
 * Walk the pallet sequence from the start and return the first code
 * not already used (so deleted mid-list numbers are reused).
 */
export function firstAvailableCursor(
  config: Pick<PalletConfig, 'numValue' | 'alphaValue' | 'numMode' | 'alphaMode'>,
  usedProductNos: Iterable<string>,
  maxScan = 20000,
): { nextNum: string; nextAlpha: string } {
  const used = new Set(
    [...usedProductNos].map((n) => n.trim()).filter(Boolean),
  )
  let num = config.numValue
  let alpha = config.alphaValue
  for (let i = 0; i < maxScan; i++) {
    const code = formatProductNo(num, alpha)
    if (!used.has(code)) return { nextNum: num, nextAlpha: alpha }
    if (config.numMode === 'seq') num = incrementNum(num)
    if (config.alphaMode === 'seq') alpha = incrementAlpha(alpha)
  }
  throw new Error('No available lot numbers left in this pallet sequence.')
}

export function syncCursorToGaps(
  config: PalletConfig,
  usedProductNos: Iterable<string>,
): PalletConfig {
  const { nextNum, nextAlpha } = firstAvailableCursor(config, usedProductNos)
  return { ...config, nextNum, nextAlpha }
}

export function advanceCursor(config: PalletConfig): PalletConfig {
  return {
    ...config,
    nextNum: config.numMode === 'seq' ? incrementNum(config.nextNum) : config.nextNum,
    nextAlpha: config.alphaMode === 'seq' ? incrementAlpha(config.nextAlpha) : config.nextAlpha,
  }
}

export function buildPalletConfig(input: {
  numValue: string
  numMode: PartMode
  alphaValue: string
  alphaMode: PartMode
}): PalletConfig {
  const numValue = input.numValue.trim()
  const alphaValue = input.alphaValue.trim().toLowerCase()
  const numErr = validateNumPart(numValue)
  if (numErr) throw new Error(numErr)
  const alphaErr = validateAlphaPart(alphaValue)
  if (alphaErr) throw new Error(alphaErr)
  if (input.numMode === 'fixed' && input.alphaMode === 'fixed') {
    throw new Error('Both parts cannot be Fixed — product codes would collide. Make at least one Sequential.')
  }
  if (input.alphaMode === 'seq' && !alphaValue) {
    throw new Error('Enter starting letters when Letters are Sequential.')
  }
  return {
    palletId: formatProductNo(numValue, alphaValue),
    numValue,
    numMode: input.numMode,
    alphaValue,
    alphaMode: input.alphaMode,
    nextNum: numValue,
    nextAlpha: alphaValue,
  }
}

export function loadPalletConfig(): PalletConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PalletConfig>
    if (!parsed?.nextNum || !parsed.numMode || !parsed.alphaMode || !parsed.numValue) return null
    const alphaValue = parsed.alphaValue ?? ''
    return {
      palletId: parsed.palletId || formatProductNo(parsed.numValue, alphaValue),
      numValue: parsed.numValue,
      numMode: parsed.numMode,
      alphaValue,
      alphaMode: parsed.alphaMode,
      nextNum: parsed.nextNum,
      nextAlpha: parsed.nextAlpha ?? '',
    }
  } catch {
    return null
  }
}

export function savePalletConfig(config: PalletConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Private mode / blocked storage — keep session in memory only
  }
}

export function clearPalletConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
