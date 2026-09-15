import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_CAPTURE_PHOTOS_PER_PRODUCT,
  MAX_PHOTOS_PER_PRODUCT,
  type AiFillStatus,
  type BidStrategy,
  type BidPriceSettings,
  type LotDescriptionSettings,
  type PalletSource,
} from '../types'
import { compressToJpeg } from '../lib/image'
import { analyzeProductPhotos } from '../lib/openai'
import { bidPriceFromRetail } from '../lib/bid'
import {
  DEFAULT_HIBID_DESCRIPTION,
  normalizeLotContent,
  parseDescriptionForEditing,
} from '../lib/description'
import { LotReviewForm } from './LotReviewForm'

type DraftFields = {
  productNo: string
  saleOrder: string
  name: string
  description: string
  salePrice: string
  bidPrice: string
}

type Props = {
  productNo: string
  saleOrder: string
  captureMode: 'manual' | 'background'
  bidStrategy?: BidStrategy
  bidPriceSettings: BidPriceSettings
  source: PalletSource
  addAmazonReferencePhoto: boolean
  lotDescriptionSettings: LotDescriptionSettings
  onCancel: () => void
  onSaved: (data: {
    productNo: string
    sortNo: string
    name: string
    description: string
    salePrice: number | null
    bidPrice: number | null
    imageBlobs: Blob[]
    aiFillStatus?: AiFillStatus
    aiFillError?: string | null
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
  captureMode,
  bidStrategy = 'recommended',
  bidPriceSettings,
  source,
  addAmazonReferencePhoto,
  lotDescriptionSettings,
  onCancel,
  onSaved,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const attachRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<Blob[]>([])
  const [referenceImageBlob, setReferenceImageBlob] = useState<Blob | null>(null)
  const [phase, setPhase] = useState<'shoot' | 'review'>('shoot')
  const [fields, setFields] = useState<DraftFields>({
    productNo,
    saleOrder: saleOrder.replace(/\D/g, ''),
    name: '',
    description: '',
    salePrice: '',
    bidPrice: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewSettings, setReviewSettings] = useState<LotDescriptionSettings>(lotDescriptionSettings)

  const previews = useMemo(() => photos.map((b) => URL.createObjectURL(b)), [photos])
  const referencePreview = useMemo(
    () => (referenceImageBlob ? URL.createObjectURL(referenceImageBlob) : null),
    [referenceImageBlob],
  )

  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u))
  }, [previews])

  useEffect(() => {
    if (!referencePreview) return
    return () => URL.revokeObjectURL(referencePreview)
  }, [referencePreview])

  async function addFiles(fileList: FileList | null, options?: { reopenCamera?: boolean }) {
    if (!fileList?.length) return
    setError('')
    const room = MAX_CAPTURE_PHOTOS_PER_PRODUCT - photos.length
    if (room <= 0) {
      setError(`Maximum ${MAX_CAPTURE_PHOTOS_PER_PRODUCT} captured photos per product.`)
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
      if (options?.reopenCamera && total < MAX_CAPTURE_PHOTOS_PER_PRODUCT) {
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
      const result = await analyzeProductPhotos(photos, {
        bidStrategy,
        source,
        addAmazonReferencePhoto,
      })
      setReferenceImageBlob(
        result.referenceImageBlob && photos.length < MAX_PHOTOS_PER_PRODUCT
          ? result.referenceImageBlob
          : null,
      )
      const parsed = parseDescriptionForEditing(result.description, lotDescriptionSettings)
      setFields((prev) => ({
        ...prev,
        name: result.title,
        description: parsed.body,
        salePrice: result.salePrice != null ? String(result.salePrice) : '',
        bidPrice: String(
          bidPriceFromRetail(result.salePrice, bidPriceSettings) ?? result.bidPrice ?? '',
        ),
      }))
      setReviewSettings(parsed.settings)
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
        lotDescriptionSettings: reviewSettings,
      })
      await onSaved({
        productNo: fields.productNo,
        sortNo: fields.saleOrder,
        name: normalized.title,
        description: normalized.description,
        salePrice,
        bidPrice: parseMoney(fields.bidPrice),
        imageBlobs: referenceImageBlob ? [referenceImageBlob, ...photos] : photos,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveAndContinue() {
    if (!photos.length) {
      setError('Take at least one photo.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSaved({
        productNo: fields.productNo,
        sortNo: fields.saleOrder,
        name: '?',
        description: DEFAULT_HIBID_DESCRIPTION,
        salePrice: null,
        bidPrice: null,
        imageBlobs: photos,
        aiFillStatus: 'pending',
        aiFillError: null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const canAddMore = photos.length < MAX_CAPTURE_PHOTOS_PER_PRODUCT
  const hasPhotos = photos.length > 0
  const reviewPreviews = referencePreview ? [referencePreview, ...previews] : previews
  const safeSaleOrder = fields.saleOrder || '0'

  return (
    <section className="sheet">
      <h1>Lot {fields.productNo}</h1>
      <p className="muted">Sale Order {safeSaleOrder}</p>

      {phase === 'shoot' && (
        <div className="form">
          <p className="muted">
            {captureMode === 'background'
              ? `Take photos continuously (up to ${MAX_CAPTURE_PHOTOS_PER_PRODUCT}). Save this lot, move to the next one, and let AI fill run in the background.`
              : `Take photos continuously (up to ${MAX_CAPTURE_PHOTOS_PER_PRODUCT}). After the first photo, a Finish button appears.`}
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
                {photos.length}/{MAX_CAPTURE_PHOTOS_PER_PRODUCT}
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
              <>
                {captureMode === 'background' && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void finishCapture()}
                    disabled={busy}
                  >
                    {busy ? 'Analyzing…' : 'Review this lot'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    void (captureMode === 'background' ? handleSaveAndContinue() : finishCapture())
                  }
                  disabled={busy}
                >
                  {busy
                    ? captureMode === 'background'
                      ? 'Saving…'
                      : 'Analyzing…'
                    : captureMode === 'background'
                      ? `Save & next lot (${photos.length})`
                      : `Finish (${photos.length}) · AI fill`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {phase === 'review' && (
        <LotReviewForm
          previews={reviewPreviews}
          referenceNote={
            referencePreview ? 'Amazon reference photo was added as the first image.' : undefined
          }
          productNo={fields.productNo}
          saleOrder={fields.saleOrder}
          title={fields.name}
          description={fields.description}
          reviewSettings={reviewSettings}
          salePrice={fields.salePrice}
          bidPrice={fields.bidPrice}
          busy={busy}
          error={error}
          secondaryLabel="Back to photos"
          primaryLabel={busy ? 'Saving…' : 'Save lot'}
          onProductNoChange={(value) => setFields((f) => ({ ...f, productNo: value }))}
          onSaleOrderChange={(value) => setFields((f) => ({ ...f, saleOrder: value }))}
          onTitleChange={(value) => setFields((f) => ({ ...f, name: value }))}
          onDescriptionChange={(value) => setFields((f) => ({ ...f, description: value }))}
          onReviewSettingsChange={setReviewSettings}
          onSalePriceChange={(value) => setFields((f) => ({ ...f, salePrice: value }))}
          onBidPriceChange={(value) => setFields((f) => ({ ...f, bidPrice: value }))}
          onSecondaryAction={() => setPhase('shoot')}
          onSubmit={handleSave}
        />
      )}
    </section>
  )
}
