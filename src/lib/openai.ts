import {
  buildHibidDescription,
  buildTitle,
  DEFAULT_HIBID_DESCRIPTION,
  stripLeadingPrice,
} from './description'
import { compressToJpeg } from './image'
import type { BidStrategy, PalletSource } from '../types'

export type AnalyzeResult = {
  title: string
  description: string
  /** Retail / Reference price — used in Title ($79.99 Name) */
  salePrice: number | null
  bidPrice: number | null
  referenceImageBlob: Blob | null
}

const NOT_FOUND_RESULT: AnalyzeResult = {
  title: '?',
  description: DEFAULT_HIBID_DESCRIPTION,
  salePrice: null,
  bidPrice: null,
  referenceImageBlob: null,
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

function parseJsonText<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const direct = (payload as { output_text?: unknown }).output_text
  if (typeof direct === 'string' && direct.trim()) return direct.trim()

  const output = (payload as {
    output?: Array<{
      content?: Array<{ text?: unknown } | { text?: { value?: unknown } }>
    }>
  }).output

  if (!Array.isArray(output)) return ''

  return output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((part) => {
      if (typeof part.text === 'string') return part.text
      if (part.text && typeof part.text === 'object' && 'value' in part.text) {
        return typeof part.text.value === 'string' ? part.text.value : ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function isAmazonImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return (
      host.includes('amazon.') ||
      host.endsWith('media-amazon.com') ||
      host.endsWith('ssl-images-amazon.com')
    )
  } catch {
    return false
  }
}

async function findAmazonReferenceImage(productName: string, apiKey: string): Promise<Blob | null> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `******
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      tools: [{ type: 'web_search_preview' }],
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Find one Amazon-hosted product image URL for the exact product "${productName}".
Return ONLY valid JSON with this shape:
{"imageUrl":"https://..."}

Rules:
- Use an Amazon-hosted product image URL, preferably m.media-amazon.com.
- Prefer the main product image from an Amazon product result.
- If no reliable Amazon image is found, return {"imageUrl":null}.`,
            },
          ],
        },
      ],
    }),
  })

  if (!res.ok) return null

  const payload = (await res.json()) as unknown
  const raw = extractResponseText(payload)
  if (!raw) return null

  const parsed = parseJsonText<{ imageUrl?: unknown }>(raw)
  const imageUrl = typeof parsed?.imageUrl === 'string' ? parsed.imageUrl.trim() : ''
  if (!imageUrl || !isAmazonImageUrl(imageUrl)) return null

  const imageRes = await fetch(imageUrl)
  if (!imageRes.ok) return null

  const blob = await imageRes.blob()
  if (!blob.size) return null
  return compressToJpeg(blob)
}

function stripAppearsNewUnused(text: string): string {
  return text
    .replace(/\bappears\s+new,?\s*unused\b(?:["')\].,!?]*)\s*$/i, '')
    .replace(/\s+\.$/, '.')
    .trim()
}

function sanitizeProductDescription(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((part) => stripAppearsNewUnused(part.trim()))
    .filter(
      (part) =>
        part &&
        !/^included\s*:/i.test(part) &&
        !/^new,\s*sealed in original packaging\b/i.test(part) &&
        !/^sealed in original packaging\b/i.test(part),
    )
    .join('\n\n')
    .trim()
}

function buildProductDescriptionBody(parsed: { productDescription?: string }): string {
  return sanitizeProductDescription((parsed.productDescription ?? '').trim())
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

const SOURCE_LABEL: Record<PalletSource, string> = {
  amazon: 'Amazon',
  target: 'Target',
  walmart: 'Walmart',
  lowes: 'Lowes',
  homedepot: 'HomeDepot',
}

function buildAnalysisPrompt(source: PalletSource): string {
  const sourceLabel = SOURCE_LABEL[source]
  return `You are an expert US liquidation / open-box auction cataloger for HiBid.
Look at the product photo(s), identify the exact brand and model, then estimate realistic US market prices for THAT product.
The pallet source is ${sourceLabel}. Prioritize matching this product against ${sourceLabel} listings and use ${sourceLabel} as the primary reference when deciding model identity and retailPrice.

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
}

export async function analyzeProductPhotos(
  images: Blob[],
  options?: { bidStrategy?: BidStrategy; source?: PalletSource },
): Promise<AnalyzeResult> {
  if (images.length === 0) throw new Error('No photos to analyze.')
  const apiKey = getApiKey()

  const sample = images.slice(0, 4)
  const dataUrls = await Promise.all(sample.map(blobToDataUrl))

  const source = options?.source ?? 'amazon'
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' } }
  > = [
    { type: 'text', text: buildAnalysisPrompt(source) },
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
  if (!raw) return NOT_FOUND_RESULT

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
    const parsedJson = parseJsonText<typeof parsed>(raw)
    if (!parsedJson) return NOT_FOUND_RESULT
    parsed = parsedJson
  } catch {
    return NOT_FOUND_RESULT
  }

  const retailPrice = resolveRetailPrice(parsed)

  const recommendedBid = parseMoney(parsed.auctionStartBid)
  const aggressiveBid = parseMoney(parsed.aggressiveStartBid)
  const bidPrice =
    options?.bidStrategy === 'recommended'
      ? (recommendedBid ?? aggressiveBid ?? parseMoney(parsed.bidPrice))
      : (aggressiveBid ?? recommendedBid ?? parseMoney(parsed.bidPrice))

  const resolvedProductName = stripLeadingPrice((parsed.productName ?? parsed.name ?? '').trim())
  if (!resolvedProductName) return NOT_FOUND_RESULT
  const productName = resolvedProductName
  const title = buildTitle(productName, retailPrice)

  const detail =
    buildProductDescriptionBody(parsed) || (parsed.detail ?? '').trim()
  if (!detail) return NOT_FOUND_RESULT
  const description = buildHibidDescription(detail, title)

  let referenceImageBlob: Blob | null = null
  if (source === 'amazon') {
    try {
      referenceImageBlob = await findAmazonReferenceImage(productName, apiKey)
    } catch {
      referenceImageBlob = null
    }
  }

  return {
    title,
    description,
    salePrice: retailPrice,
    bidPrice,
    referenceImageBlob,
  }
}
