import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Product, ProductInput } from '../types'

type StoredImage = { type: string; data: ArrayBuffer }

type StoredProduct = Omit<Product, 'imageBlobs' | 'sortNo'> & {
  sortNo: string
  /** Preferred mobile-safe image storage */
  images?: StoredImage[]
  /** Legacy fields */
  imageBlobs?: Blob[]
  imageBlob?: Blob
}

interface BigbidDB extends DBSchema {
  products: {
    key: string
    value: StoredProduct
    indexes: { 'by-productNo': string }
  }
}

const DB_NAME = 'bigbid'
const DB_VERSION = 4

let dbPromise: Promise<IDBPDatabase<BigbidDB>> | null = null

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
    sortNo: productNo,
    name: raw.name ?? '',
    description: raw.description ?? '',
    salePrice: raw.salePrice ?? null,
    bidPrice: raw.bidPrice ?? null,
    imageBlobs: storedToBlobs(raw.images, legacyBlobs),
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
  }
}

function idbErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'IndexedDB save failed.'
  const name = (err as DOMException).name || err.name
  if (name === 'QuotaExceededError') {
    return 'Storage full. Delete some lots or free phone storage, then try again.'
  }
  if (name === 'ConstraintError') {
    return 'This lot number already exists. Go back and capture again.'
  }
  if (name === 'VersionError' || name === 'InvalidStateError') {
    return 'Local database needs reset. Refresh the page and try once more.'
  }
  return err.message || 'IndexedDB save failed.'
}

async function openFreshDb(): Promise<IDBPDatabase<BigbidDB>> {
  return openDB<BigbidDB>(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains('products')) {
        const store = db.createObjectStore('products', { keyPath: 'id' })
        store.createIndex('by-productNo', 'productNo', { unique: true })
        return
      }

      const store = transaction.objectStore('products')
      // Drop legacy indexes that caused mobile upgrade issues
      for (const name of ['by-sort', 'by-created']) {
        try {
          ;(store as unknown as { deleteIndex: (n: string) => void }).deleteIndex(name)
        } catch {
          // index may not exist
        }
      }
      if (!store.indexNames.contains('by-productNo')) {
        store.createIndex('by-productNo', 'productNo', { unique: true })
      }
    },
    blocked() {
      console.warn('IndexedDB upgrade blocked — close other tabs of this app.')
    },
  })
}

async function getDb(): Promise<IDBPDatabase<BigbidDB>> {
  if (!dbPromise) {
    dbPromise = openFreshDb().catch(async (err) => {
      console.warn('IndexedDB open failed, recreating database', err)
      dbPromise = null
      try {
        await deleteDB(DB_NAME)
      } catch {
        // ignore
      }
      dbPromise = openFreshDb()
      return dbPromise
    })
  }
  return dbPromise
}

function resetDbConnection() {
  dbPromise = null
}

export async function listProducts(): Promise<Product[]> {
  try {
    const db = await getDb()
    const all = (await db.getAll('products')) as StoredProduct[]
    return all
      .map((p) => normalizeProduct(p))
      .sort((a, b) => a.createdAt - b.createdAt)
  } catch (err) {
    resetDbConnection()
    throw new Error(idbErrorMessage(err))
  }
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const db = await getDb()
  const raw = await db.get('products', id)
  return raw ? normalizeProduct(raw as StoredProduct) : undefined
}

export async function addProduct(input: ProductInput): Promise<Product> {
  if (!input.imageBlobs.length) {
    throw new Error('At least one photo is required.')
  }
  if (input.imageBlobs.length > 10) {
    throw new Error('Maximum 10 photos per product.')
  }

  try {
    const db = await getDb()
    const existing = await db.getFromIndex('products', 'by-productNo', input.productNo)
    if (existing) {
      throw new Error(`Product number ${input.productNo} already exists.`)
    }

    const now = Date.now()
    const images = await blobsToStored(input.imageBlobs)
    const stored: StoredProduct = {
      id: crypto.randomUUID(),
      productNo: input.productNo,
      sortNo: input.productNo,
      name: input.name,
      description: input.description,
      salePrice: input.salePrice,
      bidPrice: input.bidPrice,
      images,
      createdAt: now,
      updatedAt: now,
    }
    await db.add('products', stored)
    return normalizeProduct(stored)
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) throw err
    resetDbConnection()
    // One retry after connection reset / recreate
    try {
      const db = await getDb()
      const images = await blobsToStored(input.imageBlobs)
      const now = Date.now()
      const stored: StoredProduct = {
        id: crypto.randomUUID(),
        productNo: input.productNo,
        sortNo: input.productNo,
        name: input.name,
        description: input.description,
        salePrice: input.salePrice,
        bidPrice: input.bidPrice,
        images,
        createdAt: now,
        updatedAt: now,
      }
      await db.add('products', stored)
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
    const db = await getDb()
    const existingRaw = (await db.get('products', id)) as StoredProduct | undefined
    if (!existingRaw) throw new Error('Product not found.')
    const existing = normalizeProduct(existingRaw)
    const productNo = patch.productNo ?? existing.productNo
    if (productNo !== existing.productNo) {
      const clash = await db.getFromIndex('products', 'by-productNo', productNo)
      if (clash && clash.id !== id) {
        throw new Error(`Product number ${productNo} already exists.`)
      }
    }

    const images = patch.imageBlobs
      ? await blobsToStored(patch.imageBlobs)
      : existingRaw.images ?? (await blobsToStored(existing.imageBlobs))

    const stored: StoredProduct = {
      id,
      productNo,
      sortNo: productNo,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      salePrice: patch.salePrice !== undefined ? patch.salePrice : existing.salePrice,
      bidPrice: patch.bidPrice !== undefined ? patch.bidPrice : existing.bidPrice,
      images,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }
    await db.put('products', stored)
    return normalizeProduct(stored)
  } catch (err) {
    if (err instanceof Error && /already exists|not found/i.test(err.message)) throw err
    throw new Error(idbErrorMessage(err))
  }
}

export async function deleteProduct(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('products', id)
}

export async function deleteProducts(ids: string[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('products', 'readwrite')
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done])
}

export async function clearAllProducts(): Promise<void> {
  const db = await getDb()
  await db.clear('products')
}

export async function estimateStorage(): Promise<{ usage: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  }
  return { usage: 0, quota: 0 }
}
