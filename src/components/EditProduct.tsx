import { useEffect, useState } from 'react'
import type {
  FunctionalStatus,
  LotCondition,
  LotDescriptionSettings,
  Product,
  YesNo,
} from '../types'
import { updateProduct } from '../lib/db'
import { normalizeLotContent, parseDescriptionForEditing } from '../lib/description'

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
      <h1>
        Edit {product.productNo}{' '}
        <span className="muted">· Sale Order {saleOrder}</span>
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
        <div className="field">
          <span>Description</span>
          <div className="field-row">
            <label className="field">
              <span>Condition</span>
              <select
                value={reviewSettings.condition}
                onChange={(e) =>
                  setReviewSettings((prev) => ({
                    ...prev,
                    condition: e.target.value as LotCondition,
                  }))
                }
              >
                <option value="New">New</option>
                <option value="Open Box">Open Box</option>
                <option value="Used">Used</option>
              </select>
            </label>
            <label className="field">
              <span>Damage</span>
              <select
                value={reviewSettings.damage}
                onChange={(e) =>
                  setReviewSettings((prev) => ({ ...prev, damage: e.target.value as YesNo }))
                }
              >
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Functional</span>
              <select
                value={reviewSettings.functional}
                onChange={(e) =>
                  setReviewSettings((prev) => ({
                    ...prev,
                    functional: e.target.value as FunctionalStatus,
                  }))
                }
              >
                <option value="Unable to Test">Unable to Test</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="field">
              <span>Missing Parts/Pieces</span>
              <select
                value={reviewSettings.missingParts}
                onChange={(e) =>
                  setReviewSettings((prev) => ({
                    ...prev,
                    missingParts: e.target.value as YesNo,
                  }))
                }
              >
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Packaging</span>
              <select
                value={reviewSettings.packaging}
                onChange={(e) =>
                  setReviewSettings((prev) => ({ ...prev, packaging: e.target.value as YesNo }))
                }
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="field">
              <span>Condition Notes</span>
              <input
                value={reviewSettings.conditionNotes}
                onChange={(e) =>
                  setReviewSettings((prev) => ({ ...prev, conditionNotes: e.target.value }))
                }
                autoComplete="off"
              />
            </label>
          </div>

          <label className="field">
            <span>Description (shared, max 1000 chars)</span>
            <textarea
              rows={4}
              maxLength={1000}
              value={reviewSettings.description}
              onChange={(e) =>
                setReviewSettings((prev) => ({
                  ...prev,
                  description: e.target.value.slice(0, 1000),
                }))
              }
            />
          </label>

          <label className="field">
            <span>Item Description</span>
            <textarea
              rows={8}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
        </div>
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
