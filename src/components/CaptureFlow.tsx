import { useEffect, useRef, useState } from 'react'
import { MAX_PHOTOS_PER_PRODUCT, type BidStrategy, type LotDescriptionSettings } from '../types'
import { compressToJpeg } from '../lib/image'
import { analyzeProductPhotos } from '../lib/openai'
import { normalizeLotContent } from '../lib/description'

type DraftFields = {
  name: string
  description: string
  salePrice: string
  bidPrice: string
}

type Props = {
  productNo: string
  saleOrder: string
  bidStrategy?: BidStrategy
  lotDescriptionSettings: LotDescriptionSettings
  onCancel: () => void
  onSaved: (data: {
    productNo: string
    name: string
    description: string
    salePrice: number | null
    bidPrice: number | null
    imageBlobs: Blob[]
  }) => Promise<void>
}

function parseMoney(value: string): number | null {
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function CaptureFlow({
  productNo,
  saleOrder,
  bidStrategy = 'recommended',
  lotDescriptionSettings,
  onCancel,
  onSaved,
}: Props) {
  const safeSaleOrder = saleOrder.replace(/\D/g, '') || '0'
  const cameraRef = useRef<HTMLInputElement>(null)
  const attachRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<Blob[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [phase, setPhase] = useState<'shoot' | 'review'>('shoot')
  const [fields, setFields] = useState<DraftFields>({
    name: '',
    description: '',
    salePrice: '',
    bidPrice: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const urls = photos.map((b) => URL.createObjectURL(b))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [photos])

  async function addFiles(fileList: FileList | null, options?: { reopenCamera?: boolean }) {
    if (!fileList?.length) return
    setError('')
    const room = MAX_PHOTOS_PER_PRODUCT - photos.length
    if (room <= 0) {
      setError(`Maximum ${MAX_PHOTOS_PER_PRODUCT} photos per product.`)
      return
    }
    setBusy(true)
    try {
      const picked = Array.from(fileList).slice(0, room)
      const next: Blob[] = []
      for (const file of picked) {
        next.push(await compressToJpeg(file))
      }
      const total = photos.length + next.length
      setPhotos((prev) => [...prev, ...next])

      // Continuous camera: open camera again after each shot until limit
      if (options?.reopenCamera && total < MAX_PHOTOS_PER_PRODUCT) {
        window.setTimeout(() => cameraRef.current?.click(), 350)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process photo')
    } finally {
      setBusy(false)
    }
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  async function finishCapture() {
    if (photos.length === 0) {
      setError('Take at least one photo.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await analyzeProductPhotos(photos, { bidStrategy })
      setFields({
        name: result.title,
        description: result.description,
        salePrice: result.salePrice != null ? String(result.salePrice) : '',
        bidPrice: result.bidPrice != null ? String(result.bidPrice) : '',
      })
      setPhase('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI analysis failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const salePrice = parseMoney(fields.salePrice)
      const normalized = normalizeLotContent({
        title: fields.name.trim(),
        description: fields.description.trim(),
        salePrice,
        lotDescriptionSettings,
      })
      await onSaved({
        productNo,
        name: normalized.title,
        description: normalized.description,
        salePrice,
        bidPrice: parseMoney(fields.bidPrice),
        imageBlobs: photos,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const canAddMore = photos.length < MAX_PHOTOS_PER_PRODUCT
  const hasPhotos = photos.length > 0

  return (
    <section className="sheet">
      <h1>Lot {productNo}</h1>
      <p className="muted">Sale Order {safeSaleOrder}</p>

      {phase === 'shoot' && (
        <div className="form">
          <p className="muted">
            Take photos continuously (up to {MAX_PHOTOS_PER_PRODUCT}). After the first photo, a
            Finish button appears.
          </p>

          <div className="capture-actions">
            <button
              type="button"
              className="btn primary capture"
              disabled={busy || !canAddMore}
              onClick={() => cameraRef.current?.click()}
            >
              Take photo
              <span className="btn-sub">
                {photos.length}/{MAX_PHOTOS_PER_PRODUCT}
              </span>
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !canAddMore}
              onClick={() => attachRef.current?.click()}
            >
              Attach from gallery
            </button>
          </div>

          {/* Camera — continuous single shots */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void addFiles(e.target.files, { reopenCamera: true })
              e.target.value = ''
            }}
          />

          {/* Gallery attach — multi select, no capture */}
          <input
            ref={attachRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files)
              e.target.value = ''
            }}
          />

          {hasPhotos && (
            <div className="photo-grid">
              {previews.map((url, i) => (
                <div key={url} className="photo-tile">
                  <img src={url} alt={`Photo ${i + 1}`} />
                  <button type="button" className="tile-remove" onClick={() => removePhoto(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="error">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            {hasPhotos && (
              <button
                type="button"
                className="btn primary"
                onClick={() => void finishCapture()}
                disabled={busy}
              >
                {busy ? 'Analyzing…' : `Finish (${photos.length}) · AI fill`}
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'review' && (
        <form className="form" onSubmit={(e) => void handleSave(e)}>
          <div className="photo-grid compact">
            {previews.map((url) => (
              <img key={url} src={url} alt="" className="thumb-sm" />
            ))}
          </div>

          <label className="field">
            <span>Title (max 50 chars, retail shown only if over $100)</span>
            <input
              value={fields.name}
              maxLength={50}
              onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              rows={8}
              value={fields.description}
              onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Retail / Reference price (for Title)</span>
              <input
                inputMode="decimal"
                value={fields.salePrice}
                onChange={(e) => setFields((f) => ({ ...f, salePrice: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Start bid</span>
              <input
                inputMode="decimal"
                value={fields.bidPrice}
                onChange={(e) => setFields((f) => ({ ...f, bidPrice: e.target.value }))}
              />
            </label>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="form-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setPhase('shoot')}
            >
              Back to photos
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save lot'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
