import { useCallback, useEffect, useState } from 'react'
import { CaptureFlow } from './components/CaptureFlow'
import { EditProduct } from './components/EditProduct'
import { ExportBar } from './components/ExportBar'
import { PalletSetup } from './components/PalletSetup'
import { ProductList } from './components/ProductList'
import {
  addProduct,
  estimateStorage,
  getNextSortNo,
  listProducts,
} from './lib/db'
import { formatBytes } from './lib/image'
import {
  formatProductNo,
  loadPalletConfig,
  savePalletConfig,
  syncCursorToGaps,
} from './lib/pallet'
import { loadSellerSettings, saveSellerSettings } from './lib/seller'
import type { PalletConfig, Product, SellerSettings } from './types'
import './App.css'

type Mode = 'setup' | 'list' | 'capture' | 'edit'

export default function App() {
  const [pallet, setPallet] = useState<PalletConfig | null>(() => loadPalletConfig())
  const [seller, setSeller] = useState<SellerSettings>(() => loadSellerSettings())
  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<Mode>(() =>
    loadPalletConfig() && loadSellerSettings().sellerCode ? 'list' : 'setup',
  )
  const [editing, setEditing] = useState<Product | null>(null)
  const [nextNo, setNextNo] = useState('1')
  const [nextSort, setNextSort] = useState(1)
  const [storageLabel, setStorageLabel] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (config?: PalletConfig | null) => {
    const base = config ?? loadPalletConfig()
    const list = await listProducts()
    setProducts(list)
    setSelected((prev) => {
      const ids = new Set(list.map((p) => p.id))
      return new Set([...prev].filter((id) => ids.has(id)))
    })
    if (base) {
      // Reuse deleted lot numbers: next = first gap from pallet start
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
    setNextSort(await getNextSortNo())
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
        await refresh(pallet)
      } finally {
        setLoading(false)
      }
    })()
  }, [refresh, pallet])

  function confirmSetup(config: PalletConfig, sellerSettings: SellerSettings) {
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
    // Always align next lot to first free number (fills gaps after deletes)
    void listProducts().then((list) => {
      const synced = syncCursorToGaps(
        merged,
        list.map((p) => p.productNo),
      )
      savePalletConfig(synced)
      saveSellerSettings(sellerSettings)
      setPallet(synced)
      setSeller(sellerSettings)
      setNextNo(formatProductNo(synced.nextNum, synced.nextAlpha))
      setMode('list')
    })
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
              className="btn primary capture"
              onClick={() => {
                setNextNo(formatProductNo(pallet.nextNum, pallet.nextAlpha))
                void getNextSortNo().then(setNextSort)
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
              />
            </>
          )}
        </>
      )}

      {mode === 'capture' && pallet && (
        <CaptureFlow
          key={nextNo}
          productNo={nextNo}
          sortNo={nextSort}
          bidStrategy={seller.bidStrategy}
          onCancel={() => setMode('list')}
          onSaved={async (data) => {
            await addProduct(data)
            const list = await listProducts()
            const synced = syncCursorToGaps(
              pallet,
              list.map((p) => p.productNo),
            )
            savePalletConfig(synced)
            setPallet(synced)
            await refresh(synced)
            setMode('list')
          }}
        />
      )}

      {mode === 'edit' && editing && (
        <EditProduct
          product={editing}
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
