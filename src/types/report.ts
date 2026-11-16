import { PropertyData, ComparableSale, CompetingListing } from './property';

export type ReportType = 'owner' | 'buyer';
export type OwnerSubType = 'pre_listing' | 'progress';
export type ReportStatus = 'draft' | 'pending_review' | 'approved';
export type ReportFontScale = 90 | 100 | 110 | 125;

export const REPORT_FONT_SCALES: readonly ReportFontScale[] = [90, 100, 110, 125];

export interface ReportLayoutSettings {
  fontScale: ReportFontScale;
}

export function normalizeReportFontScale(value: unknown): ReportFontScale {
  const num = Number(value);
  if (num === 90 || num === 100 || num === 110 || num === 125) {
    return num;
  }
  return 100;
}

export interface ReportSection {
  id: string;
  title: string;
  contentMarkdown: string;
  originalAiContent?: string;
  isEditedManually: boolean;
  facts: string[];
  analysis: string[];
  pendingChecklist: string[];
}

export interface BuyerRequirements {
  propertyId?: string;
  buyerId: string;
  buyerNickname: string; // 例如：竹科陳先生首購
  buyerContact?: string; // 私密聯絡資料，絕不上浮至客戶預覽或 A4 匯出
  budgetMin: number | null; // 萬元
  budgetMax: number | null; // 萬元
  mustHaves: string[];
  preferences: string[];
  dealBreakers: string[];
  livingCircle: string;
  privateNotes?: string;
  isDemo?: boolean;
  updatedAt?: string;
}

export interface AnonymousFeedback {
  id: string;
  date: string;
  content: string;
  focus: '價格' | '採光動線' | '車位' | '屋況' | '其他';
}

export interface OwnerProgressData {
  id?: string;
  propertyId: string;
  periodStart: string;
  periodEnd: string;
  onlineImpressions: number | null; // null: 尚無紀錄, 0: 確認為零
  inquiryCount: number | null; // null: 尚無紀錄, 0: 確認為零
  showingCount: number | null; // null: 尚無紀錄, 0: 已確認為零次
  anonymousFeedback: AnonymousFeedback[];
  completedActions: string[];
  nextPlannedActions: string[];
  isDemo?: boolean;
  updatedAt?: string;
}

export interface BrokerProfile {
  name: string;
  title: string;
  phone: string;
  email: string;
  licenseNumber: string;
  storeName: string;
  brandName: string;
  brandLogoUrl?: string;
}

export interface ReportSourceEntry {
  label: string;
  category: 'property' | 'comparable' | 'competing' | 'progress' | 'buyer' | 'url';
  detail: string;
  url?: string;
  timestamp?: string;
  isDemo?: boolean;
}

export interface ComputedReportMetrics {
  askingPrice: number | null;
  grossUnitPrice: number | null;
  hasDeductedPrice: boolean;
  deductedUnitPrice: number | null;
  unitPriceCaliber: string;
  publicRatio: number | null;
  publicRatioLabel: string;
  budgetStatus?: 'within' | 'over' | 'under' | 'unknown';
  budgetDiffWan?: number | null;
  budgetSummary?: string;
  comparablesCount: number;
  competingCount: number;
}

export interface ReportDocument {
  id: string;
  requestId?: string;
  propertyId: string;
  propertySnapshot: PropertyData; // 保留自己的輸入快照與資料時間
  reportType: ReportType;
  subType: OwnerSubType;
  buyerRequirements?: BuyerRequirements;
  ownerProgress?: OwnerProgressData;
  comparables: ComparableSale[];
  competingListings: CompetingListing[];
  isDemo?: boolean;
  sourcesUsed?: ReportSourceEntry[];
  computedMetrics?: ComputedReportMetrics;
  layoutSettings?: ReportLayoutSettings;
  title: string;
  summary: string;
  sections: ReportSection[];
  version: number;
  status: ReportStatus;
  needsReReview?: boolean;
  reReviewReasons?: string[];
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface SectionDiffProposal {
  sectionId: string;
  sectionTitle: string;
  originalContent: string;
  proposedContent: string;
  summaryOfChanges: string;
  facts: string[];
  analysis: string[];
}
