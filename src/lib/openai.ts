import { buildHibidDescription, buildTitle, stripLeadingPrice } from './description'
import type { BidStrategy } from '../types'

export type AnalyzeResult = {
  title: string
  description: string
  /** Retail / Reference price — used in Title ($79.99 Name) */
  salePrice: number | null
  bidPrice: number | null
}

function getApiKey(): string {
  const key = import.meta.env.VITE_OPENAI_API_KEY as string | undefined
  if (!key?.trim()) {
    throw new Error(
      'Missing OpenAI API key. Add VITE_OPENAI_API_KEY to bigbid/.env.local then restart the dev server.',
    )
  }
  return key.trim()
}

/** Convert image blob to a data URL without FileReader (some mobile WebViews lack it). */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  const base64 = btoa(binary)
  const mime = blob.type || 'image/jpeg'
  return `data:${mime};base64,${base64}`
}

function parseMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const m = value.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
    if (!m) return null
    const n = Number(m[1])
    return Number.isFinite(n) ? n : null
  }
  return null
}

function stripAppearsNewUnused(text: string): string {
  return text
    .replace(/\bappears\s+new,?\s*unused\b[.!]?\s*$/i, '')
    .replace(/\s+\.$/, '.')
    .trim()
}

function buildProductDescriptionBody(parsed: {
  productDescription?: string
  included?: string
  conditionNotes?: string
}): string {
  const parts: string[] = []
  const desc = stripAppearsNewUnused((parsed.productDescription ?? '').trim())
  if (desc) parts.push(desc)

  const included = stripAppearsNewUnused((parsed.included ?? '').trim())
  if (included) parts.push(`Included: ${included}`)

  const notes = stripAppearsNewUnused((parsed.conditionNotes ?? '').trim())
  if (notes) parts.push(notes)

  if (parts.length === 0) return ''
  return parts.join('\n\n')
}

/**
 * Use AI retail/MSRP only. Do not invent retail from open-box multipliers
 * (that locked wrong low prices when the model also under-estimated open-box).
 */
function resolveRetailPrice(parsed: {
  retailPrice?: unknown
  retailReferencePrice?: unknown
  msrp?: unknown
  openBoxHigh?: unknown
}): number | null {
  const retail =
    parseMoney(parsed.retailPrice) ??
    parseMoney(parsed.retailReferencePrice) ??
    parseMoney(parsed.msrp)

  const openBoxHigh = parseMoney(parsed.openBoxHigh)
  if (retail != null && openBoxHigh != null && retail < openBoxHigh) {
    // Model swapped fields — prefer the higher as retail reference
    return openBoxHigh
  }
  return retail
}

const ANALYSIS_PROMPT = `You are an expert US liquidation / open-box auction cataloger for HiBid.
Look at the product photo(s), identify the exact brand and model, then estimate realistic US market prices for THAT product.

Return ONLY valid JSON with these keys:
- productName (string): brand + model, NO dollar amounts
- category (string)
- retailPrice (number|null): NEW-item Retail/Reference/MSRP (Amazon/Target/brand site typical new price)
- openBoxLow (number|null)
- openBoxHigh (number|null)
- quickSalePrice (number|null)
- auctionStartBid (number|null)
- aggressiveStartBid (number|null)
- minAcceptPrice (number|null)
- included (string)
- conditionNotes (string)
- productDescription (string): features + buyer copy for under *Description
- priceBasis (string): one short note on how you got retailPrice (e.g. "Spectra S1 typical new ~$200-230")

CRITICAL pricing rules:
- retailPrice must be the typical NEW retail for this exact model — NOT open-box, NOT auction start.
- Do NOT copy any example numbers. There are NO default prices. Every product has its own market price.
- Examples of correct thinking (do not output these as answers unless the photo matches):
  · Spectra S1 / S2 breast pump new retail is usually about $200–$230, not under $100
  · Many small space heaters are ~$50–$90 new
  · Premium headphones can be $200–$400+ new
- If you recognize a well-known model, use your knowledge of US new retail for that model.
- If a price is printed on the packaging, prefer the printed MSRP when it looks like retail.
- retailPrice should normally be higher than openBoxHigh.
- auctionStartBid / aggressiveStartBid are small starting bids for liquidation (often $5–$25), never use those as retailPrice.
- If unsure of retail, set retailPrice to null rather than guessing a generic $79.99.

Money fields must be numbers (not "$200"). Unknown → null. JSON only.`

export async function analyzeProductPhotos(
  images: Blob[],
  options?: { bidStrategy?: BidStrategy },
): Promise<AnalyzeResult> {
  if (images.length === 0) throw new Error('No photos to analyze.')
  const apiKey = getApiKey()

  const sample = images.slice(0, 4)
  const dataUrls = await Promise.all(sample.map(blobToDataUrl))

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' } }
  > = [
    { type: 'text', text: ANALYSIS_PROMPT },
    ...dataUrls.map((url) => ({
      type: 'image_url' as const,
      image_url: { url, detail: 'high' as const },
    })),
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // Better product/price knowledge than mini for brand/model MSRP
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI error (${res.status}): ${text.slice(0, 240)}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = json.choices?.[0]?.message?.content
  if (!raw) throw new Error('OpenAI returned an empty response.')

  let parsed: {
    productName?: string
    name?: string
    retailPrice?: unknown
    retailReferencePrice?: unknown
    msrp?: unknown
    openBoxHigh?: unknown
    openBoxLow?: unknown
    quickSalePrice?: unknown
    auctionStartBid?: unknown
    aggressiveStartBid?: unknown
    bidPrice?: unknown
    included?: string
    conditionNotes?: string
    productDescription?: string
    detail?: string
  }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new Error('Failed to parse OpenAI JSON.')
  }

  const retailPrice = resolveRetailPrice(parsed)

  const recommendedBid = parseMoney(parsed.auctionStartBid)
  const aggressiveBid = parseMoney(parsed.aggressiveStartBid)
  const bidPrice =
    options?.bidStrategy === 'recommended'
      ? (recommendedBid ?? aggressiveBid ?? parseMoney(parsed.bidPrice))
      : (aggressiveBid ?? recommendedBid ?? parseMoney(parsed.bidPrice))

  const productName =
    stripLeadingPrice((parsed.productName ?? parsed.name ?? '').trim()) ||
    'Untitled item'
  const title = buildTitle(productName, retailPrice)

  const detail =
    buildProductDescriptionBody(parsed) || (parsed.detail ?? '').trim()
  const description = buildHibidDescription(detail, title)

  return {
    title,
    description,
    salePrice: retailPrice,
    bidPrice,
  }
}
