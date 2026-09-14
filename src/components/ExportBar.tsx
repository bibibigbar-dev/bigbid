import { useState } from 'react'
import type { Product } from '../types'
import {
  downloadLotsCsv,
  downloadPhotosZip,
  shareOrEmailLotsCsv,
  shareZipIfPossible,
} from '../lib/export'
import { deleteProducts } from '../lib/db'

type Props = {
  products: Product[]
  selectedIds: string[]
  palletId: string
  sellerCode: string
  onChanged: () => Promise<void>
  onStartOver: () => Promise<void>
}

export function ExportBar({
  products,
  selectedIds,
  palletId,
  sellerCode,
  onChanged,
  onStartOver,
}: Props) {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [confirmingStartOver, setConfirmingStartOver] = useState(false)
  const target =
    selectedIds.length > 0
      ? products.filter((p) => selectedIds.includes(p.id))
      : products

  async function run(label: string, fn: () => Promise<void> | void) {
    if (target.length === 0) {
      setMessage('Nothing to export.')
      return
    }
    setBusy(label)
    setMessage('')
    try {
      await fn()
      setMessage(
        `Done for ${target.length} lot(s). Originals remain in the app until you delete them.`,
      )
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setMessage('Cancelled.')
        return
      }
      setMessage(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy('')
    }
  }

  async function handleDelete() {
    if (selectedIds.length === 0) {
      setMessage('Select lots to delete.')
      return
    }
    if (!confirm(`Delete ${selectedIds.length} selected lot(s) from the app?`)) return
    setBusy('delete')
    try {
      await deleteProducts(selectedIds)
      await onChanged()
      setMessage(`Deleted ${selectedIds.length} lot(s).`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy('')
    }
  }

  async function handleStartOver() {
    setBusy('start-over')
    setMessage('')
    setConfirmingStartOver(false)
    try {
      await onStartOver()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Start over failed')
      setBusy('')
    }
  }

  return (
    <section className="export-bar">
      <h2 className="export-title">Complete</h2>
      <p className="export-hint">
        Exports as <strong>{palletId}_lots.csv</strong> and photo ZIP. On phone, Share Item List
        .CSV can open Mail with the file attached. Fully automatic send needs a mail server later.
      </p>
      <div className="export-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!!busy}
          onClick={() =>
            void (async () => {
              if (target.length === 0) {
                setMessage('Nothing to export.')
                return
              }
              setBusy('mail')
              setMessage('')
              try {
                const mode = await shareOrEmailLotsCsv(target, sellerCode, palletId)
                setMessage(
                  mode === 'shared'
                    ? 'Share sheet opened — pick Mail/Gmail to send with the CSV attached.'
                    : 'CSV downloaded. Attach it in the mail app (browsers cannot auto-attach).',
                )
              } catch (e) {
                if (e instanceof DOMException && e.name === 'AbortError') {
                  setMessage('Cancelled.')
                } else {
                  setMessage(e instanceof Error ? e.message : 'Action failed')
                }
              } finally {
                setBusy('')
              }
            })()
          }
        >
          {busy === 'mail' ? '…' : 'Share Item List .CSV'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() =>
            void run('csv', () => {
              downloadLotsCsv(target, sellerCode, palletId)
            })
          }
        >
          {busy === 'csv' ? '…' : 'Download Item List .CSV'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() =>
            void run('share', async () => {
              const ok = await shareZipIfPossible(target, palletId)
              if (!ok) await downloadPhotosZip(target, palletId)
            })
          }
        >
          {busy === 'share' ? '…' : 'Share Photo .ZIP'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() => void run('zip', () => downloadPhotosZip(target, palletId))}
        >
          {busy === 'zip' ? '…' : 'Download Photo .ZIP'}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!!busy}
          onClick={() => setConfirmingStartOver(true)}
        >
          {busy === 'start-over' ? '…' : 'Start Over'}
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={!!busy}
          onClick={() => void handleDelete()}
        >
          {busy === 'delete' ? '…' : 'Delete selected'}
        </button>
      </div>
      {confirmingStartOver && (
        <div className="confirm-backdrop" role="presentation">
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-over-title"
          >
            <h3 id="start-over-title">Start over?</h3>
            <p>
              This will delete the current list and return to the first screen. Do you want to
              continue?
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn danger"
                disabled={!!busy}
                onClick={() => void handleStartOver()}
              >
                Yes
              </button>
              <button
                type="button"
                className="btn"
                disabled={!!busy}
                onClick={() => setConfirmingStartOver(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {message && <p className="export-msg">{message}</p>}
    </section>
  )
}
