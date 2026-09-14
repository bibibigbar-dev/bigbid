import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import type { Product } from '../types'

function safeFileName(productNo: string): string {
  const cleaned = productNo.trim().replace(/[\\/:*?"<>|]/g, '_')
  return cleaned || 'unknown'
}

function csvEscape(value: string | number | null | undefined): string {
  const s = (value == null ? '' : String(value)).replace(/\r?\n/g, '\r\n')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function saleOrderOnlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function buildLotsCsv(products: Product[], sellerCode: string): string {
  const header = 'Lot Number, Sale Order, Title, Description, Start Bid Each, Seller Code'
  const rows = products.map((p) =>
    [
      csvEscape(p.productNo),
      csvEscape(saleOrderOnlyDigits(p.sortNo)),
      csvEscape(p.name),
      csvEscape(p.description),
      csvEscape(p.bidPrice ?? ''),
      csvEscape(sellerCode),
    ].join(','),
  )
  return [header, ...rows].join('\r\n')
}

export function downloadLotsCsv(
  products: Product[],
  sellerCode: string,
  palletId: string,
): string {
  const csv = buildLotsCsv(products, sellerCode)
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const filename = `${safeFileName(palletId)}_lots.csv`
  saveAs(blob, filename)
  return filename
}

function buildCsvFile(
  products: Product[],
  sellerCode: string,
  palletId: string,
): { file: File; filename: string } {
  const filename = `${safeFileName(palletId)}_lots.csv`
  const csv = buildLotsCsv(products, sellerCode)
  const file = new File(['\uFEFF', csv], filename, { type: 'text/csv;charset=utf-8' })
  return { file, filename }
}

/**
 * Best-effort "email with attachment" from a browser:
 * 1) Web Share with the CSV file (phone Mail/Gmail can attach it)
 * 2) Fallback: download CSV + open mailto (manual attach)
 *
 * True one-tap send with attachment requires a backend email API.
 */
export async function shareOrEmailLotsCsv(
  products: Product[],
  sellerCode: string,
  palletId: string,
  to = '',
): Promise<'shared' | 'mailto'> {
  const { file, filename } = buildCsvFile(products, sellerCode, palletId)

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `${palletId} lots`,
        text: `${filename} — choose Mail / Gmail to send with attachment.`,
      })
      return 'shared'
    } catch (e) {
      // User cancelled share sheet — don't fall through to mailto noise
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw e
      }
    }
  }

  saveAs(file, filename)
  const lines = products
    .slice(0, 30)
    .map((p) => `${p.productNo}\t${saleOrderOnlyDigits(p.sortNo)}\t${p.name}\t${p.bidPrice ?? ''}`)
  const body = [
    `CSV downloaded as ${filename}.`,
    'This browser cannot auto-attach files to email.',
    'Please attach the downloaded CSV, or use Share on a phone.',
    '',
    'Lot Number\tSale Order\tTitle\tStart Bid Each',
    ...lines,
    products.length > 30 ? `\n…and ${products.length - 30} more` : '',
  ].join('\n')

  const subject = encodeURIComponent(`${palletId} lots`)
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${encodeURIComponent(body)}`
  return 'mailto'
}

export async function downloadPhotosZip(
  products: Product[],
  palletId: string,
): Promise<void> {
  const zip = new JSZip()

  for (const p of products) {
    const base = safeFileName(p.productNo)
    p.imageBlobs.forEach((blob, index) => {
      const name = index === 0 ? `${base}.jpg` : `${base}-${index + 1}.jpg`
      zip.file(name, blob)
    })
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  saveAs(blob, `${safeFileName(palletId)}_photos.zip`)
}

export async function shareZipIfPossible(
  products: Product[],
  palletId: string,
): Promise<boolean> {
  if (!navigator.share || !navigator.canShare) return false

  const zip = new JSZip()
  for (const p of products) {
    const base = safeFileName(p.productNo)
    p.imageBlobs.forEach((blob, index) => {
      const name = index === 0 ? `${base}.jpg` : `${base}-${index + 1}.jpg`
      zip.file(name, blob)
    })
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const file = new File([blob], `${safeFileName(palletId)}_photos.zip`, {
    type: 'application/zip',
  })

  if (!navigator.canShare({ files: [file] })) return false
  await navigator.share({ files: [file], title: `${palletId} photos` })
  return true
}
