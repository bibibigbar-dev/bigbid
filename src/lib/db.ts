import { MAX_PHOTOS_PER_PRODUCT, type Product, type ProductInput } from '../types'

type StoredImage = { type: string; data: ArrayBuffer }

type StoredProduct = Omit<Product, 'imageBlobs' | 'sortNo'> & {
  sortNo: string
  images?: StoredImage[]
  imageBlobs?: Blob[]
  imageBlob?: Blob
}

type FallbackRecord = Omit<StoredProduct, 'images' | 'imageBlobs' | 'imageBlob'> & {
  imageTypes: string[]
  imagesB64?: string[]
}

const DB_NAME = 'bigbid'
const DB_VERSION = 4
const META_KEY = 'bigbid.products.v1'
const IMAGE_CACHE = 'bigbid-images-v1'

let dbPromise: Promise<IDBDatabase> | null = null
let forceFallback = false

function newId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    // older Safari
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Property access only — never the bare identifier `indexedDB` (Safari throws). */
function getIdbFactory(): IDBFactory | null {
  try {
    const g = globalThis as typeof globalThis & {
      webkitIndexedDB?: IDBFactory
      mozIndexedDB?: IDBFactory
    }
    const factory = g.indexedDB ?? g.webkitIndexedDB ?? g.mozIndexedDB
    if (factory && typeof factory.open === 'function') return factory
  } catch {
    // private mode / blocked storage
  }
  return null
}

function getCacheStorage(): CacheStorage | null {
  try {
    const api = globalThis.caches
    if (api && typeof api.open === 'function') return api
  } catch {
    // ignore
  }
  return null
}

function shouldUseFallback(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /indexedDB|IDBFactory|IDBOpenDBRequest|Can't find variable|Cannot find variable|not available|SecurityError/i.test(
    msg,
  )
}

function idbErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Save failed. Try again.'
  const name = (err as DOMException).name || err.name
  if (name === 'QuotaExceededError' || /quota/i.test(err.message)) {
    return 'Storage full. Delete some lots or free phone storage, then try again.'
  }
  if (name === 'ConstraintError') {
    return 'This lot number already exists. Go back and capture again.'
  }
  if (shouldUseFallback(err)) {
    return 'Phone storage is blocked. Turn off Private mode / allow cookies for this site, then refresh.'
  }
  return err.message || 'Save failed. Try again.'
}

async function blobsToStored(blobs: Blob[]): Promise<StoredImage[]> {
  return Promise.all(
    blobs.map(async (blob) => ({
      type: blob.type || 'image/jpeg',
      data: await blob.arrayBuffer(),
    })),
  )
}

function storedToBlobs(images: StoredImage[] | undefined, legacy?: Blob[]): Blob[] {
  if (images && images.length > 0) {
    return images.map((img) => new Blob([img.data], { type: img.type || 'image/jpeg' }))
  }
  return legacy ?? []
}

function normalizeProduct(raw: StoredProduct): Product {
  const productNo = String(raw.productNo ?? '')
  const legacyBlobs =
    raw.imageBlobs && raw.imageBlobs.length > 0
      ? raw.imageBlobs
      : raw.imageBlob
        ? [raw.imageBlob]
        : []
  return {
    id: raw.id,
    productNo,
    sortNo: String(raw.sortNo ?? productNo),
    name: raw.name ?? '',
    description: raw.description ?? '',
    titleSourceUrl: typeof raw.titleSourceUrl === 'string' ? raw.titleSourceUrl : null,
    descriptionSourceUrl:
      typeof raw.descriptionSourceUrl === 'string' ? raw.descriptionSourceUrl : null,
    salePrice: raw.salePrice ?? null,
    bidPrice: raw.bidPrice ?? null,
    imageBlobs: storedToBlobs(raw.images, legacyBlobs),
    aiFillStatus:
      raw.aiFillStatus === 'pending' || raw.aiFillStatus === 'failed'
        ? raw.aiFillStatus
        : 'completed',
    aiFillError: typeof raw.aiFillError === 'string' ? raw.aiFillError : null,
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
  }
}

function normalizeProductNo(value: string): string {
  const productNo = value.trim()
  if (!productNo) throw new Error('Lot number is required.')
  return productNo
}

function normalizeSortNo(value: string): string {
  const sortNo = value.replace(/\D/g, '')
  if (!sortNo) throw new Error('Sale order must include at least one digit.')
  return sortNo
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Storage request failed.'))
  })
}

function waitForTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Storage transaction failed.'))
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted.'))
  })
}

function upgradeDb(db: IDBDatabase, tx: IDBTransaction) {
  if (!db.objectStoreNames.contains('products')) {
    const store = db.createObjectStore('products', { keyPath: 'id' })
    store.createIndex('by-productNo', 'productNo', { unique: true })
    return
  }
  const store = tx.objectStore('products')
  for (const name of ['by-sort', 'by-created']) {
    try {
      if (store.indexNames.contains(name)) store.deleteIndex(name)
    } catch {
      // index may not exist
    }
  }
  if (!store.indexNames.contains('by-productNo')) {
    store.createIndex('by-productNo', 'productNo', { unique: true })
  }
}

function openWithFactory(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(err)
      return
    }
    request.onupgradeneeded = () => {
      if (request.result && request.transaction) {
        upgradeDb(request.result, request.transaction)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'))
    request.onblocked = () => {
      console.warn('Database upgrade blocked — close other tabs of this app.')
    }
  })
}

function deleteWithFactory(factory: IDBFactory): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = factory.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function openFreshDb(): Promise<IDBDatabase> {
  const factory = getIdbFactory()
  if (!factory) throw new Error("Can't find variable: indexedDB")
  return openWithFactory(factory)
}

async function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openFreshDb().catch(async (err) => {
      console.warn('IndexedDB open failed, recreating database', err)
      dbPromise = null
      const factory = getIdbFactory()
      if (factory) await deleteWithFactory(factory)
      dbPromise = openFreshDb()
      return dbPromise
    })
  }
  return dbPromise
}

function resetDbConnection() {
  dbPromise = null
}

async function storeGetAll(store: IDBObjectStore): Promise<StoredProduct[]> {
  if (typeof store.getAll === 'function') {
    return (await reqToPromise(store.getAll())) as StoredProduct[]
  }
  return new Promise((resolve, reject) => {
    const out: StoredProduct[] = []
    const cursorReq = store.openCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (cursor) {
        out.push(cursor.value as StoredProduct)
        cursor.continue()
      } else {
        resolve(out)
      }
    }
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error('Read failed.'))
  })
}

async function idbGetByProductNo(db: IDBDatabase, productNo: string): Promise<StoredProduct | undefined> {
  const readAll = async () => {
    const tx = db.transaction('products', 'readonly')
    const all = await storeGetAll(tx.objectStore('products'))
    await waitForTx(tx)
    return all.find((p) => p.productNo === productNo)
  }

  try {
    const tx = db.transaction('products', 'readonly')
    const store = tx.objectStore('products')
    if (!store.indexNames.contains('by-productNo')) {
      const all = await storeGetAll(store)
      await waitForTx(tx)
      return all.find((p) => p.productNo === productNo)
    }
    const found = (await reqToPromise(store.index('by-productNo').get(productNo))) as
      | StoredProduct
      | undefined
    await waitForTx(tx)
    return found
  } catch {
    return readAll()
  }
}

function bufferToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chunk = 0x2000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function imageUrl(id: string, index: number): string {
  return `https://bigbid.local/lot-image/${encodeURIComponent(id)}/${index}`
}

function readMeta(): FallbackRecord[] {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FallbackRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeMeta(list: FallbackRecord[]) {
  localStorage.setItem(META_KEY, JSON.stringify(list))
}

async function saveFallbackImages(id: string, images: StoredImage[]): Promise<Pick<FallbackRecord, 'imageTypes' | 'imagesB64'>> {
  const imageTypes = images.map((img) => img.type || 'image/jpeg')
  const cachesApi = getCacheStorage()
  if (cachesApi) {
    try {
      const cache = await cachesApi.open(IMAGE_CACHE)
      await Promise.all(
        images.map((img, i) =>
          cache.put(
            imageUrl(id, i),
            new Response(img.data, { headers: { 'Content-Type': img.type || 'image/jpeg' } }),
          ),
        ),
      )
      return { imageTypes }
    } catch (err) {
      console.warn('Cache storage failed, using localStorage images', err)
    }
  }
  return {
    imageTypes,
    imagesB64: images.map((img) => bufferToB64(img.data)),
  }
}

async function loadFallbackImages(record: FallbackRecord): Promise<StoredImage[]> {
  if (record.imagesB64?.length) {
    return record.imagesB64.map((b64, i) => ({
      type: record.imageTypes[i] || 'image/jpeg',
      data: b64ToBuffer(b64),
    }))
  }
  const cachesApi = getCacheStorage()
  if (!cachesApi) return []
  try {
    const cache = await cachesApi.open(IMAGE_CACHE)
    const images: StoredImage[] = []
    for (let i = 0; i < record.imageTypes.length; i += 1) {
      const res = await cache.match(imageUrl(record.id, i))
      if (!res) continue
      images.push({
        type: record.imageTypes[i] || 'image/jpeg',
        data: await res.arrayBuffer(),
      })
    }
    return images
  } catch {
    return []
  }
}

async function deleteFallbackImages(id: string, count: number) {
  const cachesApi = getCacheStorage()
  if (!cachesApi) return
  try {
    const cache = await cachesApi.open(IMAGE_CACHE)
    await Promise.all(Array.from({ length: count }, (_, i) => cache.delete(imageUrl(id, i))))
  } catch {
    // ignore
  }
}

async function fallbackHydrate(record: FallbackRecord): Promise<StoredProduct> {
  const images = await loadFallbackImages(record)
  return { ...record, images }
}

async function fallbackList(): Promise<StoredProduct[]> {
  const records = readMeta()
  return Promise.all(records.map((r) => fallbackHydrate(r)))
}

async function fallbackGet(id: string): Promise<StoredProduct | undefined> {
  const record = readMeta().find((r) => r.id === id)
  return record ? fallbackHydrate(record) : undefined
}

async function fallbackAdd(stored: StoredProduct): Promise<void> {
  const list = readMeta()
  if (list.some((r) => r.productNo === stored.productNo)) {
    throw new Error(`Product number ${stored.productNo} already exists.`)
  }
  const images = stored.images ?? []
  const imageFields = await saveFallbackImages(stored.id, images)
  list.push({
    id: stored.id,
    productNo: stored.productNo,
    sortNo: stored.sortNo,
    name: stored.name,
    description: stored.description,
    titleSourceUrl: stored.titleSourceUrl,
    descriptionSourceUrl: stored.descriptionSourceUrl,
    salePrice: stored.salePrice,
    bidPrice: stored.bidPrice,
    aiFillStatus: stored.aiFillStatus,
    aiFillError: stored.aiFillError,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    ...imageFields,
  })
  writeMeta(list)
}

async function fallbackPut(stored: StoredProduct): Promise<void> {
  const list = readMeta()
  const idx = list.findIndex((r) => r.id === stored.id)
  if (idx < 0) throw new Error('Product not found.')
  const clash = list.find((r) => r.productNo === stored.productNo && r.id !== stored.id)
  if (clash) throw new Error(`Product number ${stored.productNo} already exists.`)
  await deleteFallbackImages(stored.id, list[idx].imageTypes.length)
  const imageFields = await saveFallbackImages(stored.id, stored.images ?? [])
  list[idx] = {
    id: stored.id,
    productNo: stored.productNo,
    sortNo: stored.sortNo,
    name: stored.name,
    description: stored.description,
    titleSourceUrl: stored.titleSourceUrl,
    descriptionSourceUrl: stored.descriptionSourceUrl,
    salePrice: stored.salePrice,
    bidPrice: stored.bidPrice,
    aiFillStatus: stored.aiFillStatus,
    aiFillError: stored.aiFillError,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    ...imageFields,
  }
  writeMeta(list)
}

async function fallbackDelete(id: string): Promise<void> {
  const list = readMeta()
  const found = list.find((r) => r.id === id)
  if (found) await deleteFallbackImages(id, found.imageTypes.length)
  writeMeta(list.filter((r) => r.id !== id))
}

async function fallbackDeleteMany(ids: string[]): Promise<void> {
  const remove = new Set(ids)
  const list = readMeta()
  await Promise.all(
    list.filter((r) => remove.has(r.id)).map((r) => deleteFallbackImages(r.id, r.imageTypes.length)),
  )
  writeMeta(list.filter((r) => !remove.has(r.id)))
}

async function fallbackClear(): Promise<void> {
  const list = readMeta()
  await Promise.all(list.map((r) => deleteFallbackImages(r.id, r.imageTypes.length)))
  try {
    localStorage.removeItem(META_KEY)
  } catch {
    // ignore
  }
}

async function runStore<T>(op: {
  idb: () => Promise<T>
  fallback: () => Promise<T>
}): Promise<T> {
  if (forceFallback || !getIdbFactory()) {
    forceFallback = true
    return op.fallback()
  }
  try {
    return await op.idb()
  } catch (err) {
    if (!shouldUseFallback(err)) throw err
    console.warn('IndexedDB unavailable, using local fallback', err)
    forceFallback = true
    resetDbConnection()
    return op.fallback()
  }
}

export async function listProducts(): Promise<Product[]> {
  try {
    const all = await runStore({
      idb: async () => {
        const db = await getDb()
        const tx = db.transaction('products', 'readonly')
        const allRows = await storeGetAll(tx.objectStore('products'))
        await waitForTx(tx)
        return allRows
      },
      fallback: fallbackList,
    })
    return all.map((p) => normalizeProduct(p)).sort((a, b) => a.createdAt - b.createdAt)
  } catch (err) {
    resetDbConnection()
    if (shouldUseFallback(err)) {
      forceFallback = true
      const all = await fallbackList()
      return all.map((p) => normalizeProduct(p)).sort((a, b) => a.createdAt - b.createdAt)
    }
    throw new Error(idbErrorMessage(err))
  }
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const raw = await runStore({
    idb: async () => {
      const db = await getDb()
      const tx = db.transaction('products', 'readonly')
      const value = (await reqToPromise(tx.objectStore('products').get(id))) as StoredProduct | undefined
      await waitForTx(tx)
      return value
    },
    fallback: () => fallbackGet(id),
  })
  return raw ? normalizeProduct(raw) : undefined
}

function buildStored(input: ProductInput, images: StoredImage[], id = newId(), createdAt = Date.now()): StoredProduct {
  const productNo = normalizeProductNo(input.productNo)
  const sortNo = normalizeSortNo(input.sortNo)
  return {
    id,
    productNo,
    sortNo,
    name: input.name,
    description: input.description,
    titleSourceUrl: input.titleSourceUrl ?? null,
    descriptionSourceUrl: input.descriptionSourceUrl ?? null,
    salePrice: input.salePrice,
    bidPrice: input.bidPrice,
    images,
    aiFillStatus: input.aiFillStatus ?? 'completed',
    aiFillError: input.aiFillError ?? null,
    createdAt,
    updatedAt: Date.now(),
  }
}

export async function addProduct(input: ProductInput): Promise<Product> {
  if (!input.imageBlobs.length) {
    throw new Error('At least one photo is required.')
  }
  if (input.imageBlobs.length > MAX_PHOTOS_PER_PRODUCT) {
    throw new Error(`Maximum ${MAX_PHOTOS_PER_PRODUCT} photos per product.`)
  }

  const images = await blobsToStored(input.imageBlobs)
  const stored = buildStored(input, images)

  try {
    await runStore({
      idb: async () => {
        const db = await getDb()
        const existing = await idbGetByProductNo(db, stored.productNo)
        if (existing) throw new Error(`Product number ${stored.productNo} already exists.`)
        const tx = db.transaction('products', 'readwrite')
        tx.objectStore('products').add(stored)
        await waitForTx(tx)
      },
      fallback: () => fallbackAdd(stored),
    })
    return normalizeProduct(stored)
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) throw err
    resetDbConnection()
    try {
      forceFallback = true
      await fallbackAdd(stored)
      return normalizeProduct(stored)
    } catch (err2) {
      throw new Error(idbErrorMessage(err2))
    }
  }
}

export async function updateProduct(
  id: string,
  patch: Partial<Omit<Product, 'id' | 'createdAt' | 'imageBlobs'>> & {
    imageBlobs?: Blob[]
  },
): Promise<Product> {
  try {
    const existingRaw = await runStore({
      idb: async () => {
        const db = await getDb()
        const tx = db.transaction('products', 'readonly')
        const value = (await reqToPromise(tx.objectStore('products').get(id))) as StoredProduct | undefined
        await waitForTx(tx)
        return value
      },
      fallback: () => fallbackGet(id),
    })
    if (!existingRaw) throw new Error('Product not found.')
    const existing = normalizeProduct(existingRaw)
    if (patch.imageBlobs && patch.imageBlobs.length > MAX_PHOTOS_PER_PRODUCT) {
      throw new Error(`Maximum ${MAX_PHOTOS_PER_PRODUCT} photos per product.`)
    }
    const productNo = patch.productNo ?? existing.productNo
    const sortNo = patch.sortNo !== undefined ? normalizeSortNo(patch.sortNo) : existing.sortNo
    const normalizedProductNo = normalizeProductNo(productNo)
    if (normalizedProductNo !== existing.productNo) {
      const clash = await runStore({
        idb: async () => {
          const db = await getDb()
          return idbGetByProductNo(db, normalizedProductNo)
        },
        fallback: async () => {
          const all = await fallbackList()
          return all.find((p) => p.productNo === normalizedProductNo)
        },
      })
      if (clash && clash.id !== id) {
        throw new Error(`Product number ${normalizedProductNo} already exists.`)
      }
    }

    const images = patch.imageBlobs
      ? await blobsToStored(patch.imageBlobs)
      : existingRaw.images ?? (await blobsToStored(existing.imageBlobs))

    const stored: StoredProduct = {
      id,
      productNo: normalizedProductNo,
      sortNo,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      titleSourceUrl:
        patch.titleSourceUrl !== undefined ? patch.titleSourceUrl : existing.titleSourceUrl,
      descriptionSourceUrl:
        patch.descriptionSourceUrl !== undefined
          ? patch.descriptionSourceUrl
          : existing.descriptionSourceUrl,
      salePrice: patch.salePrice !== undefined ? patch.salePrice : existing.salePrice,
      bidPrice: patch.bidPrice !== undefined ? patch.bidPrice : existing.bidPrice,
      images,
      aiFillStatus: patch.aiFillStatus ?? existing.aiFillStatus,
      aiFillError: patch.aiFillError !== undefined ? patch.aiFillError : existing.aiFillError,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }

    await runStore({
      idb: async () => {
        const db = await getDb()
        const tx = db.transaction('products', 'readwrite')
        tx.objectStore('products').put(stored)
        await waitForTx(tx)
      },
      fallback: () => fallbackPut(stored),
    })
    return normalizeProduct(stored)
  } catch (err) {
    if (err instanceof Error && /already exists|not found/i.test(err.message)) throw err
    throw new Error(idbErrorMessage(err))
  }
}

export async function deleteProduct(id: string): Promise<void> {
  await runStore({
    idb: async () => {
      const db = await getDb()
      const tx = db.transaction('products', 'readwrite')
      tx.objectStore('products').delete(id)
      await waitForTx(tx)
    },
    fallback: () => fallbackDelete(id),
  })
}

export async function deleteProducts(ids: string[]): Promise<void> {
  await runStore({
    idb: async () => {
      const db = await getDb()
      const tx = db.transaction('products', 'readwrite')
      for (const id of ids) tx.objectStore('products').delete(id)
      await waitForTx(tx)
    },
    fallback: () => fallbackDeleteMany(ids),
  })
}

export async function clearAllProducts(): Promise<void> {
  await runStore({
    idb: async () => {
      const db = await getDb()
      const tx = db.transaction('products', 'readwrite')
      tx.objectStore('products').clear()
      await waitForTx(tx)
    },
    fallback: fallbackClear,
  })
}

export async function estimateStorage(): Promise<{ usage: number; quota: number }> {
  try {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate()
      return { usage, quota }
    }
  } catch {
    // ignore
  }
  return { usage: 0, quota: 0 }
}
