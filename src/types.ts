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

export type BidPriceSettings = {
  upTo20: number
  upTo50: number
  upTo100: number
  upTo150: number
  upTo250: number
  over250: number
}

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
  /** When source is Amazon, attach one Amazon hero image automatically */
  addAmazonReferencePhoto: boolean
  bidPriceSettings: BidPriceSettings
  lotDescription: LotDescriptionSettings
}

export type AiFillStatus = 'pending' | 'completed' | 'failed'

export type Product = {
  id: string
  productNo: string
  /** HiBid Sale Order */
  sortNo: string
  name: string
  description: string
  salePrice: number | null
  bidPrice: number | null
  imageBlobs: Blob[]
  aiFillStatus: AiFillStatus
  aiFillError: string | null
  createdAt: number
  updatedAt: number
}

export type ProductInput = {
  productNo: string
  sortNo: string
  name: string
  description: string
  salePrice: number | null
  bidPrice: number | null
  imageBlobs: Blob[]
  aiFillStatus?: AiFillStatus
  aiFillError?: string | null
}

export const MAX_CAPTURE_PHOTOS_PER_PRODUCT = 10
export const MAX_PHOTOS_PER_PRODUCT = MAX_CAPTURE_PHOTOS_PER_PRODUCT + 1
