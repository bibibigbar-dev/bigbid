import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Product, ProductInput } from '../types'

type LegacyProduct = Omit<Product, 'imageBlobs'> & { imageBlob?: Blob; imageBlobs?: Blob[] }

interface BigbidDB extends DBSchema {
  products: {
    key: string
    value: Product
    indexes: { 'by-sort': number; 'by-productNo': string }
  }
}

const DB_NAME = 'bigbid'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<BigbidDB>> | null = null

function normalizeProduct(raw: LegacyProduct): Product {
  const imageBlobs =
    raw.imageBlobs && raw.imageBlobs.length > 0
      ? raw.imageBlobs
      : raw.imageBlob
        ? [raw.imageBlob]
        : []
  return {
    id: raw.id,
    productNo: raw.productNo,
    sortNo: raw.sortNo,
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
          store.createIndex('by-sort', 'sortNo')
          store.createIndex('by-productNo', 'productNo', { unique: true })
        }
        if (oldVersion < 2 && transaction) {
          const store = transaction.objectStore('products')
          // migrate imageBlob → imageBlobs on read/write path via normalize
          void store
        }
      },
    })
  }
  return dbPromise
}

export async function listProducts(): Promise<Product[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('products', 'by-sort')
  return all.map((p) => normalizeProduct(p as LegacyProduct))
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const db = await getDb()
  const raw = await db.get('products', id)
  return raw ? normalizeProduct(raw as LegacyProduct) : undefined
}

export async function getNextSortNo(): Promise<number> {
  const products = await listProducts()
  if (products.length === 0) return 1
  return Math.max(...products.map((p) => p.sortNo)) + 1
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
    ...input,
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
  const updated: Product = {
    ...existing,
    ...patch,
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
