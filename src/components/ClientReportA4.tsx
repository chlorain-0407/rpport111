import React, { useState } from 'react';
import {
  Printer,
  ArrowLeft,
  ShieldCheck,
  Phone,
  Mail,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Lock,
  Info,
} from 'lucide-react';
import {
  ReportDocument,
  ReportFontScale,
  BrokerProfile,
  ReportSourceEntry,
  normalizeReportFontScale,
} from '../types/report';
import {
  calculateUnitPrice,
  calculatePublicRatio,
  calculateBudgetComparison,
  formatWan,
  formatPing,
  formatLayout,
  formatFloor,
  formatCountOrEmpty,
  formatManagementFee,
} from '../utils/calculator';
import { SafeMarkdown } from './SafeMarkdown';
import { ReportFontScaleControl } from './ReportFontScaleControl';

interface ClientReportA4Props {
  report: ReportDocument;
  broker: BrokerProfile;
  onSaveReport?: (updated: ReportDocument) => Promise<boolean> | boolean | void;
  onBackToEdit: () => void;
}

export const ClientReportA4: React.FC<ClientReportA4Props> = ({
  report,
  broker,
  onSaveReport,
  onBackToEdit,
}) => {
  const [exportError, setExportError] = useState<string | null>(null);
  const [isCheckingExport, setIsCheckingExport] = useState(false);

  const currentFontScale = normalizeReportFontScale(report.layoutSettings?.fontScale);
  const [isSavingFontScale, setIsSavingFontScale] = useState(false);
  const [fontScaleSaveError, setFontScaleSaveError] = useState<string | null>(null);
  const [pendingRetryScale, setPendingRetryScale] = useState<ReportFontScale | null>(null);

  const handleFontScaleChange = async (nextScale: ReportFontScale) => {
    const normalized = normalizeReportFontScale(nextScale);
    if (!onSaveReport) return;
    setIsSavingFontScale(true);
    setFontScaleSaveError(null);
    setPendingRetryScale(normalized);

    const updated: ReportDocument = {
      ...report,
      layoutSettings: {
        ...(report.layoutSettings || {}),
        fontScale: normalized,
      },
      updatedAt: new Date().toISOString(),
    };

    try {
      const ok = await onSaveReport(updated);
      if (ok === false) {
        setFontScaleSaveError('字級保存失敗，請檢查連線後重試');
      } else {
        setPendingRetryScale(null);
      }
    } catch {
      setFontScaleSaveError('字級保存失敗，請檢查連線後重試');
    } finally {
      setIsSavingFontScale(false);
    }
  };

  // Strict client-side confidential field isolation (double defense alongside backend export API)
  const { reservePrice: _rp, internalNotes: _in, ...safeProperty } = report.propertySnapshot || ({} as any);
  const safeBuyer = report.buyerRequirements
    ? (({ buyerContact: _bc, privateNotes: _pn, ...rest }) => rest)(report.buyerRequirements)
    : undefined;

  const unitPriceInfo = calculateUnitPrice(safeProperty);
  const publicRatioInfo = calculatePublicRatio(safeProperty);
  const budgetComparison =
    report.reportType === 'buyer' && safeBuyer
      ? calculateBudgetComparison(safeProperty.askingPrice, safeBuyer)
      : null;

  const isApproved = report.status === 'approved';
  const isOwner = report.reportType === 'owner';
  const isProgress = report.subType === 'progress';

  const hasDemoData =
    Boolean(report.isDemo) ||
    Boolean(safeProperty?.isDemo) ||
    Boolean(report.ownerProgress?.isDemo) ||
    Boolean(safeBuyer?.isDemo) ||
    (report.comparables || []).some((c) => c.isDemo) ||
    (report.competingListings || []).some((c) => c.isDemo);

  const handlePrint = async () => {
    if (!isApproved) {
      setExportError('此報告尚未審閱核准，請先返回審閱頁確認核准後再列印或匯出客戶版 PDF。');
      return;
    }

    setIsCheckingExport(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(report.id)}/export`);
      const data = await res.json();
      if (!res.ok) {
        setExportError(data.error || '目前報告狀態不允許匯出，請先確認已審閱核准。');
        return;
      }
      window.print();
    } catch {
      setExportError('匯出權限驗證連線失敗，請稍後重試。');
    } finally {
      setIsCheckingExport(false);
    }
  };

  // Build dynamic provenance entries if report predates sourcesUsed field
  const provenanceEntries: ReportSourceEntry[] =
    report.sourcesUsed && report.sourcesUsed.length > 0
      ? report.sourcesUsed
      : [
          {
            label: '標的物件資料快照',
            category: safeProperty.sourceType === 'url' ? 'url' : 'property',
            detail: `${
              safeProperty.sourceType === 'url'
                ? '公開售屋網頁快照'
                : safeProperty.sourceType === 'database'
                ? '物件資料庫紀錄'
                : '經紀人手動校對輸入'
            }（快照時間：${new Date(report.createdAt).toLocaleDateString('zh-TW')}）`,
            url: safeProperty.sourceUrl || undefined,
            isDemo: Boolean(safeProperty.isDemo),
          },
          {
            label: `實價登錄可比成交案例 (${report.comparables?.length || 0} 筆)`,
            category: 'comparable',
            detail:
              report.comparables && report.comparables.length > 0
                ? Array.from(new Set(report.comparables.map((c) => c.source).filter(Boolean))).join('、') ||
                  '經紀人登錄成交案例'
                : '尚未登錄可比成交案例（待補）',
          },
          ...(report.competingListings && report.competingListings.length > 0
            ? [
                {
                  label: `在售競品資料 (${report.competingListings.length} 筆)`,
                  category: 'competing' as const,
                  detail:
                    Array.from(
                      new Set(report.competingListings.map((c) => c.source).filter(Boolean))
                    ).join('、') || '公開在售競品參考',
                },
              ]
            : []),
        ];

  // Cleanly join non-empty broker identity pieces with no orphan separators
  const brokerHeaderMeta = [broker.brandName, broker.storeName].filter((v) => v && v.trim());
  const brokerTitlePart = broker.title && broker.title.trim() ? `（${broker.title.trim()}）` : '';
  const brokerFooterDetails = [
    broker.licenseNumber?.trim() ? `證照字號：${broker.licenseNumber.trim()}` : '',
    broker.storeName?.trim() || '',
  ].filter(Boolean);

  const addressText = [safeProperty.cityDistrict, safeProperty.address]
    .filter((v) => v && v.trim())
    .join(' ');

  return (
    <div className="space-y-6">
      {/* Top Action Toolbar (Hidden in Print) */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 no-print sticky top-20 z-20">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBackToEdit}
            className="px-3.5 py-1.5 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center space-x-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回報告審閱編輯</span>
          </button>

          <div className="flex items-center space-x-2 text-xs">
            <span
              className={`px-2.5 py-1 rounded-lg font-bold border ${
                isApproved
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}
            >
              {isApproved
                ? '已審閱核准'
                : report.status === 'pending_review'
                ? '未審閱（核准後有異動）'
                : '未審閱草稿'}
            </span>
            {hasDemoData && (
              <span className="px-2.5 py-1 rounded-lg font-bold bg-amber-100 text-amber-900 border border-amber-300">
                示範資料
              </span>
            )}
            <span className="hidden md:inline-flex text-emerald-700 font-semibold items-center space-x-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>底價與私密欄位已隔離</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {onSaveReport && (
            <ReportFontScaleControl
              fontScale={currentFontScale}
              onChange={handleFontScaleChange}
              isSaving={isSavingFontScale}
              saveError={fontScaleSaveError}
              onRetrySave={
                pendingRetryScale ? () => handleFontScaleChange(pendingRetryScale) : undefined
              }
            />
          )}

          <button
            type="button"
            disabled={!isApproved || isCheckingExport}
            onClick={handlePrint}
            title={
              isApproved
                ? '列印或另存為 A4 PDF'
                : '草稿或待重新審閱狀態禁止匯出，請先返回審閱核准'
            }
            className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 shadow-xs transition-all ${
              isApproved
                ? 'bg-blue-700 hover:bg-blue-800 text-white cursor-pointer'
                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
            }`}
          >
            {isApproved ? <Printer className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            <span>
              {isCheckingExport
                ? '驗證匯出權限...'
                : isApproved
                ? '列印 / 另存為 PDF'
                : '未審閱鎖定匯出'}
            </span>
          </button>
        </div>
      </div>

      {report.needsReReview && (
        <div className="max-w-[210mm] mx-auto bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start space-x-3 no-print">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-950 space-y-1">
            <div className="font-extrabold">【歷史報告提示：需重新審閱】</div>
            <ul className="list-disc list-inside text-amber-800 space-y-0.5">
              {(report.reReviewReasons && report.reReviewReasons.length > 0
                ? report.reReviewReasons
                : ['本報告偵測到舊版規則遺留風險，建議重新核對數字與可比案例後再提供客戶。']
              ).map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Prominent Unreviewed Warning Banner (Visible in broker workspace, hidden if approved) */}
      {!isApproved && (
        <div className="max-w-[210mm] mx-auto bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-950 space-y-0.5">
              <div className="font-extrabold text-sm">
                【未審閱草稿預覽】目前報告尚未完成經紀人審閱核准
              </div>
              <p className="text-amber-800">
                為維護專業合規，未審閱草稿（含核准後再修改內容）僅供內部預覽檢查，已鎖定「列印 / 另存為 PDF」與客戶版匯出功能。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBackToEdit}
            className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-bold shrink-0"
          >
            返回審閱並核准
          </button>
        </div>
      )}

      {exportError && (
        <div className="max-w-[210mm] mx-auto bg-rose-50 border border-rose-200 text-rose-900 rounded-xl p-3 text-xs font-semibold no-print">
          {exportError}
        </div>
      )}

      {/* A4 PRINTABLE DOCUMENT CONTAINER (A4 width, logo & photos stay fixed; typography scales via --report-font-scale) */}
      <div
        className="max-w-[210mm] mx-auto space-y-8 print:space-y-0 print:max-w-none report-scalable"
        style={{ '--report-font-scale': currentFontScale / 100 } as React.CSSProperties}
      >
        {/* ========================================================= */}
        {/* PAGE 1: COVER & EXECUTIVE SUMMARY                         */}
        {/* ========================================================= */}
        <div className="a4-page bg-white p-8 sm:p-12 rounded-2xl shadow-md border border-slate-200 print:shadow-none print:border-none print:p-0 flex flex-col justify-between min-h-[297mm] print:min-h-0">
          <div>
            {/* Header: Store Branding & Status Badges */}
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4 mb-6">
              <div className="flex items-center space-x-3">
                {broker.brandLogoUrl ? (
                  <img
                    src={broker.brandLogoUrl}
                    alt={broker.brandName || '品牌標誌'}
                    className="h-10 object-contain shrink-0"
                  />
                ) : (
                  <div className="font-extrabold text-slate-900 rf-h2 text-lg tracking-tight flex items-center space-x-2">
                    <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center text-sm font-black shrink-0">
                      EST
                    </span>
                    <span>{brokerHeaderMeta[0] || '不動產經紀顧問'}</span>
                  </div>
                )}
                {brokerHeaderMeta.length > 1 && (
                  <>
                    <span className="text-slate-400">|</span>
                    <span className="rf-body font-bold text-slate-700">{brokerHeaderMeta[1]}</span>
                  </>
                )}
              </div>

              <div className="text-right rf-sm text-slate-500 font-medium space-y-0.5">
                <div className="flex items-center justify-end space-x-1.5">
                  {!isApproved && (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 font-bold rounded rf-xs">
                      未審閱
                    </span>
                  )}
                  {hasDemoData && (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 font-bold rounded rf-xs">
                      示範資料
                    </span>
                  )}
                </div>
                <div>評估基準日：{new Date(report.createdAt).toLocaleDateString('zh-TW')}</div>
                <div className="font-mono rf-xs">報告編號：{report.id.toUpperCase()}</div>
              </div>
            </div>

            {/* Document Title Banner */}
            <div className="bg-slate-900 text-white p-6 rounded-2xl mb-6">
              <div className="flex flex-wrap items-center gap-2 text-blue-400 rf-body font-bold uppercase tracking-wider mb-1">
                <span>{isOwner ? '不動產委託與銷售顧問專報' : '專業購屋置產決策評估專報'}</span>
                <span>•</span>
                <span>{isOwner ? (isProgress ? '銷售進度回報' : '委託前市場評估') : '客戶需求配對版'}</span>
              </div>
              <h1 className="rf-title font-extrabold tracking-tight break-words">
                {report.title}
              </h1>
              <div className="mt-3 flex items-start space-x-2 text-slate-300 rf-body">
                <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <span className="break-words">
                  標的物件：{safeProperty.caseName}
                  {addressText ? `（${addressText}）` : ''}
                </span>
              </div>
            </div>

            {/* Target Property Visual & Key Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {safeProperty.photos && safeProperty.photos.length > 0 ? (
                <div className="sm:col-span-1 rounded-xl overflow-hidden border border-slate-200 aspect-video sm:aspect-auto">
                  <img
                    src={safeProperty.photos[0]}
                    alt={safeProperty.caseName}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="sm:col-span-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center p-4 text-center text-slate-400 rf-sm">
                  <span>尚未提供現場照片</span>
                </div>
              )}

              <div className="sm:col-span-2 grid grid-cols-2 gap-3 rf-body">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">開價總額</span>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="rf-metric font-extrabold text-blue-900">
                      {formatWan(safeProperty.askingPrice)}
                    </span>
                    {safeProperty.previousAskingPrice != null &&
                      safeProperty.previousAskingPrice > 0 &&
                      safeProperty.previousAskingPrice !== safeProperty.askingPrice && (
                        <span className="rf-sm text-slate-400 line-through">
                          原開價 {formatWan(safeProperty.previousAskingPrice)}
                        </span>
                      )}
                  </div>
                  <span className="rf-xs text-slate-500 block mt-0.5">
                    {safeProperty.hasParking === false
                      ? '無車位'
                      : safeProperty.parkingIncluded === true
                      ? safeProperty.parkingPrice
                        ? `含車位總價（車位 ${safeProperty.parkingPrice} 萬）`
                        : '含車位總價（車位價未拆分）'
                      : safeProperty.parkingIncluded === false
                      ? '不含車位'
                      : '車位含總價與否待確認'}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">單價水準 ({unitPriceInfo.caliberLabel})</span>
                  <div className="rf-metric font-extrabold text-blue-900">
                    {unitPriceInfo.unitPrice !== null ? `${unitPriceInfo.unitPrice} 萬 / 坪` : '待確認'}
                  </div>
                  <span className="rf-xs text-slate-500 block mt-0.5">
                    {unitPriceInfo.hasDeductedPrice && unitPriceInfo.grossUnitPrice !== null
                      ? `含車位毛單價 ${unitPriceInfo.grossUnitPrice} 萬/坪`
                      : unitPriceInfo.unitPrice !== null
                      ? '依實際記載坪數計算'
                      : '缺總價或總坪數'}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">權狀總坪數與組成</span>
                  <div className="font-bold text-slate-800 rf-h3">
                    {formatPing(safeProperty.totalArea)}
                  </div>
                  <span className="rf-xs text-slate-500 block mt-0.5">
                    主建 {safeProperty.mainArea ?? '待確認'} ｜ 附屬 {safeProperty.auxArea ?? '待確認'} ｜ 公設比 {publicRatioInfo.label}
                  </span>
                  {safeProperty.parkingArea ? (
                    <span className="rf-xs text-slate-500 block">
                      車位面積 {safeProperty.parkingArea} 坪
                      {safeProperty.parkingAreaIncludedInCommon ? '（含於共有部分內）' : '（獨立列計）'}
                    </span>
                  ) : null}
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-0.5">成屋規格與管理費</span>
                  <div className="font-bold text-slate-800 rf-h3 break-words">
                    {formatLayout(safeProperty.layout)} ｜ {formatFloor(safeProperty.floor, safeProperty.totalFloors, safeProperty.floorRaw)}
                  </div>
                  <span className="rf-xs text-slate-500 block mt-0.5">
                    {safeProperty.propertyType ? `${safeProperty.propertyType} ｜ ` : ''}
                    屋齡 {safeProperty.age ?? '待確認'} 年 ｜{' '}
                    {safeProperty.hasParking === false
                      ? '無車位'
                      : [
                          safeProperty.parkingOwnership ? `權屬:${safeProperty.parkingOwnership}` : '',
                          safeProperty.parkingType || '車位型式待確認',
                        ]
                          .filter(Boolean)
                          .join(' / ')}
                  </span>
                  <span className="rf-xs text-slate-500 block">
                    管理費：{formatManagementFee(safeProperty)}
                  </span>
                </div>
              </div>
            </div>

            {/* Executive Summary Card */}
            <div className="p-5 bg-blue-50/70 border border-blue-200 rounded-2xl mb-6 rf-body text-blue-950">
              <div className="font-bold rf-h3 text-blue-900 mb-1 flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0" />
                <span>這份報告的核心重點 (Executive Summary)</span>
              </div>
              <div className="text-slate-800 mt-1">
                <SafeMarkdown content={report.summary} />
              </div>
            </div>

            {/* Owner Progress Summary Card (If Owner Progress Report) */}
            {isOwner && isProgress && report.ownerProgress && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl mb-6 rf-body space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold rf-h3 text-slate-900">
                    本期銷售進度摘要（{report.ownerProgress.periodStart} ～ {report.ownerProgress.periodEnd}）
                  </span>
                  {report.ownerProgress.isDemo && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded rf-xs font-bold">
                      示範資料
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block rf-xs">網路曝光數</span>
                    <strong className="rf-h3 text-slate-900">
                      {formatCountOrEmpty(report.ownerProgress.onlineImpressions, '次')}
                    </strong>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block rf-xs">詢問數</span>
                    <strong className="rf-h3 text-slate-900">
                      {formatCountOrEmpty(report.ownerProgress.inquiryCount, '通/組')}
                    </strong>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block rf-xs">實地帶看組數</span>
                    <strong className="rf-h3 text-slate-900">
                      {formatCountOrEmpty(report.ownerProgress.showingCount, '組')}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* Buyer Match Callout (If Buyer Version) */}
            {!isOwner && safeBuyer && (
              <div className="p-4 bg-purple-50/70 border border-purple-200 rounded-2xl mb-6 rf-body text-purple-950 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="font-bold rf-h3 text-purple-900">
                    買方需求配對摘要 ({safeBuyer.buyerNickname || '買方評估'})
                  </div>
                  {safeBuyer.isDemo && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded rf-xs font-bold">
                      示範資料
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 rf-sm text-slate-700">
                  <div>
                    預算區間：
                    <strong>
                      {safeBuyer.budgetMin !== null || safeBuyer.budgetMax !== null
                        ? `${safeBuyer.budgetMin ?? '不限'} ~ ${safeBuyer.budgetMax ?? '不限'} 萬元`
                        : '待確認'}
                    </strong>
                  </div>
                  <div>
                    目標生活圈：{safeBuyer.livingCircle || '待確認'}
                  </div>
                </div>
                {budgetComparison && (
                  <div className="rf-sm font-semibold text-purple-900 pt-1 border-t border-purple-200/70">
                    預算比對試算：{budgetComparison.summary}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Page 1 Footer: Dynamic Broker Profile (Hides empty fields cleanly) */}
          <div className="border-t border-slate-200 pt-4 mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between rf-body text-slate-600 gap-3">
            <div className="space-y-0.5">
              {broker.name?.trim() && (
                <div className="font-extrabold text-slate-900 rf-h3">
                  承辦經紀人：{broker.name.trim()}
                  {brokerTitlePart}
                </div>
              )}
              {brokerFooterDetails.length > 0 && (
                <div className="rf-sm text-slate-500">
                  {brokerFooterDetails.join(' ｜ ')}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 rf-body font-semibold text-slate-800">
              {broker.phone?.trim() && (
                <span className="flex items-center space-x-1">
                  <Phone className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span>{broker.phone.trim()}</span>
                </span>
              )}
              {broker.email?.trim() && (
                <span className="flex items-center space-x-1">
                  <Mail className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span>{broker.email.trim()}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* PAGE 2+: REPORT DETAILED CHAPTERS, TABLES & PROVENANCE    */}
        {/* ========================================================= */}
        <div className="a4-page bg-white p-8 sm:p-12 rounded-2xl shadow-md border border-slate-200 print:shadow-none print:border-none print:p-0 min-h-[297mm] print:min-h-0 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 rf-body text-slate-500">
            <span className="font-bold text-slate-800 break-words">{report.title} ｜ 詳細分析章節</span>
            <span className="break-words">{safeProperty.caseName}</span>
          </div>

          {/* Comparables Table OR Explicit "Pending Comparables" Notice */}
          {report.comparables && report.comparables.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rf-section-heading">
                <h3 className="rf-h3 font-bold text-slate-900 flex items-center space-x-2">
                  <span>實價登錄可比成交行情表</span>
                  {report.comparables.some((c) => c.isDemo) && (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded rf-xs">
                      示範資料
                    </span>
                  )}
                </h3>
                <span className="rf-xs text-slate-500">已與在售競品嚴格分列</span>
              </div>

              <div className="overflow-x-auto print:overflow-visible">
                <table className="rf-table w-full text-left rf-body border border-slate-200 border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5 align-top">建案社區</th>
                      <th className="p-2.5 align-top">交易年月</th>
                      <th className="p-2.5 align-top">總價 (萬)</th>
                      <th className="p-2.5 align-top">總坪數</th>
                      <th className="p-2.5 align-top">單價 (萬/坪)</th>
                      <th className="p-2.5 align-top">單價口徑</th>
                      <th className="p-2.5 align-top">可比性與來源</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {report.comparables.map((c) => (
                      <tr key={c.id}>
                        <td className="p-2.5 font-semibold align-top break-words">{c.communityName}</td>
                        <td className="p-2.5 font-mono align-top">{c.dealDate}</td>
                        <td className="p-2.5 font-bold text-blue-900 align-top">{c.totalPrice}</td>
                        <td className="p-2.5 align-top">{c.totalPing} 坪</td>
                        <td className="p-2.5 font-bold text-slate-900 align-top">{c.unitPrice}</td>
                        <td className="p-2.5 align-top">
                          <span className="px-1.5 py-0.5 rounded rf-xs bg-slate-100 text-slate-700 font-medium inline-block">
                            {c.parkingCaliber}
                          </span>
                        </td>
                        <td className="p-2.5 rf-sm text-slate-600 align-top break-words">
                          <div>{c.comparabilityNotes}</div>
                          {c.source && (
                            <div className="rf-xs text-slate-400 mt-0.5 break-words">來源：{c.source}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            !(isOwner && isProgress) && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl rf-body text-amber-900 flex items-start space-x-2">
                <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">可比成交案例：待補可比成交案例（目前 0 筆）</span>
                  <p className="rf-sm text-amber-800 mt-0.5">
                    本報告未取得經核實之實價登錄可比成交案例，因此不推估成交價格區間或議價空間，建議後續依同社區與鄰近同型產品補齊實價登錄資料。
                  </p>
                </div>
              </div>
            )
          )}

          {/* Competing listings table */}
          {report.competingListings && report.competingListings.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rf-section-heading">
                <h3 className="rf-h3 font-bold text-slate-900 flex items-center space-x-2">
                  <span>周邊在售競品動態比較表（非實際成交價）</span>
                  {report.competingListings.some((c) => c.isDemo) && (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded rf-xs">
                      示範資料
                    </span>
                  )}
                </h3>
                <span className="rf-xs text-slate-500">開價僅反映市場供給端掛牌</span>
              </div>

              <div className="overflow-x-auto print:overflow-visible">
                <table className="rf-table w-full text-left rf-body border border-slate-200 border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5 align-top">案名</th>
                      <th className="p-2.5 align-top">開價 (萬)</th>
                      <th className="p-2.5 align-top">總坪數</th>
                      <th className="p-2.5 align-top">格局 / 樓層</th>
                      <th className="p-2.5 align-top">單價口徑</th>
                      <th className="p-2.5 align-top">差異與比較說明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {report.competingListings.map((cl) => (
                      <tr key={cl.id}>
                        <td className="p-2.5 font-semibold align-top break-words">{cl.title}</td>
                        <td className="p-2.5 font-bold text-purple-900 align-top">{cl.askingPrice}</td>
                        <td className="p-2.5 align-top">{cl.totalPing} 坪</td>
                        <td className="p-2.5 align-top break-words">
                          {formatLayout(cl.layout)} / {cl.floor}
                        </td>
                        <td className="p-2.5 rf-sm align-top break-words">{cl.parkingCaliber}</td>
                        <td className="p-2.5 rf-sm text-slate-700 font-medium align-top break-words">
                          {cl.comparativeAdvantage || '待補充'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Render Sections Safe Markdown & Checklists (allow natural wrapping/pagination when font is scaled) */}
          <div className="space-y-6 pt-2">
            {report.sections.map((section, idx) => (
              <div
                key={section.id}
                className="space-y-2 border-b border-slate-100 pb-5 last:border-b-0"
              >
                <h3 className="rf-h3 rf-section-heading font-black text-slate-900 flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] flex items-center justify-center font-bold shrink-0">
                    {idx + 1}
                  </span>
                  <span className="break-words">{section.title}</span>
                </h3>

                <SafeMarkdown content={section.contentMarkdown} />

                {section.pendingChecklist && section.pendingChecklist.length > 0 && (
                  <div className="mt-2 p-3 bg-amber-50 rounded-xl border border-amber-200 rf-body">
                    <span className="font-bold text-amber-900 block mb-1">
                      待查證／應補事項清單：
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-amber-800 rf-sm">
                      {section.pendingChecklist.map((c, i) => (
                        <li key={i} className="break-words">{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Dynamic Data Provenance & Truthful Disclaimer Footer */}
          <div className="pt-5 border-t-2 border-slate-900 rf-xs text-slate-600 space-y-3">
            <div className="space-y-1.5">
              <div className="font-bold text-slate-800 rf-body">【資料來源與查證紀錄】</div>
              <ul className="list-disc list-inside space-y-0.5 rf-sm text-slate-700">
                {provenanceEntries.map((src, idx) => (
                  <li key={idx} className="break-words">
                    <span className="font-semibold">{src.label}：</span>
                    <span>{src.detail}</span>
                    {src.url && (
                      <span className="font-mono rf-xs text-slate-500 ml-1 break-all">
                        ({src.url})
                      </span>
                    )}
                    {src.isDemo && (
                      <span className="ml-1.5 px-1 py-0.2 bg-amber-100 text-amber-800 rounded rf-xs font-bold">
                        示範資料
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-1 text-slate-500 pt-2 border-t border-slate-200">
              <div className="font-bold text-slate-700 rf-sm">【查核聲明與合規說明】</div>
              <p>
                本報告書僅依據上述實際取得並經承辦經紀人校對之快照資料編製；未列載或缺乏佐證之項目均已標示「待確認／待補」，不構成對未查證條件之保證。不動產權屬與登記面積以地政機關最新核發謄本為準，交易條件以雙方正式簽署之買賣契約為依歸。
              </p>
              {(brokerHeaderMeta.length > 0 || broker.name?.trim() || broker.licenseNumber?.trim()) && (
                <div className="flex flex-wrap justify-between items-center pt-1 rf-xs text-slate-400">
                  <span>{brokerHeaderMeta.join(' ｜ ')}</span>
                  <span>
                    {[
                      broker.name?.trim() ? `經紀人：${broker.name.trim()}` : '',
                      broker.licenseNumber?.trim() ? `證號：${broker.licenseNumber.trim()}` : '',
                    ]
                      .filter(Boolean)
                      .join(' ｜ ')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
