import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PALLET_SOURCES,
  type BidStrategy,
  type PalletConfig,
  type PalletSource,
  type PartMode,
  type SellerSettings,
} from '../types'
import { buildPalletConfig, peekSequence } from '../lib/pallet'
import { loadSellerSettings } from '../lib/seller'

type Props = {
  initial?: PalletConfig | null
  onConfirm: (config: PalletConfig, seller: SellerSettings) => void | Promise<void>
}

function ModeToggle({
  value,
  onChange,
}: {
  value: PartMode
  onChange: (mode: PartMode) => void
}) {
  return (
    <div className="mode-toggle" role="group">
      <button
        type="button"
        className={value === 'seq' ? 'active' : ''}
        onClick={() => onChange('seq')}
      >
        Sequential
      </button>
      <button
        type="button"
        className={value === 'fixed' ? 'active' : ''}
        onClick={() => onChange('fixed')}
      >
        Fixed
      </button>
    </div>
  )
}

export function PalletSetup({ initial, onConfirm }: Props) {
  const savedSeller = loadSellerSettings()
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [source, setSource] = useState<PalletSource>(initial?.source ?? 'amazon')
  const [numValue, setNumValue] = useState(initial?.numValue ?? '1')
  const [numMode, setNumMode] = useState<PartMode>(initial?.numMode ?? 'seq')
  const [alphaValue, setAlphaValue] = useState(initial?.alphaValue ?? '')
  const [alphaMode, setAlphaMode] = useState<PartMode>(initial?.alphaMode ?? 'fixed')
  const [sellerCode, setSellerCode] = useState(savedSeller.sellerCode)
  const [rememberSeller, setRememberSeller] = useState(savedSeller.remember ?? true)
  const [bidStrategy, setBidStrategy] = useState<BidStrategy>(
    savedSeller.bidStrategy ?? 'recommended',
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const preview = useMemo(() => {
    try {
      const draft = buildPalletConfig({ source, numValue, numMode, alphaValue, alphaMode })
      const cursor =
        initial &&
        initial.numValue === draft.numValue &&
        initial.alphaValue === draft.alphaValue &&
        initial.numMode === draft.numMode &&
        initial.alphaMode === draft.alphaMode
          ? { ...draft, nextNum: initial.nextNum, nextAlpha: initial.nextAlpha }
          : draft
      return peekSequence(cursor, 3)
    } catch {
      return []
    }
  }, [source, numValue, numMode, alphaValue, alphaMode, initial])

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!numValue.trim()) {
      setError('Enter starting digits.')
      return
    }
    setBusy(true)
    try {
      const config = buildPalletConfig({ source, numValue, numMode, alphaValue, alphaMode })
      await onConfirm(config, {
        sellerCode: sellerCode.trim(),
        remember: rememberSeller,
        bidStrategy,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please check your settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pallet-setup">
      <h1>Pallet setup</h1>
      <p className="muted setup-lead">
        Set pallet numbering, seller code, and which start-bid AI should use.
      </p>

      <form className="form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="pallet-part">
          <label className="field">
            <span>Pallet source site</span>
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
            <span>Digits</span>
            <ModeToggle value={numMode} onChange={setNumMode} />
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
            <span>Letters</span>
            <ModeToggle value={alphaMode} onChange={setAlphaMode} />
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
          <label className="check">
            <input
              type="checkbox"
              checked={rememberSeller}
              onChange={(e) => setRememberSeller(e.target.checked)}
            />
            Remember Seller Code on this device
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
