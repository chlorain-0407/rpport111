export type SourceType = 'database' | 'url' | 'manual' | 'screenshot';

export type FieldVerificationStatus =
  | 'verified'
  | 'recorded'
  | 'pending'
  | 'not_applicable'
  | 'conflict';

export type ManagementFeePeriod = 'monthly' | 'half_year' | 'quarterly' | 'yearly' | 'unknown' | '';

export interface FieldConflict {
  field: string;
  fieldLabel: string;
  sourceA: {
    sourceName: string;
    value: any;
    excerpt: string;
    timestamp: string;
  };
  sourceB: {
    sourceName: string;
    value: any;
    excerpt: string;
    timestamp: string;
  };
  resolved: boolean;
  resolvedValue?: any;
}

export interface PropertyData {
  id: string;
  caseId: string;
  caseName: string;
  cityDistrict: string;
  address: string;
  propertyType: '電梯大樓' | '華廈' | '透天別墅' | '公寓' | '';
  askingPrice: number | null; // 現行開價（萬元）；null 代表待確認
  previousAskingPrice?: number | null; // 舊開價／降價前原開價（萬元）
  hasParking?: boolean | null; // 是否有車位；null 代表待確認
  parkingIncluded: boolean | null; // 是否含在總價內；null 代表待確認
  totalArea: number | null; // 坪
  mainArea: number | null; // 坪
  auxArea: number | null; // 坪
  commonArea: number | null; // 坪
  parkingArea: number | null; // 坪
  parkingAreaIncludedInCommon?: boolean | null; // 車位坪數是否含在公設內
  parkingPrice: number | null; // 萬元
  parkingType: '坡道平面' | '坡道機械' | '機械機械' | '平面式' | '無車位' | '其他' | '';
  parkingOwnership?: string; // 車位權屬（如：私有、共有、約定專用）
  layout: string; // 例如 4房2廳2衛；'' 代表待確認
  floor: string; // 例如 5；'' 代表待確認
  totalFloors: string; // 例如 10；'' 代表待確認
  floorRaw?: string; // 原始樓層記載（例如 5樓/10樓、B1、整棟、3-4樓）
  age: number | null; // 年
  managementFee: number | null; // 換算後月均管理費（元/月，僅計費週期已知時計算）
  managementFeeAmount?: number | null; // 原始管理費金額
  managementFeePeriod?: ManagementFeePeriod; // 計費週期
  managementFeeRaw?: string; // 原始管理費記載文字（例如 5,582元/半年）
  currentUsage: '自住' | '空屋' | '出租中' | '其他' | '';
  photos: string[];
  isDemo?: boolean;

  // Confidential fields (NEVER exported to client version or sent to client AI report)
  internalNotes: string;
  reservePrice: number | null; // 屋主底價

  // Field provenance & evidence
  fieldStatus: Record<string, FieldVerificationStatus>;
  evidenceSummaries: Record<string, string>;
  conflicts: FieldConflict[];

  // Source tracking
  sourceType: SourceType;
  sourceId: string;
  sourcePlatform?: string; // 例如：住商不動產、591房屋交易、太平洋房屋
  sourceListingId?: string; // 外部平台物件編號（例如：BS56978、20935915）
  sourceUrl?: string;
  fetchedAt?: string;
  updatedAt: string;
}

export function hasUnresolvedPrice(property: Pick<PropertyData, 'fieldStatus' | 'conflicts'>): boolean {
  return property.fieldStatus?.askingPrice === 'conflict' ||
    Boolean(property.conflicts?.some((conflict) => conflict.field === 'askingPrice' && !conflict.resolved));
}

export interface ComparableSale {
  id: string;
  propertyId?: string;
  communityName: string;
  dealDate: string; // 例如 114/11
  totalPrice: number; // 萬元
  totalPing: number; // 坪
  parkingPrice: number | null; // 萬元
  parkingPing: number | null; // 坪
  unitPrice: number; // 萬元/坪
  parkingCaliber: '扣車位單價' | '含車位單價' | '無車位';
  floor: string;
  age: number | null;
  comparabilityNotes: string;
  source: string;
  isDemo?: boolean;
}

export interface CompetingListing {
  id: string;
  propertyId?: string;
  title: string;
  communityName: string;
  askingPrice: number; // 萬元
  totalPing: number; // 坪
  unitPrice: number; // 萬元/坪
  parkingCaliber: string;
  layout: string;
  floor: string;
  source: string;
  comparativeAdvantage: string;
  isDemo?: boolean;
}
