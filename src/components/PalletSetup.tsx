import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PALLET_SOURCES,
  type BidStrategy,
  type BidPriceSettings,
  type FunctionalStatus,
  type LotCondition,
  type PalletConfig,
  type PalletSource,
  type SellerSettings,
  type YesNo,
} from '../types'
import { normalizeBidPriceSettings } from '../lib/bid'
import { buildPalletConfig, peekSequence } from '../lib/pallet'
import { loadSellerSettings } from '../lib/seller'

type Props = {
  initial?: PalletConfig | null
  onConfirm: (config: PalletConfig, seller: SellerSettings) => void | Promise<void>
}

export function PalletSetup({ initial, onConfirm }: Props) {
  const savedSeller = loadSellerSettings()
  const savedBidSettings = normalizeBidPriceSettings(savedSeller.bidPriceSettings)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [source, setSource] = useState<PalletSource>(initial?.source ?? 'amazon')
  const [numValue, setNumValue] = useState(initial?.numValue ?? '1')
  const [alphaValue, setAlphaValue] = useState(initial?.alphaValue ?? '')
  const [bidUpTo20, setBidUpTo20] = useState(String(savedBidSettings.upTo20))
  const [bidUpTo50, setBidUpTo50] = useState(String(savedBidSettings.upTo50))
  const [bidUpTo100, setBidUpTo100] = useState(String(savedBidSettings.upTo100))
  const [bidUpTo150, setBidUpTo150] = useState(String(savedBidSettings.upTo150))
  const [bidUpTo250, setBidUpTo250] = useState(String(savedBidSettings.upTo250))
  const [bidOver250, setBidOver250] = useState(String(savedBidSettings.over250))
  const [sellerCode, setSellerCode] = useState(savedSeller.sellerCode)
  const [bidStrategy, setBidStrategy] = useState<BidStrategy>(
    savedSeller.bidStrategy ?? 'recommended',
  )
  const [referencePhotoEnabled, setReferencePhotoEnabled] = useState(
    savedSeller.referencePhotoEnabled !== false,
  )
  const [referencePhotoCount, setReferencePhotoCount] = useState<1 | 2 | 3 | 4>(
    savedSeller.referencePhotoCount === 2 ||
      savedSeller.referencePhotoCount === 3 ||
      savedSeller.referencePhotoCount === 4
      ? savedSeller.referencePhotoCount
      : 1,
  )
  const [condition, setCondition] = useState<LotCondition>(savedSeller.lotDescription.condition)
  const [conditionNotes, setConditionNotes] = useState(savedSeller.lotDescription.conditionNotes)
  const [damage, setDamage] = useState<YesNo>(savedSeller.lotDescription.damage)
  const [functional, setFunctional] = useState<FunctionalStatus>(savedSeller.lotDescription.functional)
  const [missingParts, setMissingParts] = useState<YesNo>(savedSeller.lotDescription.missingParts)
  const [packaging, setPackaging] = useState<YesNo>(savedSeller.lotDescription.packaging)
  const [description, setDescription] = useState(savedSeller.lotDescription.description)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const preview = useMemo(() => {
    try {
      const draft = buildPalletConfig({
        source,
        numValue,
        numMode: 'seq',
        alphaValue,
        alphaMode: 'fixed',
      })
      const cursor =
        initial &&
        initial.numValue === draft.numValue &&
        initial.alphaValue === draft.alphaValue &&
        draft.numMode === 'seq' &&
        draft.alphaMode === 'fixed'
          ? { ...draft, nextNum: initial.nextNum, nextAlpha: initial.nextAlpha }
          : draft
      return peekSequence(cursor, 3)
    } catch {
      return []
    }
  }, [source, numValue, alphaValue, initial])

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  function parseBidPriceSettings(): BidPriceSettings {
    const parsed = normalizeBidPriceSettings({
      upTo20: bidUpTo20,
      upTo50: bidUpTo50,
      upTo100: bidUpTo100,
      upTo150: bidUpTo150,
      upTo250: bidUpTo250,
      over250: bidOver250,
    })
    const fields: Array<[label: string, value: string, normalized: number]> = [
      ['≤ $20', bidUpTo20, parsed.upTo20],
      ['$21–$50', bidUpTo50, parsed.upTo50],
      ['$51–$100', bidUpTo100, parsed.upTo100],
      ['$101–$150', bidUpTo150, parsed.upTo150],
      ['$151–$250', bidUpTo250, parsed.upTo250],
      ['> $250', bidOver250, parsed.over250],
    ]
    for (const [label, value, normalized] of fields) {
      if (!value.trim()) throw new Error(`Enter start bid for ${label}.`)
      if (Number(value) !== normalized) {
        throw new Error(`Start bid for ${label} must be a valid non-negative number.`)
      }
    }
    return parsed
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!numValue.trim()) {
      setError('Enter starting digits.')
      return
    }
    setBusy(true)
    try {
      const config = buildPalletConfig({
        source,
        numValue,
        numMode: 'seq',
        alphaValue,
        alphaMode: 'fixed',
      })
      const bidPriceSettings = parseBidPriceSettings()
      await onConfirm(config, {
        sellerCode: sellerCode.trim(),
        bidStrategy,
        referencePhotoEnabled,
        referencePhotoCount,
        bidPriceSettings,
        lotDescription: {
          condition,
          conditionNotes: conditionNotes.trim(),
          damage,
          functional,
          missingParts,
          packaging,
          description: description.slice(0, 1000),
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please check your settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pallet-setup">
      <h1>Setting</h1>
      <p className="muted setup-lead">
        Set pallet numbering, bid defaults, and which start-bid AI should use.
      </p>

      <form className="form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="pallet-part">
          <label className="field">
            <span>Item Sourcing Site</span>
            <select value={source} onChange={(e) => setSource(e.target.value as PalletSource)}>
              {PALLET_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {value === 'homedepot'
                    ? 'HomeDepot'
                    : value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="pallet-part">
          <div className="pallet-part-head">
            <span>Lot Number Digits</span>
            <strong>Sequential</strong>
          </div>
          <label className="field">
            <span>Starting digits</span>
            <input
              inputMode="numeric"
              maxLength={5}
              value={numValue}
              onChange={(e) => setNumValue(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="e.g. 1"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="pallet-part">
          <div className="pallet-part-head">
            <span>Lot Number Letters</span>
            <strong>Fixed</strong>
          </div>
          <label className="field">
            <span>Starting letters (optional)</span>
            <input
              maxLength={5}
              value={alphaValue}
              onChange={(e) =>
                setAlphaValue(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 5))
              }
              placeholder="e.g. b or ff"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="pallet-part">
          <span className="field-label">Start bid strategy</span>
          <div className="mode-toggle bid-strategy" role="group">
            <button
              type="button"
              className={bidStrategy === 'recommended' ? 'active' : ''}
              onClick={() => setBidStrategy('recommended')}
            >
              Recommended
            </button>
            <button
              type="button"
              className={bidStrategy === 'aggressive' ? 'active' : ''}
              onClick={() => setBidStrategy('aggressive')}
            >
              Aggressive
            </button>
          </div>
          <p className="muted tiny">
            {bidStrategy === 'recommended'
              ? 'Uses AI recommended auction start bid (default), e.g. $10'
              : 'Uses AI aggressive start bid, e.g. $5'}
          </p>
        </div>

        <div className="pallet-part">
          <span className="field-label">Reference photos</span>
          <label className="check">
            <input
              type="checkbox"
              checked={referencePhotoEnabled}
              onChange={(e) => setReferencePhotoEnabled(e.target.checked)}
            />
            Auto-add reference product photos from selected Item Sourcing Site
          </label>
          <label className="field">
            <span>Reference photo count (1–4)</span>
            <select
              value={String(referencePhotoCount)}
              onChange={(e) => {
                const n = Number(e.target.value)
                setReferencePhotoCount(n === 2 || n === 3 || n === 4 ? n : 1)
              }}
              disabled={!referencePhotoEnabled}
            >
              <option value="1">1 photo</option>
              <option value="2">2 photos</option>
              <option value="3">3 photos</option>
              <option value="4">4 photos</option>
            </select>
          </label>
          <p className="muted tiny">
            Uses the current Item Sourcing Site ({source === 'homedepot'
              ? 'Home Depot'
              : source.charAt(0).toUpperCase() + source.slice(1)}).
          </p>
        </div>

        <div className="pallet-part">
          <span className="field-label">Bid price settings (default)</span>
          <div className="field-row">
            <label className="field">
              <span>≤ $20</span>
              <input
                inputMode="decimal"
                value={bidUpTo20}
                onChange={(e) => setBidUpTo20(e.target.value)}
              />
            </label>
            <label className="field">
              <span>$21 – $50</span>
              <input
                inputMode="decimal"
                value={bidUpTo50}
                onChange={(e) => setBidUpTo50(e.target.value)}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>$51 – $100</span>
              <input
                inputMode="decimal"
                value={bidUpTo100}
                onChange={(e) => setBidUpTo100(e.target.value)}
              />
            </label>
            <label className="field">
              <span>$101 – $150</span>
              <input
                inputMode="decimal"
                value={bidUpTo150}
                onChange={(e) => setBidUpTo150(e.target.value)}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>$151 – $250</span>
              <input
                inputMode="decimal"
                value={bidUpTo250}
                onChange={(e) => setBidUpTo250(e.target.value)}
              />
            </label>
            <label className="field">
              <span>&gt; $250</span>
              <input
                inputMode="decimal"
                value={bidOver250}
                onChange={(e) => setBidOver250(e.target.value)}
              />
            </label>
          </div>
          <p className="muted tiny">
            Uses this table first for auto-filled start bid; you can still edit per lot.
          </p>
        </div>

        <div className="pallet-part">
          <span className="field-label">Description</span>
          <div className="field-row">
            <label className="field">
              <span>Condition</span>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as LotCondition)}
              >
                <option value="New">New</option>
                <option value="Open Box">Open Box</option>
                <option value="Used">Used</option>
              </select>
            </label>
            <label className="field">
              <span>Damage</span>
              <select value={damage} onChange={(e) => setDamage(e.target.value as YesNo)}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Functional</span>
              <select
                value={functional}
                onChange={(e) => setFunctional(e.target.value as FunctionalStatus)}
              >
                <option value="Unable to Test">Unable to Test</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="field">
              <span>Missing Parts/Pieces</span>
              <select
                value={missingParts}
                onChange={(e) => setMissingParts(e.target.value as YesNo)}
              >
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Packaging</span>
              <select value={packaging} onChange={(e) => setPackaging(e.target.value as YesNo)}>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="field">
              <span>Condition Notes</span>
              <input
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>

          <label className="field">
            <span>Description (shared, max 1000 chars)</span>
            <textarea
              rows={5}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
            />
          </label>
        </div>

        <div className="pallet-part">
          <label className="field">
            <span>Seller Code</span>
            <input
              value={sellerCode}
              onChange={(e) => setSellerCode(e.target.value)}
              placeholder="e.g. 165dc277-b"
              autoComplete="off"
              enterKeyHint="done"
            />
          </label>
        </div>

        {preview.length > 0 && (
          <div className="preview-box">
            <span className="muted">Preview sequence</span>
            <strong>{preview.join(' → ')}</strong>
          </div>
        )}

        {error && (
          <p ref={errorRef} className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn primary capture" disabled={busy}>
          {busy ? 'Starting…' : 'Start session'}
        </button>
      </form>
    </section>
  )
}
