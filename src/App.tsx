import { useCallback, useEffect, useRef, useState } from 'react'
import { CaptureFlow } from './components/CaptureFlow'
import { EditProduct } from './components/EditProduct'
import { ExportBar } from './components/ExportBar'
import { PalletSetup } from './components/PalletSetup'
import { ProductList } from './components/ProductList'
import { bidPriceFromRetail } from './lib/bid'
import { normalizeLotContent, parseDescriptionForEditing } from './lib/description'
import {
  addProduct,
  clearAllProducts,
  estimateStorage,
  listProducts,
  updateProduct,
} from './lib/db'
import { formatBytes } from './lib/image'
import { analyzeProductPhotos } from './lib/openai'
import {
  formatProductNo,
  clearPalletConfig,
  loadPalletConfig,
  savePalletConfig,
  syncCursorToGaps,
} from './lib/pallet'
import {
  clearSellerSettings,
  loadSellerSettings,
  saveSellerSettings,
} from './lib/seller'
import { MAX_PHOTOS_PER_PRODUCT } from './types'
import type { PalletConfig, Product, SellerSettings } from './types'
import './App.css'

type Mode = 'setup' | 'list' | 'capture' | 'edit'
type CaptureMode = 'manual' | 'background'

export default function App() {
  const [pallet, setPallet] = useState<PalletConfig | null>(() => loadPalletConfig())
  const [seller, setSeller] = useState<SellerSettings>(() => loadSellerSettings())
  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<Mode>(() => (loadPalletConfig() ? 'list' : 'setup'))
  const [editing, setEditing] = useState<Product | null>(null)
  const [nextNo, setNextNo] = useState('1')
  const [storageLabel, setStorageLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('manual')
  const aiQueueRef = useRef<Set<string>>(new Set())

  const refresh = useCallback(async (config?: PalletConfig | null) => {
    const base = config ?? loadPalletConfig()
    const list = await listProducts()
    setProducts(list)
    setSelected((prev) => {
      const ids = new Set(list.map((p) => p.id))
      return new Set([...prev].filter((id) => ids.has(id)))
    })
    if (base) {
      const synced = syncCursorToGaps(
        base,
        list.map((p) => p.productNo),
      )
      if (
        synced.nextNum !== base.nextNum ||
        synced.nextAlpha !== base.nextAlpha
      ) {
        savePalletConfig(synced)
        setPallet(synced)
      }
      setNextNo(formatProductNo(synced.nextNum, synced.nextAlpha))
    }
    const { usage, quota } = await estimateStorage()
    if (quota > 0) {
      setStorageLabel(`Storage ${formatBytes(usage)} / ${formatBytes(quota)}`)
    } else {
      setStorageLabel('')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await refresh(loadPalletConfig())
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const queueAiFill = useCallback(
    async (product: Product) => {
      if (aiQueueRef.current.has(product.id)) return
      aiQueueRef.current.add(product.id)
      try {
        const result = await analyzeProductPhotos(product.imageBlobs, {
          bidStrategy: seller.bidStrategy,
          source: pallet?.source,
          addAmazonReferencePhoto: seller.addAmazonReferencePhoto,
        })
        const parsed = parseDescriptionForEditing(result.description, seller.lotDescription)
        const salePrice = result.salePrice
        const normalized = normalizeLotContent({
          title: result.title,
          description: parsed.body,
          salePrice,
          lotDescriptionSettings: parsed.settings,
        })
        await updateProduct(product.id, {
          name: normalized.title,
          description: normalized.description,
          salePrice,
          bidPrice: bidPriceFromRetail(salePrice, seller.bidPriceSettings) ?? result.bidPrice,
          imageBlobs:
            result.referenceImageBlob && product.imageBlobs.length < MAX_PHOTOS_PER_PRODUCT
              ? [result.referenceImageBlob, ...product.imageBlobs]
              : product.imageBlobs,
          aiFillStatus: 'completed',
          aiFillError: null,
        })
      } catch (err) {
        await updateProduct(product.id, {
          aiFillStatus: 'failed',
          aiFillError: err instanceof Error ? err.message : 'AI fill failed',
        })
      } finally {
        aiQueueRef.current.delete(product.id)
        await refresh(loadPalletConfig())
      }
    },
    [
      pallet?.source,
      refresh,
      seller.addAmazonReferencePhoto,
      seller.bidPriceSettings,
      seller.bidStrategy,
      seller.lotDescription,
    ],
  )

  async function confirmSetup(config: PalletConfig, sellerSettings: SellerSettings) {
    const prev = pallet
    const unchanged =
      prev &&
      prev.numValue === config.numValue &&
      prev.alphaValue === config.alphaValue &&
      prev.numMode === config.numMode &&
      prev.alphaMode === config.alphaMode
    const merged = unchanged
      ? {
          ...config,
          palletId: prev.palletId || config.palletId,
        }
      : config

    let list: Product[] = []
    try {
      list = await listProducts()
    } catch {
      list = []
    }

    const synced = syncCursorToGaps(
      merged,
      list.map((p) => p.productNo),
    )

    savePalletConfig(synced)
    saveSellerSettings(sellerSettings)
    setPallet(synced)
    setSeller(sellerSettings)
    setProducts(list)
    setNextNo(formatProductNo(synced.nextNum, synced.nextAlpha))
    setLoading(false)
    setMode('list')
  }

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="brand">bigbid</p>
          <p className="tagline">
            {mode === 'setup'
              ? 'Pallet number + Seller Code'
              : pallet
                ? `Next lot ${formatProductNo(pallet.nextNum, pallet.nextAlpha)} · ${seller.bidStrategy} bid · ${seller.sellerCode || 'no seller'}`
                : 'HiBid lot capture'}
          </p>
        </div>
        {storageLabel && mode !== 'setup' && <p className="storage">{storageLabel}</p>}
      </header>

      {mode === 'setup' && <PalletSetup initial={pallet} onConfirm={confirmSetup} />}

      {mode === 'list' && pallet && (
        <>
          <div className="hero-actions">
            <button
              type="button"
              className="btn capture"
              onClick={() => {
                setCaptureMode('background')
                setNextNo(formatProductNo(pallet.nextNum, pallet.nextAlpha))
                setMode('capture')
              }}
            >
              Continue next lot
              <span className="btn-sub">Photos only · AI fills in background</span>
            </button>
            <button
              type="button"
              className="btn primary capture"
              onClick={() => {
                setCaptureMode('manual')
                setNextNo(formatProductNo(pallet.nextNum, pallet.nextAlpha))
                setMode('capture')
              }}
            >
              Capture next lot
            </button>
            <button
              type="button"
              className="btn ghost pallet-link"
              onClick={() => setMode('setup')}
            >
              Change pallet / seller
            </button>
          </div>

          {loading ? (
            <p className="muted center">Loading…</p>
          ) : (
            <>
              <ProductList
                products={products}
                selected={selected}
                onToggle={(id) =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
                onToggleAll={() =>
                  setSelected((prev) => {
                    if (products.every((p) => prev.has(p.id))) return new Set()
                    return new Set(products.map((p) => p.id))
                  })
                }
                onEdit={(product) => {
                  setEditing(product)
                  setMode('edit')
                }}
              />
              <ExportBar
                products={products}
                selectedIds={[...selected]}
                palletId={pallet.palletId}
                sellerCode={seller.sellerCode}
                onChanged={async () => refresh(pallet)}
                onStartOver={async () => {
                  await clearAllProducts()
                  clearPalletConfig()
                  clearSellerSettings()
                  setProducts([])
                  setSelected(new Set())
                  setEditing(null)
                  setPallet(null)
                  setSeller(loadSellerSettings())
                  setNextNo('1')
                  setStorageLabel('')
                  setMode('setup')
                }}
              />
            </>
          )}
        </>
      )}

      {mode === 'capture' && pallet && (
        <CaptureFlow
          key={nextNo}
          productNo={nextNo}
          saleOrder={pallet.nextNum.replace(/\D/g, '')}
          captureMode={captureMode}
          bidStrategy={seller.bidStrategy}
          bidPriceSettings={seller.bidPriceSettings}
          source={pallet.source}
          addAmazonReferencePhoto={seller.addAmazonReferencePhoto}
          lotDescriptionSettings={seller.lotDescription}
          onCancel={() => setMode('list')}
          onSaved={async (data) => {
            const saved = await addProduct(data)
            if (data.aiFillStatus === 'pending') {
              void queueAiFill(saved)
            }
            const list = await listProducts()
            const synced = syncCursorToGaps(
              pallet,
              list.map((p) => p.productNo),
            )
            savePalletConfig(synced)
            setPallet(synced)
            await refresh(synced)
          }}
        />
      )}

      {mode === 'edit' && editing && (
        <EditProduct
          product={editing}
          lotDescriptionSettings={seller.lotDescription}
          onCancel={() => {
            setEditing(null)
            setMode('list')
          }}
          onSaved={async () => {
            setEditing(null)
            await refresh(pallet)
            setMode('list')
          }}
        />
      )}
    </div>
  )
}
