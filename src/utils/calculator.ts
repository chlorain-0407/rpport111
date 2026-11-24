import { PropertyData } from '../types/property';
import { BuyerRequirements } from '../types/report';

export interface UnitPriceResult {
  hasDeductedPrice: boolean;
  unitPrice: number | null; // 萬元/坪（主要呈現口徑；扣車位或毛單價）
  deductedUnitPrice: number | null; // 萬元/坪（僅可扣車位時有值）
  grossUnitPrice: number | null; // 萬元/坪（含車位或無車位毛單價）
  caliberLabel: string;
  explanation: string;
}

export interface BudgetComparisonResult {
  status: 'within' | 'over' | 'under' | 'unknown';
  diffWan: number | null;
  summary: string;
}

function toFiniteNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * 依據台灣房仲與實價登錄規範計算單價口徑：
 * 扣車位單價只在總價與總坪數確實包含同一車位，且已知車位價格(>0)、車位坪數(>0)、扣除後坪數大於零時，
 * 以「（總價－車位價）÷（總坪數－車位坪數）」計算。
 * 車位價或車位坪數不完整時，不算扣車位單價，明確標示口徑。
 * 總價或總坪數為空 (null) 時，回傳 null（顯示「待確認」），絕不誤計為 0。
 */
export function calculateUnitPrice(property: Partial<PropertyData>): UnitPriceResult {
  const askingPrice = toFiniteNumber(property.askingPrice);
  const totalArea = toFiniteNumber(property.totalArea);
  const parkingIncluded = property.parkingIncluded;
  const parkingPrice = toFiniteNumber(property.parkingPrice);
  const parkingArea = toFiniteNumber(property.parkingArea);
  const parkingType = property.parkingType || '';

  if (askingPrice === null || totalArea === null || totalArea <= 0) {
    return {
      hasDeductedPrice: false,
      unitPrice: null,
      deductedUnitPrice: null,
      grossUnitPrice: null,
      caliberLabel: '待確認 (缺開價或總坪數)',
      explanation: '開價總金額或權狀總坪數尚未完整記載，暫不計算每坪單價。',
    };
  }

  const grossUnitPrice = Number((askingPrice / totalArea).toFixed(2));

  if (parkingType === '無車位' || parkingIncluded === false) {
    return {
      hasDeductedPrice: false,
      unitPrice: grossUnitPrice,
      deductedUnitPrice: null,
      grossUnitPrice,
      caliberLabel: parkingType === '無車位' ? '無車位純房屋單價' : '房屋開價單價 (車位另計)',
      explanation: `本案開價未含車位或無附屬車位，依「${askingPrice} 萬元 ÷ ${totalArea.toFixed(2)} 坪」計算單價為 ${grossUnitPrice} 萬元/坪。`,
    };
  }

  if (parkingIncluded === null || parkingIncluded === undefined) {
    return {
      hasDeductedPrice: false,
      unitPrice: grossUnitPrice,
      deductedUnitPrice: null,
      grossUnitPrice,
      caliberLabel: '含/未含車位待確認 (毛單價參考)',
      explanation: `尚未確認車位是否含於開價內，僅依總價 ${askingPrice} 萬元 ÷ 總坪數 ${totalArea.toFixed(2)} 坪列示毛單價 ${grossUnitPrice} 萬元/坪。`,
    };
  }

  // parkingIncluded === true
  const canDeduct =
    parkingPrice !== null &&
    parkingPrice > 0 &&
    parkingArea !== null &&
    parkingArea > 0 &&
    totalArea - parkingArea > 0 &&
    askingPrice - parkingPrice >= 0;

  if (canDeduct) {
    const netPrice = askingPrice - parkingPrice;
    const netPing = totalArea - parkingArea;
    const deductedUnitPrice = Number((netPrice / netPing).toFixed(2));

    return {
      hasDeductedPrice: true,
      unitPrice: deductedUnitPrice,
      deductedUnitPrice,
      grossUnitPrice,
      caliberLabel: '扣車位單價',
      explanation: `依標準公式「（總價 ${askingPrice} 萬 - 車位 ${parkingPrice} 萬 = ${netPrice} 萬）÷（總坪數 ${totalArea.toFixed(2)} 坪 - 車位 ${parkingArea.toFixed(2)} 坪 = 淨坪 ${netPing.toFixed(2)} 坪）」計算為 ${deductedUnitPrice} 萬元/坪；含車位毛單價為 ${grossUnitPrice} 萬元/坪。`,
    };
  }

  return {
    hasDeductedPrice: false,
    unitPrice: grossUnitPrice,
    deductedUnitPrice: null,
    grossUnitPrice,
    caliberLabel: '含車位單價 (車位未拆分)',
    explanation: `車位價格或車位坪數未拆分記載，依規定不計算扣車位單價，僅依總價與總坪數列示含車位毛單價 ${grossUnitPrice} 萬元/坪。`,
  };
}

export function calculatePublicRatio(
  property: Partial<PropertyData>
): { ratio: number | null; label: string; pureRatio?: number | null; detail?: string } {
  const main = toFiniteNumber(property.mainArea);
  const aux = toFiniteNumber(property.auxArea) ?? 0;
  const common = toFiniteNumber(property.commonArea);
  const parkingArea = toFiniteNumber(property.parkingArea);

  if (main === null || common === null || main <= 0 || common <= 0) {
    return { ratio: null, label: '待確認 (資料不足)' };
  }

  const totalLiving = main + aux + common;
  if (totalLiving <= 0) {
    return { ratio: null, label: '待確認' };
  }

  const ratio = Number(((common / totalLiving) * 100).toFixed(1));

  if (property.parkingAreaIncludedInCommon === true && parkingArea !== null && parkingArea > 0 && common > parkingArea) {
    const pureCommon = Number((common - parkingArea).toFixed(2));
    const pureTotal = main + aux + pureCommon;
    const pureRatio = pureTotal > 0 ? Number(((pureCommon / pureTotal) * 100).toFixed(1)) : null;
    return {
      ratio,
      pureRatio,
      label: pureRatio !== null ? `${ratio}%（含車位公設）／約 ${pureRatio}%（扣車位純公設）` : `${ratio}%（公設內含車位 ${parkingArea.toFixed(2)} 坪）`,
      detail: `共有部分 ${common.toFixed(2)} 坪內含車位 ${parkingArea.toFixed(2)} 坪（扣除車位純公設 ${pureCommon.toFixed(2)} 坪），不重複計入總坪數。`,
    };
  }

  return { ratio, label: `${ratio}%` };
}

export function calculateBudgetComparison(
  askingPriceRaw: number | null | undefined,
  buyerInput?: Partial<BuyerRequirements> | null
): BudgetComparisonResult {
  const askingPrice = toFiniteNumber(askingPriceRaw);
  const budgetMin = toFiniteNumber(buyerInput?.budgetMin);
  const budgetMax = toFiniteNumber(buyerInput?.budgetMax);

  if (askingPrice === null || !buyerInput || (budgetMin === null && budgetMax === null)) {
    return {
      status: 'unknown',
      diffWan: null,
      summary: '開價或買方預算區間尚未填寫，暫無法比對預算差額。',
    };
  }

  if (budgetMax !== null && askingPrice > budgetMax) {
    const diff = Number((askingPrice - budgetMax).toFixed(1));
    return {
      status: 'over',
      diffWan: diff,
      summary: `開價 ${askingPrice.toLocaleString('zh-TW')} 萬元，超出買方預算上限 ${budgetMax.toLocaleString('zh-TW')} 萬元共 ${diff.toLocaleString('zh-TW')} 萬元。`,
    };
  }

  if (budgetMin !== null && askingPrice < budgetMin) {
    const diff = Number((budgetMin - askingPrice).toFixed(1));
    return {
      status: 'under',
      diffWan: diff,
      summary: `開價 ${askingPrice.toLocaleString('zh-TW')} 萬元，低於買方預算下限 ${budgetMin.toLocaleString('zh-TW')} 萬元共 ${diff.toLocaleString('zh-TW')} 萬元。`,
    };
  }

  return {
    status: 'within',
    diffWan: 0,
    summary: `開價 ${askingPrice.toLocaleString('zh-TW')} 萬元，落於買方預算區間（${budgetMin !== null ? budgetMin.toLocaleString('zh-TW') : '不限'}–${budgetMax !== null ? budgetMax.toLocaleString('zh-TW') : '不限'} 萬元）內。`,
  };
}

export function formatWan(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '待確認';
  return `${Number(val).toLocaleString('zh-TW')} 萬元`;
}

export function formatPing(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '待確認';
  return `${Number(val).toFixed(2)} 坪`;
}

export function formatCountOrEmpty(val: number | null | undefined, unit = ''): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '尚無紀錄';
  return `${Number(val).toLocaleString('zh-TW')}${unit ? ` ${unit}` : ''}`;
}

export const MANAGEMENT_FEE_PERIOD_LABELS: Record<string, string> = {
  monthly: '每月',
  quarterly: '每季',
  half_year: '每半年',
  yearly: '每年',
  unknown: '計費週期待確認',
};

export function computeManagementFeeMonthly(
  amount: number | null | undefined,
  period?: string | null
): number | null {
  const num = toFiniteNumber(amount);
  if (num === null || num < 0) return null;
  switch (period) {
    case 'monthly':
      return Math.round(num);
    case 'quarterly':
      return Math.round(num / 3);
    case 'half_year':
      return Math.round(num / 6);
    case 'yearly':
      return Math.round(num / 12);
    default:
      return null;
  }
}

export function formatManagementFee(property: Partial<PropertyData> | null | undefined): string {
  if (!property) return '待確認';
  const amount = toFiniteNumber(property.managementFeeAmount);
  const period = property.managementFeePeriod;
  const monthly = toFiniteNumber(property.managementFee);
  const raw = (property.managementFeeRaw || '').trim();

  if (amount !== null) {
    if (period === 'monthly') {
      return `${amount.toLocaleString('zh-TW')} 元／月`;
    }
    if (period === 'half_year' || period === 'quarterly' || period === 'yearly') {
      const periodText = period === 'half_year' ? '半年' : period === 'quarterly' ? '季' : '年';
      const avg = monthly ?? computeManagementFeeMonthly(amount, period);
      const rawDisplay = `${amount.toLocaleString('zh-TW')} 元／${periodText}`;
      return avg !== null ? `${rawDisplay}（月均約 ${avg.toLocaleString('zh-TW')} 元）` : rawDisplay;
    }
    if (period === 'unknown') {
      return `${amount.toLocaleString('zh-TW')} 元（計費週期待確認）`;
    }
  }

  if (monthly !== null) {
    return `${monthly.toLocaleString('zh-TW')} 元／月`;
  }
  if (raw) {
    return `${raw}（計費週期待確認）`;
  }
  return '待確認';
}

/**
 * 安全轉換格局欄位為可編輯字串（不附加「廳衛待確認」提示字樣），防範 AI 回傳物件造成 React 崩潰
 */
export function normalizeLayoutInput(layout: any): string {
  if (layout === null || layout === undefined || layout === '') return '';
  if (typeof layout === 'string') {
    const trimmed = layout.trim();
    return trimmed === '待確認' || trimmed === '待補' ? '' : trimmed;
  }
  if (typeof layout === 'object') {
    const r = layout.rooms ?? layout.room ?? layout.bed ?? layout.bedroom ?? 0;
    const l = layout.livingRooms ?? layout.livingRoom ?? layout.hall ?? 0;
    const b = layout.bathrooms ?? layout.bathroom ?? layout.bath ?? 0;
    const balcony = layout.balconies ?? layout.balcony ?? 0;
    if (r === 0 && l === 0 && b === 0) return '';
    let res = `${r}房`;
    if (l > 0 || b > 0) res += `${l}廳${b}衛`;
    if (balcony > 0) res += `${balcony}陽台`;
    return res;
  }
  return String(layout).trim();
}

/**
 * 判斷是否僅取得房數而缺少廳、衛資訊（例如 "3房"），此情況屬部分資訊，不得計為完整格局。
 */
export function isPartialLayout(layout: any): boolean {
  const norm = normalizeLayoutInput(layout);
  if (!norm) return false;
  return /\d+\s*房/.test(norm) && !/\d+\s*[廳衛]/.test(norm);
}

/**
 * 安全格式化格局資訊供顯示用，若僅得房數則明確附註「（廳衛待確認）」。
 */
export function formatLayout(layout: any): string {
  const norm = normalizeLayoutInput(layout);
  if (!norm) return '待確認';
  if (isPartialLayout(norm)) return `${norm}（廳衛待確認）`;
  return norm;
}

/**
 * 樓層格式化：保留原文同時正規化中文格式（例：5樓/10樓、10F/14F、10樓／14樓 -> 10 樓／共 14 樓），
 * 避免重複出現「5樓/10樓F」。地下層、整棟、跨樓層保留原文，不明資料標「待確認」。
 */
export function formatFloor(floor: any, totalFloors?: any, floorRaw?: string): string {
  const fRawVal = typeof floor === 'object' ? (floor?.current || floor?.floor || '') : (floor ?? '');
  const tfRawVal =
    typeof totalFloors === 'object' ? (totalFloors?.total || totalFloors?.totalFloors || '') : (totalFloors ?? '');
  const rawInput = (floorRaw || '').trim();
  const fStr = String(fRawVal).trim();
  const tfStr = String(tfRawVal).trim();

  const combinedCandidate = rawInput || (fStr && tfStr ? `${fStr}/${tfStr}` : fStr);
  if (!combinedCandidate && !tfStr) return '待確認';

  const cleanNum = (s: string): string | null => {
    const stripped = s.replace(/^[共]/, '').replace(/[樓F]$/i, '').trim();
    return /^\d+$/.test(stripped) ? stripped : null;
  };

  const fNum = fStr ? cleanNum(fStr) : null;
  const tfNum = tfStr ? cleanNum(tfStr) : null;
  if (fNum && tfNum) {
    return `${fNum} 樓／共 ${tfNum} 樓`;
  }

  // Parse slash / fullwidth slash expression e.g. "5樓/10樓", "10F/14F", "10樓／14樓", "B1/12樓"
  const slashSource = rawInput || fStr;
  if (slashSource && /[\/／]/.test(slashSource)) {
    const parts = slashSource.split(/[\/／]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 2) {
      const leftNum = cleanNum(parts[0]);
      const rightNum = cleanNum(parts[1]);
      if (leftNum && rightNum) {
        return `${leftNum} 樓／共 ${rightNum} 樓`;
      }
      const leftDisp = leftNum ? `${leftNum} 樓` : parts[0];
      const rightDisp = rightNum ? `共 ${rightNum} 樓` : parts[1];
      return `${leftDisp}／${rightDisp}`;
    }
  }

  if (/整棟|全棟|透天/.test(combinedCandidate)) {
    return tfNum ? `整棟（共 ${tfNum} 樓）` : combinedCandidate;
  }

  if (fNum && !tfStr) return `${fNum} 樓`;
  if (!fStr && tfNum) return `樓層待確認／共 ${tfNum} 樓`;

  // Basement or multi-floor e.g. "B1", "3-4樓", "地下1樓"
  if (fStr && tfNum) return `${fStr}／共 ${tfNum} 樓`;
  return rawInput || fStr || (tfStr ? `樓層待確認／共 ${tfStr} 樓` : '待確認');
}

export interface CoreCompletenessChecklist {
  coreFields: Array<{ key: string; label: string; status: string; available: boolean }>;
  advancedFields: Array<{ key: string; label: string; status: string; available: boolean }>;
  coreAvailable: number;
  coreTotal: number;
  totalAvailable: number;
  totalApplicable: number;
  statusCounts: {
    recorded: number;
    verified: number;
    pending: number;
    not_applicable: number;
    conflict: number;
  };
  missingCoreLabels: string[];
  missingAdvancedLabels: string[];
  summaryText: string;
}

/**
 * 依固定核心與進階欄位檢核清單計算「已取得 X／Y 個可用欄位」，不以單次 AI 回傳充數為 100%。
 * 僅得「3房」而無廳衛數時，格局標記為 pending（待補廳衛），不計入已完成。
 */
export function resolvePropertyFieldStatus(property: Partial<PropertyData> | null | undefined, key: string): string {
  const p: any = property || {};
  const fs: Record<string, string> = p.fieldStatus && typeof p.fieldStatus === 'object' ? p.fieldStatus : {};

  const isPresent = (key: string): boolean => {
    const val = p[key];
    if (fs[key] === 'not_applicable') return true;
    if (key === 'layout') {
      const norm = normalizeLayoutInput(val);
      if (!norm || isPartialLayout(norm)) return false;
      return true;
    }
    if (key === 'floor') return Boolean(p.floor || p.floorRaw);
    if (key === 'hasParking') return p.hasParking !== null && p.hasParking !== undefined;
    if (key === 'parkingIncluded') {
      if (p.hasParking === false || p.parkingType === '無車位') return true;
      return p.parkingIncluded !== null && p.parkingIncluded !== undefined;
    }
    if (key === 'managementFeePeriod') {
      if (p.managementFeeAmount === 0) return true;
      return Number.isFinite(p.managementFeeAmount ?? p.managementFee) &&
        Boolean(p.managementFeePeriod && p.managementFeePeriod !== 'unknown');
    }
    if (typeof val === 'boolean') return true;
    if (typeof val === 'number') return Number.isFinite(val);
    if (typeof val === 'string') return val.trim().length > 0 && val.trim() !== '待確認' && val.trim() !== '[object Object]';
    return false;
  };

  const resolveStatus = (key: string): string => {
    if (key === 'layout' && isPartialLayout(p.layout)) {
      return 'pending';
    }
    if (fs[key] === 'conflict') return 'conflict';
    if (key === 'parkingIncluded' && (p.hasParking === false || p.parkingType === '無車位')) {
      return 'not_applicable';
    }
    if (
      (key === 'parkingType' || key === 'parkingOwnership' || key === 'parkingArea' || key === 'parkingPrice') &&
      (p.hasParking === false || p.parkingType === '無車位')
    ) {
      return 'not_applicable';
    }
    if (!isPresent(key)) return 'pending';
    return fs[key] || 'recorded';
  };
  return resolveStatus(key);
}

export function calculatePropertyCompleteness(property: Partial<PropertyData> | null | undefined): CoreCompletenessChecklist {
  const p = property || {};
  const resolveStatus = (key: string) => resolvePropertyFieldStatus(p, key);

  const coreSpec: Array<{ key: string; label: string }> = [
    { key: 'caseName', label: '案名' },
    { key: 'cityDistrict', label: '縣市行政區' },
    { key: 'address', label: '路段地址' },
    { key: 'propertyType', label: '建物型態' },
    { key: 'askingPrice', label: '現行開價' },
    { key: 'totalArea', label: '權狀總坪數' },
    { key: 'mainArea', label: '主建物坪數' },
    { key: 'commonArea', label: '共有部分(公設)' },
    { key: 'layout', label: isPartialLayout(p.layout) ? '格局（廳衛待確認）' : '格局' },
    { key: 'floor', label: '樓層/總樓層' },
    { key: 'age', label: '屋齡' },
    { key: 'hasParking', label: '有無車位' },
  ];

  const advancedSpec: Array<{ key: string; label: string }> = [
    { key: 'auxArea', label: '附屬建物坪數' },
    { key: 'parkingIncluded', label: '車位是否含總價' },
    { key: 'parkingType', label: '車位型式' },
    { key: 'parkingOwnership', label: '車位權屬' },
    { key: 'parkingArea', label: '車位坪數' },
    { key: 'parkingPrice', label: '車位獨立價格' },
    { key: 'managementFeePeriod', label: '管理費與計費週期' },
  ];

  const coreFields = coreSpec.map((item) => {
    const status = resolveStatus(item.key);
    return {
      ...item,
      status,
      available: status === 'recorded' || status === 'verified' || status === 'not_applicable',
    };
  });

  const advancedFields = advancedSpec.map((item) => {
    const status = resolveStatus(item.key);
    return {
      ...item,
      status,
      available: status === 'recorded' || status === 'verified' || status === 'not_applicable',
    };
  });

  const all = [...coreFields, ...advancedFields];
  const statusCounts = {
    recorded: all.filter((f) => f.status === 'recorded').length,
    verified: all.filter((f) => f.status === 'verified').length,
    pending: all.filter((f) => f.status === 'pending').length,
    not_applicable: all.filter((f) => f.status === 'not_applicable').length,
    conflict: all.filter((f) => f.status === 'conflict').length,
  };

  const applicableFields = all.filter((f) => f.status !== 'not_applicable');
  const totalAvailable = applicableFields.filter(
    (f) => f.status === 'recorded' || f.status === 'verified'
  ).length;
  const totalApplicable = applicableFields.length;
  const coreAvailable = coreFields.filter((f) => f.available).length;
  const coreTotal = coreFields.length;

  const missingCoreLabels = coreFields.filter((f) => f.status === 'pending').map((f) => f.label);
  const missingAdvancedLabels = advancedFields.filter((f) => f.status === 'pending').map((f) => f.label);

  return {
    coreFields,
    advancedFields,
    coreAvailable,
    coreTotal,
    totalAvailable,
    totalApplicable,
    statusCounts,
    missingCoreLabels,
    missingAdvancedLabels,
    summaryText: `核心欄位已取得 ${coreAvailable}／${coreTotal} 項（總可用欄位 ${totalAvailable}／${totalApplicable} 項）`,
  };
}


