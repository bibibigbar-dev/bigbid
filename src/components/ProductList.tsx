import { useEffect, useState } from 'react'
import type { Product } from '../types'

type Props = {
  products: Product[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  onEdit: (product: Product) => void
}

export function ProductList({ products, selected, onToggle, onToggleAll, onEdit }: Props) {
  if (products.length === 0) {
    return (
      <div className="empty">
        <p>No lots yet.</p>
        <p className="muted">Capture photos to add the next lot.</p>
      </div>
    )
  }

  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id))

  return (
    <div className="list">
      <div className="list-toolbar">
        <label className="check">
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
          Select all
        </label>
        <span className="muted">{products.length} lots</span>
      </div>
      <ul className="product-list">
        {products.map((p) => (
          <ProductRow
            key={p.id}
            product={p}
            checked={selected.has(p.id)}
            onToggle={() => onToggle(p.id)}
            onEdit={() => onEdit(p)}
          />
        ))}
      </ul>
    </div>
  )
}

function ProductRow({
  product,
  checked,
  onToggle,
  onEdit,
}: {
  product: Product
  checked: boolean
  onToggle: () => void
  onEdit: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const cover = product.imageBlobs[0]
  const saleOrder = product.sortNo.replace(/\D/g, '')

  useEffect(() => {
    if (!cover) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(cover)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [cover])

  return (
    <li className="product-row">
      <label className="check shrink">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </label>
      <button type="button" className="product-main" onClick={onEdit}>
        {url && <img src={url} alt="" className="thumb" />}
        <div className="meta">
          <strong>
            #{product.productNo}{' '}
            <span className="muted">
              Sale Order {saleOrder} · {product.imageBlobs.length} photo
              {product.imageBlobs.length === 1 ? '' : 's'}
            </span>
          </strong>
          <span>{product.name || '(untitled)'}</span>
          <span className="muted prices">
            retail {product.salePrice ?? '—'} · bid {product.bidPrice ?? '—'}
          </span>
        </div>
      </button>
    </li>
  )
}
