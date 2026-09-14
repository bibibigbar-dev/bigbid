import { useEffect, useState } from 'react'
import type { Product } from '../types'
import { updateProduct } from '../lib/db'
import { normalizeLotContent } from '../lib/description'

type Props = {
  product: Product
  onCancel: () => void
  onSaved: () => Promise<void>
}

function parseMoney(value: string): number | null {
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function EditProduct({ product, onCancel, onSaved }: Props) {
  const [name, setName] = useState(product.name)
  const [description, setDescription] = useState(product.description)
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
      <h1>
        Edit {product.productNo}{' '}
        <span className="muted">· Sale Order {product.productNo}</span>
      </h1>
      <form className="form" onSubmit={(e) => void handleSubmit(e)}>
        <div className="photo-grid compact">
          {previews.map((url) => (
            <img key={url} src={url} alt="" className="thumb-sm" />
          ))}
        </div>
        <label className="field">
          <span>Title</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            rows={8}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Retail / Reference price (for Title)</span>
            <input
              inputMode="decimal"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Start bid</span>
            <input
              inputMode="decimal"
              value={bidPrice}
              onChange={(e) => setBidPrice(e.target.value)}
            />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  )
}
