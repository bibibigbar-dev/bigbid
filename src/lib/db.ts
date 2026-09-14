import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Product, ProductInput } from '../types'

type LegacyProduct = Omit<Product, 'imageBlobs' | 'sortNo'> & {
  imageBlob?: Blob
  imageBlobs?: Blob[]
  sortNo?: string | number
}

interface BigbidDB extends DBSchema {
  products: {
    key: string
    value: Product
    indexes: { 'by-created': number; 'by-productNo': string }
  }
}

const DB_NAME = 'bigbid'
const DB_VERSION = 3

let dbPromise: Promise<IDBPDatabase<BigbidDB>> | null = null

function normalizeProduct(raw: LegacyProduct): Product {
  const imageBlobs =
    raw.imageBlobs && raw.imageBlobs.length > 0
      ? raw.imageBlobs
      : raw.imageBlob
        ? [raw.imageBlob]
        : []
  const productNo = String(raw.productNo ?? '')
  return {
    id: raw.id,
    productNo,
    // Sale Order always matches Lot Number
    sortNo: productNo,
    name: raw.name,
    description: raw.description,
    salePrice: raw.salePrice,
    bidPrice: raw.bidPrice,
    imageBlobs,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<BigbidDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('products', { keyPath: 'id' })
          store.createIndex('by-created', 'createdAt')
          store.createIndex('by-productNo', 'productNo', { unique: true })
        }
        if (oldVersion >= 1 && oldVersion < 3 && transaction) {
          const store = transaction.objectStore('products')
          try {
            // Remove legacy numeric by-sort index (Sale Order is now productNo string)
            ;(store as unknown as { deleteIndex: (name: string) => void }).deleteIndex('by-sort')
          } catch {
            // index may not exist
          }
          if (!store.indexNames.contains('by-created')) {
            store.createIndex('by-created', 'createdAt')
          }
        }
      },
    })
  }
  return dbPromise
}

export async function listProducts(): Promise<Product[]> {
  const db = await getDb()
  let all: LegacyProduct[]
  try {
    all = (await db.getAllFromIndex('products', 'by-created')) as LegacyProduct[]
  } catch {
    all = (await db.getAll('products')) as LegacyProduct[]
    all.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  }
  return all.map((p) => normalizeProduct(p))
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const db = await getDb()
  const raw = await db.get('products', id)
  return raw ? normalizeProduct(raw as LegacyProduct) : undefined
}

export async function addProduct(input: ProductInput): Promise<Product> {
  const db = await getDb()
  const existing = await db.getFromIndex('products', 'by-productNo', input.productNo)
  if (existing) {
    throw new Error(`Product number ${input.productNo} already exists.`)
  }
  if (!input.imageBlobs.length) {
    throw new Error('At least one photo is required.')
  }
  if (input.imageBlobs.length > 10) {
    throw new Error('Maximum 10 photos per product.')
  }
  const now = Date.now()
  const product: Product = {
    id: crypto.randomUUID(),
    productNo: input.productNo,
    sortNo: input.productNo,
    name: input.name,
    description: input.description,
    salePrice: input.salePrice,
    bidPrice: input.bidPrice,
    imageBlobs: input.imageBlobs,
    createdAt: now,
    updatedAt: now,
  }
  await db.add('products', product)
  return product
}

export async function updateProduct(
  id: string,
  patch: Partial<Omit<Product, 'id' | 'createdAt'>>,
): Promise<Product> {
  const db = await getDb()
  const existingRaw = await db.get('products', id)
  if (!existingRaw) throw new Error('Product not found.')
  const existing = normalizeProduct(existingRaw as LegacyProduct)
  if (patch.productNo && patch.productNo !== existing.productNo) {
    const clash = await db.getFromIndex('products', 'by-productNo', patch.productNo)
    if (clash && clash.id !== id) {
      throw new Error(`Product number ${patch.productNo} already exists.`)
    }
  }
  const productNo = patch.productNo ?? existing.productNo
  const updated: Product = {
    ...existing,
    ...patch,
    productNo,
    sortNo: productNo,
    imageBlobs: patch.imageBlobs ?? existing.imageBlobs,
    updatedAt: Date.now(),
  }
  await db.put('products', updated)
  return updated
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
