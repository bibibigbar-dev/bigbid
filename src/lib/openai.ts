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
  titleSourceUrl: string | null
  descriptionSourceUrl: string | null
  /** Retail / Reference price — used in Title ($79.99 Name) */
  salePrice: number | null
  bidPrice: number | null
  referenceImageBlobs: Blob[]
  referenceImageWarning: string | null
}

const NOT_FOUND_RESULT: AnalyzeResult = {
  title: '?',
  description: DEFAULT_HIBID_DESCRIPTION,
  titleSourceUrl: null,
  descriptionSourceUrl: null,
  salePrice: null,
  bidPrice: null,
  referenceImageBlobs: [],
  referenceImageWarning: null,
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

function isDomainOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

type SourceValidationRule = {
  productPage: RegExp
  productHosts: string[]
  productHostPattern?: RegExp
  imageHosts: string[]
}

const SOURCE_VALIDATION: Record<PalletSource, SourceValidationRule> = {
  amazon: {
    productPage: /\/(dp|gp\/product)\/[a-z0-9]{10}(?:[/?]|$)/i,
    productHosts: ['amazon.com'],
    productHostPattern: /^([a-z0-9-]+\.)*amazon\.[a-z.]+$/,
    imageHosts: ['m.media-amazon.com', 'media-amazon.com', 'ssl-images-amazon.com'],
  },
  target: {
    productPage: /\/p\/.+/i,
    productHosts: ['target.com'],
    imageHosts: ['target.scene7.com', 'target.com'],
  },
  walmart: {
    productPage: /\/ip\/.+/i,
    productHosts: ['walmart.com'],
    imageHosts: ['i5.walmartimages.com', 'walmartimages.com', 'walmart.com'],
  },
  lowes: {
    productPage: /\/pd\/.+/i,
    productHosts: ['lowes.com'],
    imageHosts: ['mobileimages.lowes.com', 'lowes.com'],
  },
  homedepot: {
    productPage: /\/p\/.+/i,
    productHosts: ['homedepot.com'],
    imageHosts: ['images.thdstatic.com', 'homedepot-static.com', 'homedepot.com'],
  },
}

function isAllowedImageUrl(value: string, source: PalletSource): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    const hosts = SOURCE_VALIDATION[source].imageHosts
    return hosts.some((domain) => isDomainOrSubdomain(host, domain))
  } catch {
    return false
  }
}

function isValidProductPageUrl(value: string, source: PalletSource): boolean {
  try {
    const rule = SOURCE_VALIDATION[source]
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    const hostAllowed =
      rule.productHosts.some((domain) => isDomainOrSubdomain(host, domain)) ||
      (rule.productHostPattern ? rule.productHostPattern.test(host) : false)
    if (!hostAllowed) return false
    return rule.productPage.test(url.pathname.toLowerCase())
  } catch {
    return false
  }
}

type ReferenceSearchResult = {
  pageUrl: string
  imageUrl?: string
}

function parsePrimaryPageUrl(raw: string): string {
  const parsed = parseJsonText<{
    pageUrl?: unknown
    results?: Array<{ pageUrl?: unknown }>
  }>(raw)
  if (typeof parsed?.pageUrl === 'string') return parsed.pageUrl
  if (Array.isArray(parsed?.results)) {
    const first = parsed.results.find((item) => typeof item?.pageUrl === 'string')
    if (typeof first?.pageUrl === 'string') return first.pageUrl
  }
  return ''
}

function parseReferenceSearchResult(raw: string): ReferenceSearchResult[] {
  const parsed = parseJsonText<{
    pageUrl?: unknown
    imageUrl?: unknown
    results?: Array<{ pageUrl?: unknown; imageUrl?: unknown }>
  }>(raw)
  if (!parsed) return []
  const single =
    typeof parsed.pageUrl === 'string'
      ? [
          {
            pageUrl: parsed.pageUrl,
            imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : undefined,
          },
        ]
      : []
  const listed = Array.isArray(parsed.results)
    ? parsed.results
        .map((item) => ({
          pageUrl: typeof item.pageUrl === 'string' ? item.pageUrl : '',
          imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : undefined,
        }))
        .filter((item) => item.pageUrl)
    : []
  return [...single, ...listed]
}

async function resolveHeroImageUrl(
  pageUrl: string,
  source: PalletSource,
  apiKey: string,
): Promise<string> {
  const sourceLabel = SOURCE_LABEL[source]
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
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
              text: `Open this ${sourceLabel} product detail page and return ONLY valid JSON with this shape:
{"imageUrl":"https://..."}

Page:
${pageUrl}

Rules:
- imageUrl must be the main/primary product hero image from this exact page.
- Use the first gallery image for the product, not thumbnails, review photos, lifestyle photos, alternates, collages, or variation swatches.
- imageUrl must be hosted on the retailer's own image CDN for this page.
- If no reliable hero image is available, return {"imageUrl":""}.`,
            },
          ],
        },
      ],
    }),
  })

  if (!res.ok) return ''

  const payload = (await res.json()) as unknown
  const raw = extractResponseText(payload)
  if (!raw) return ''

  const parsed = parseJsonText<{ imageUrl?: unknown }>(raw)
  return typeof parsed?.imageUrl === 'string' ? parsed.imageUrl : ''
}

async function resolveReferenceImageUrl(
  candidate: ReferenceSearchResult,
  source: PalletSource,
  apiKey: string,
): Promise<string> {
  if (source === 'amazon' || !isAllowedImageUrl(candidate.imageUrl ?? '', source)) {
    const resolved = await resolveHeroImageUrl(candidate.pageUrl, source, apiKey)
    if (isAllowedImageUrl(resolved, source)) return resolved
  }

  return isAllowedImageUrl(candidate.imageUrl ?? '', source) ? (candidate.imageUrl ?? '') : ''
}

async function resolveReferenceImageUrls(
  candidates: ReferenceSearchResult[],
  source: PalletSource,
  apiKey: string,
): Promise<string[]> {
  const concurrency = 2
  const results = new Array<string>(candidates.length).fill('')
  let nextIndex = 0

  async function worker() {
    while (nextIndex < candidates.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      try {
        results[currentIndex] = await resolveReferenceImageUrl(
          candidates[currentIndex],
          source,
          apiKey,
        )
      } catch {
        results[currentIndex] = ''
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, candidates.length)) }, () => worker()),
  )
  return results
}

async function findReferenceImages(
  productName: string,
  source: PalletSource,
  count: number,
  apiKey: string,
): Promise<{ blobs: Blob[]; warning: string | null; pageUrls: string[] }> {
  const sourceLabel = SOURCE_LABEL[source]
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
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
              text: `Find up to ${count} best-matching ${sourceLabel} product detail pages for "${productName}" and return each page's main hero image.
Return ONLY valid JSON with this shape:
{"results":[{"pageUrl":"https://...","imageUrl":"https://..."}]}

Rules:
- pageUrl must be a ${sourceLabel} product detail page URL for the exact item.
- imageUrl must be the main/primary product image from that same page.
- Return only hero images, never thumbnails, collages, review photos, lifestyle alternates, or variation swatches.
- Return at most ${count} items in results.
- If no reliable match is found, return {"results":[]}.`,
            },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    return {
      blobs: [],
      warning: `${sourceLabel} reference photo search failed (${res.status}).`,
      pageUrls: [],
    }
  }

  const payload = (await res.json()) as unknown
  const raw = extractResponseText(payload)
  if (!raw) {
    return {
      blobs: [],
      warning: `${sourceLabel} reference photo search returned empty response.`,
      pageUrls: [],
    }
  }

  const seenPageUrls = new Set<string>()
  const candidates = parseReferenceSearchResult(raw)
    .filter((item) => isValidProductPageUrl(item.pageUrl, source))
    .filter((item) => {
      if (seenPageUrls.has(item.pageUrl)) return false
      seenPageUrls.add(item.pageUrl)
      return true
    })
    .slice(0, count)
  if (!candidates.length) {
    return {
      blobs: [],
      warning: `${sourceLabel} reference photo search found no valid product-page matches.`,
      pageUrls: [],
    }
  }

  const blobs: Blob[] = []
  const seenImageUrls = new Set<string>()
  const resolvedImageUrls = await resolveReferenceImageUrls(candidates, source, apiKey)
  for (const imageUrl of resolvedImageUrls) {
    if (blobs.length >= count) break
    try {
      if (!imageUrl || seenImageUrls.has(imageUrl)) continue
      seenImageUrls.add(imageUrl)
      const imageRes = await fetch(imageUrl)
      if (!imageRes.ok) continue
      if (!isAllowedImageUrl(imageRes.url, source)) continue
      const blob = await imageRes.blob()
      if (!blob.size) continue
      blobs.push(await compressToJpeg(blob))
    } catch {
      continue
    }
  }
  if (!blobs.length) {
    return {
      blobs: [],
      warning: `${sourceLabel} images were found but blocked while downloading (CORS or retailer anti-bot).`,
      pageUrls: candidates.map((item) => item.pageUrl),
    }
  }
  return {
    blobs,
    warning:
      blobs.length < count
        ? `${sourceLabel} reference photos: ${blobs.length}/${count} added (some images could not be downloaded).`
        : null,
    pageUrls: candidates.map((item) => item.pageUrl),
  }
}

async function findSourcePageUrl(
  productName: string,
  source: PalletSource,
  apiKey: string,
): Promise<string> {
  const sourceLabel = SOURCE_LABEL[source]
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
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
              text: `Find the single best-matching ${sourceLabel} product detail page for "${productName}".
Return ONLY valid JSON with this shape:
{"pageUrl":"https://..."}

Rules:
- pageUrl must be a valid ${sourceLabel} product detail URL for this item.
- If there is no reliable match, return {"pageUrl":""}.`,
            },
          ],
        },
      ],
    }),
  })

  if (!res.ok) return ''
  const payload = (await res.json()) as unknown
  const raw = extractResponseText(payload)
  if (!raw) return ''
  const pageUrl = parsePrimaryPageUrl(raw).trim()
  return isValidProductPageUrl(pageUrl, source) ? pageUrl : ''
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
  options?: {
    bidStrategy?: BidStrategy
    source?: PalletSource
    referencePhotoEnabled?: boolean
    referencePhotoCount?: 1 | 2 | 3 | 4
  },
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
      Authorization: 'Bearer ' + apiKey,
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
  const aiBidPrice =
    options?.bidStrategy === 'recommended'
      ? (recommendedBid ?? aggressiveBid ?? parseMoney(parsed.bidPrice))
      : (aggressiveBid ?? recommendedBid ?? parseMoney(parsed.bidPrice))
  const bidPrice = retailPrice == null ? 5 : aiBidPrice

  const resolvedProductName = stripLeadingPrice((parsed.productName ?? parsed.name ?? '').trim())
  if (!resolvedProductName) return NOT_FOUND_RESULT
  const productName = resolvedProductName
  const title = buildTitle(productName, retailPrice)

  const detail =
    buildProductDescriptionBody(parsed) || (parsed.detail ?? '').trim()
  if (!detail) return NOT_FOUND_RESULT
  const description = buildHibidDescription(detail, title)

  let referenceImageBlobs: Blob[] = []
  let referenceImageWarning: string | null = null
  let sourcePageUrl = ''
  const referencePhotoEnabled = options?.referencePhotoEnabled !== false
  const referencePhotoCount = options?.referencePhotoCount ?? 1
  if (referencePhotoEnabled) {
    try {
      const result = await findReferenceImages(productName, source, referencePhotoCount, apiKey)
      referenceImageBlobs = result.blobs
      referenceImageWarning = result.warning
      sourcePageUrl = result.pageUrls[0] ?? ''
    } catch {
      referenceImageBlobs = []
      referenceImageWarning = `${SOURCE_LABEL[source]} reference photo lookup failed.`
    }
  }
  if (!sourcePageUrl) {
    try {
      sourcePageUrl = await findSourcePageUrl(productName, source, apiKey)
    } catch {
      sourcePageUrl = ''
    }
  }

  return {
    title,
    description,
    titleSourceUrl: sourcePageUrl || null,
    descriptionSourceUrl: sourcePageUrl || null,
    salePrice: retailPrice,
    bidPrice,
    referenceImageBlobs,
    referenceImageWarning,
  }
}
