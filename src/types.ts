export type PartMode = 'fixed' | 'seq'

export type PalletConfig = {
  /** Label used in export filenames, e.g. 1b */
  palletId: string
  numValue: string
  numMode: PartMode
  alphaValue: string
  alphaMode: PartMode
  nextNum: string
  nextAlpha: string
}

export type BidStrategy = 'recommended' | 'aggressive'

export type SellerSettings = {
  sellerCode: string
  remember: boolean
  /** Which AI start-bid field to use. Default: recommended */
  bidStrategy: BidStrategy
}

export type Product = {
  id: string
  productNo: string
  /** Same as productNo (HiBid Sale Order = Lot Number) */
  sortNo: string
  name: string
  description: string
  salePrice: number | null
  bidPrice: number | null
  imageBlobs: Blob[]
  createdAt: number
  updatedAt: number
}

export type ProductInput = {
  productNo: string
  name: string
  description: string
  salePrice: number | null
  bidPrice: number | null
  imageBlobs: Blob[]
}

export const MAX_PHOTOS_PER_PRODUCT = 10
