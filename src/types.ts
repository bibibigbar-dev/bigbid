export type PartMode = 'fixed' | 'seq'

export const PALLET_SOURCES = ['amazon', 'target', 'walmart', 'lowes', 'homedepot'] as const
export type PalletSource = (typeof PALLET_SOURCES)[number]

export type PalletConfig = {
  /** Label used in export filenames, e.g. 1b */
  palletId: string
  source: PalletSource
  numValue: string
  numMode: PartMode
  alphaValue: string
  alphaMode: PartMode
  nextNum: string
  nextAlpha: string
}

export type BidStrategy = 'recommended' | 'aggressive'

export type LotCondition = 'New' | 'Open Box' | 'Used'
export type YesNo = 'Yes' | 'No'
export type FunctionalStatus = 'Yes' | 'No' | 'Unable to Test'

export type LotDescriptionSettings = {
  condition: LotCondition
  conditionNotes: string
  damage: YesNo
  functional: FunctionalStatus
  missingParts: YesNo
  packaging: YesNo
  description: string
}

export type SellerSettings = {
  sellerCode: string
  remember: boolean
  /** Which AI start-bid field to use. Default: recommended */
  bidStrategy: BidStrategy
  lotDescription: LotDescriptionSettings
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
