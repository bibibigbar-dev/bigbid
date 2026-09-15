import { useEffect, useState } from 'react'
import type { LotDescriptionSettings, Product } from '../types'
import { updateProduct } from '../lib/db'
import { normalizeLotContent, parseDescriptionForEditing } from '../lib/description'
import { LotReviewForm } from './LotReviewForm'

type Props = {
  product: Product
  lotDescriptionSettings: LotDescriptionSettings
  onCancel: () => void
  onSaved: () => Promise<void>
}

function parseMoney(value: string): number | null {
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function EditProduct({ product, lotDescriptionSettings, onCancel, onSaved }: Props) {
  const saleOrder = product.sortNo.replace(/\D/g, '') || '0'
  const parsed = parseDescriptionForEditing(product.description, lotDescriptionSettings)
  const [name, setName] = useState(product.name)
  const [description, setDescription] = useState(parsed.body)
  const [reviewSettings, setReviewSettings] = useState<LotDescriptionSettings>(parsed.settings)
  const [salePrice, setSalePrice] = useState(
    product.salePrice != null ? String(product.salePrice) : '',
  )
  const [bidPrice, setBidPrice] = useState(
    product.bidPrice != null ? String(product.bidPrice) : '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previews, setPreviews] = useState<string[]>([])

  useEffect(() => {
    const urls = product.imageBlobs.map((b) => URL.createObjectURL(b))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [product.imageBlobs])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const parsedSale = parseMoney(salePrice)
      const normalized = normalizeLotContent({
        title: name.trim(),
        description: description.trim(),
        salePrice: parsedSale,
        lotDescriptionSettings: reviewSettings,
      })
      await updateProduct(product.id, {
        name: normalized.title,
        description: normalized.description,
        salePrice: parsedSale,
        bidPrice: parseMoney(bidPrice),
      })
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sheet">
      <h1>Lot {product.productNo}</h1>
      <p className="muted">Sale Order {saleOrder}</p>
      <LotReviewForm
        previews={previews}
        title={name}
        description={description}
        reviewSettings={reviewSettings}
        salePrice={salePrice}
        bidPrice={bidPrice}
        busy={busy}
        error={error}
        secondaryLabel="Cancel"
        primaryLabel={busy ? 'Saving…' : 'Save lot'}
        onTitleChange={setName}
        onDescriptionChange={setDescription}
        onReviewSettingsChange={setReviewSettings}
        onSalePriceChange={setSalePrice}
        onBidPriceChange={setBidPrice}
        onSecondaryAction={onCancel}
        onSubmit={handleSubmit}
      />
    </section>
  )
}
