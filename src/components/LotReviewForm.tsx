import type {
  FunctionalStatus,
  LotCondition,
  LotDescriptionSettings,
  YesNo,
} from '../types'

type Props = {
  previews: string[]
  referenceImageUrls?: string[]
  referenceNote?: string
  titleSourceUrl?: string | null
  descriptionSourceUrl?: string | null
  productNo: string
  saleOrder: string
  title: string
  description: string
  reviewSettings: LotDescriptionSettings
  salePrice: string
  bidPrice: string
  busy: boolean
  error: string
  secondaryLabel: string
  primaryLabel: string
  onProductNoChange: (value: string) => void
  onSaleOrderChange: (value: string) => void
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onReviewSettingsChange: (value: LotDescriptionSettings) => void
  onSalePriceChange: (value: string) => void
  onBidPriceChange: (value: string) => void
  onSecondaryAction: () => void
  onSubmit: (e: React.FormEvent) => void | Promise<void>
}

function toSafeHttpUrl(value?: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString()
    return null
  } catch {
    return null
  }
}

function openExternalUrl(url: string) {
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) window.location.assign(url)
}

export function LotReviewForm({
  previews,
  referenceImageUrls = [],
  referenceNote,
  titleSourceUrl,
  descriptionSourceUrl,
  productNo,
  saleOrder,
  title,
  description,
  reviewSettings,
  salePrice,
  bidPrice,
  busy,
  error,
  secondaryLabel,
  primaryLabel,
  onProductNoChange,
  onSaleOrderChange,
  onTitleChange,
  onDescriptionChange,
  onReviewSettingsChange,
  onSalePriceChange,
  onBidPriceChange,
  onSecondaryAction,
  onSubmit,
}: Props) {
  const safeTitleSourceUrl = toSafeHttpUrl(titleSourceUrl)
  const safeDescriptionSourceUrl = toSafeHttpUrl(descriptionSourceUrl)
  const safeReferenceImageUrls = referenceImageUrls.map((value) => toSafeHttpUrl(value))

  return (
    <form className="form" onSubmit={(e) => void onSubmit(e)}>
      <div className="photo-grid compact">
        {previews.map((url, index) => {
          const imageUrl = safeReferenceImageUrls[index]
          return (
            <div key={`${url}-${index}`} className="photo-preview-card">
              <img src={url} alt="" className="thumb-sm" />
              {imageUrl && (
                <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="photo-url">
                  {imageUrl}
                </a>
              )}
            </div>
          )
        })}
      </div>

      {referenceNote && <p className="muted tiny">{referenceNote}</p>}
      {safeTitleSourceUrl &&
      safeDescriptionSourceUrl &&
      safeTitleSourceUrl === safeDescriptionSourceUrl ? (
        <>
          <p className="muted tiny">
            Title source: AI photo analysis + matched source page:{' '}
            <a
              href={safeTitleSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault()
                openExternalUrl(safeTitleSourceUrl)
              }}
            >
              {safeTitleSourceUrl}
            </a>
          </p>
          <p className="muted tiny">
            Description source: AI photo analysis + matched source page:{' '}
            <a
              href={safeDescriptionSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault()
                openExternalUrl(safeDescriptionSourceUrl)
              }}
            >
              {safeDescriptionSourceUrl}
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="muted tiny">
            Title source:{' '}
            {safeTitleSourceUrl ? (
              <>
                AI photo analysis + matched source page:{' '}
                <a
                  href={safeTitleSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault()
                    openExternalUrl(safeTitleSourceUrl)
                  }}
                >
                  {safeTitleSourceUrl}
                </a>
              </>
            ) : (
              'AI photo analysis (no matched source URL)'
            )}
          </p>
          <p className="muted tiny">
            Description source:{' '}
            {safeDescriptionSourceUrl ? (
              <>
                AI photo analysis + matched source page:{' '}
                <a
                  href={safeDescriptionSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault()
                    openExternalUrl(safeDescriptionSourceUrl)
                  }}
                >
                  {safeDescriptionSourceUrl}
                </a>
              </>
            ) : (
              'AI photo analysis (no matched source URL)'
            )}
          </p>
        </>
      )}

      <div className="field-row">
        <label className="field">
          <span>Lot Number</span>
          <input value={productNo} onChange={(e) => onProductNoChange(e.target.value)} required />
        </label>
        <label className="field">
          <span>Sale Order</span>
          <input
            inputMode="numeric"
            value={saleOrder}
            onChange={(e) => onSaleOrderChange(e.target.value.replace(/\D/g, ''))}
            required
          />
        </label>
      </div>

      <label className="field">
        <span>Title (max 50 chars, retail shown only if over $100)</span>
        <input value={title} maxLength={50} onChange={(e) => onTitleChange(e.target.value)} required />
      </label>

      <div className="field">
        <span>Description</span>
        <div className="field-row">
          <label className="field">
            <span>Condition</span>
            <select
              value={reviewSettings.condition}
              onChange={(e) =>
                onReviewSettingsChange({
                  ...reviewSettings,
                  condition: e.target.value as LotCondition,
                })
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
                onReviewSettingsChange({
                  ...reviewSettings,
                  damage: e.target.value as YesNo,
                })
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
                onReviewSettingsChange({
                  ...reviewSettings,
                  functional: e.target.value as FunctionalStatus,
                })
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
                onReviewSettingsChange({
                  ...reviewSettings,
                  missingParts: e.target.value as YesNo,
                })
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
                onReviewSettingsChange({
                  ...reviewSettings,
                  packaging: e.target.value as YesNo,
                })
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
                onReviewSettingsChange({
                  ...reviewSettings,
                  conditionNotes: e.target.value,
                })
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
              onReviewSettingsChange({
                ...reviewSettings,
                description: e.target.value.slice(0, 1000),
              })
            }
          />
        </label>

        <label className="field">
          <span>Item Description</span>
          <textarea
            rows={8}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            required
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Retail / Reference price (for Title)</span>
          <input inputMode="decimal" value={salePrice} onChange={(e) => onSalePriceChange(e.target.value)} />
        </label>
        <label className="field">
          <span>Start bid</span>
          <input inputMode="decimal" value={bidPrice} onChange={(e) => onBidPriceChange(e.target.value)} />
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn ghost" disabled={busy} onClick={onSecondaryAction}>
          {secondaryLabel}
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {primaryLabel}
        </button>
      </div>
    </form>
  )
}
