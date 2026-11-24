import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Calculator,
  Info,
  Lock,
  Camera,
  Plus,
  Trash2,
  HelpCircle,
} from 'lucide-react';
import { PropertyData, FieldVerificationStatus, ManagementFeePeriod, hasUnresolvedPrice } from '../types/property';
import {
  calculateUnitPrice,
  calculatePublicRatio,
  calculatePropertyCompleteness,
  resolvePropertyFieldStatus,
  computeManagementFeeMonthly,
  formatManagementFee,
  formatFloor,
  normalizeLayoutInput,
  isPartialLayout,
} from '../utils/calculator';
import { ConflictResolutionModal } from './ConflictResolutionModal';

interface PropertyProofreadFormProps {
  property: PropertyData;
  onSaveProperty: (updated: PropertyData) => void;
  onProceedToReport: (property: PropertyData) => void;
  reportBlocked: boolean;
}

function toSafeLayoutInput(layout: any): string {
  return normalizeLayoutInput(layout);
}

export const PropertyProofreadForm: React.FC<PropertyProofreadFormProps> = ({
  property,
  onSaveProperty,
  onProceedToReport,
  reportBlocked,
}) => {
  const [formData, setFormData] = useState<PropertyData>(() => ({
    ...property,
    layout: toSafeLayoutInput(property.layout),
  }));
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [photoInput, setPhotoInput] = useState('');

  useEffect(() => {
    setFormData({
      ...property,
      layout: toSafeLayoutInput(property.layout),
    });
  }, [property]);

  const handleChange = (field: keyof PropertyData, value: any) => {
    const isEmpty = value === null || value === undefined || value === '';
    const nextStatus =
      field === 'layout' && isPartialLayout(value)
        ? 'pending'
        : isEmpty
        ? 'pending'
        : 'verified';
    const updated: PropertyData = {
      ...formData,
      [field]: value,
      fieldStatus: {
        ...formData.fieldStatus,
        [field as string]: nextStatus as FieldVerificationStatus,
      },
      updatedAt: new Date().toISOString(),
    };
    setFormData(updated);
    onSaveProperty(updated);
  };

  const handleNumberInput = (field: keyof PropertyData, rawValue: string) => {
    if (rawValue === '') {
      handleChange(field, null);
      return;
    }
    const parsed = parseFloat(rawValue);
    handleChange(field, Number.isFinite(parsed) ? parsed : null);
  };

  const handleManagementFeeUpdate = (
    nextAmount: number | null,
    nextPeriod: ManagementFeePeriod
  ) => {
    const monthlyAvg = computeManagementFeeMonthly(nextAmount, nextPeriod);
    const periodText =
      nextPeriod === 'half_year'
        ? '半年'
        : nextPeriod === 'quarterly'
        ? '季'
        : nextPeriod === 'yearly'
        ? '年'
        : nextPeriod === 'monthly'
        ? '月'
        : '';
    const nextRaw =
      nextAmount !== null && periodText
        ? `${nextAmount.toLocaleString('zh-TW')}元/${periodText}`
        : nextAmount !== null
        ? `${nextAmount.toLocaleString('zh-TW')}元`
        : '';

    const updated: PropertyData = {
      ...formData,
      managementFeeAmount: nextAmount,
      managementFeePeriod: nextPeriod,
      managementFee: monthlyAvg,
      managementFeeRaw: nextRaw,
      fieldStatus: {
        ...formData.fieldStatus,
        managementFee: monthlyAvg !== null ? 'verified' : 'pending',
        managementFeePeriod:
          nextPeriod && nextPeriod !== 'unknown' ? 'verified' : 'pending',
      },
      updatedAt: new Date().toISOString(),
    };
    setFormData(updated);
    onSaveProperty(updated);
  };

  const handleHasParkingChange = (val: string) => {
    const hasParking = val === '' ? null : val === 'yes';
    const nextStatus: Record<string, FieldVerificationStatus> = {
      ...formData.fieldStatus,
      hasParking: hasParking === null ? 'pending' : 'verified',
    };
    if (hasParking === false) {
      nextStatus.parkingIncluded = 'not_applicable';
      nextStatus.parkingType = 'not_applicable';
      nextStatus.parkingOwnership = 'not_applicable';
      nextStatus.parkingArea = 'not_applicable';
      nextStatus.parkingPrice = 'not_applicable';
    }
    const updated: PropertyData = {
      ...formData,
      hasParking,
      parkingType: hasParking === false ? '無車位' : formData.parkingType === '無車位' ? '' : formData.parkingType,
      fieldStatus: nextStatus,
      updatedAt: new Date().toISOString(),
    };
    setFormData(updated);
    onSaveProperty(updated);
  };

  const handleResolveConflict = (field: string, resolvedValue: any, decisionNote: string) => {
    const updatedConflicts = (formData.conflicts || []).map((c) =>
      c.field === field ? { ...c, resolved: true, resolvedValue } : c
    );
    const updated = {
      ...formData,
      [field]: resolvedValue,
      fieldStatus: {
        ...formData.fieldStatus,
        [field]: 'verified' as FieldVerificationStatus,
      },
      evidenceSummaries: {
        ...formData.evidenceSummaries,
        [field]: decisionNote,
      },
      conflicts: updatedConflicts,
      updatedAt: new Date().toISOString(),
    };
    setFormData(updated);
    onSaveProperty(updated);
    setShowConflictModal(false);
  };

  const handleKeepUnresolved = (field: string) => {
    const updated = {
      ...formData,
      askingPrice: field === 'askingPrice' ? null : formData.askingPrice,
      fieldStatus: {
        ...formData.fieldStatus,
        [field]: 'conflict' as FieldVerificationStatus,
      },
      updatedAt: new Date().toISOString(),
    };
    setFormData(updated);
    onSaveProperty(updated);
    setShowConflictModal(false);
  };

  const handleAddPhoto = () => {
    if (!photoInput.trim()) return;
    const updatedPhotos = [...(formData.photos || []), photoInput.trim()];
    handleChange('photos', updatedPhotos);
    setPhotoInput('');
  };

  const handleRemovePhoto = (index: number) => {
    const updatedPhotos = (formData.photos || []).filter((_, i) => i !== index);
    handleChange('photos', updatedPhotos);
  };

  const priceUnresolved = hasUnresolvedPrice(formData);
  const openPriceConflict = formData.conflicts?.some((conflict) => conflict.field === 'askingPrice' && !conflict.resolved);
  const unresolvedConflicts = (formData.conflicts || []).filter((conflict) => !conflict.resolved);
  const unitPriceResult = calculateUnitPrice(priceUnresolved ? { ...formData, askingPrice: null } : formData);
  const publicRatioResult = calculatePublicRatio(formData);
  const completeness = calculatePropertyCompleteness(formData);

  const renderEvidenceQuote = (field: string) => {
    const quote = formData.evidenceSummaries?.[field];
    if (!quote) return null;
    return (
      <div className="mt-1 text-[10px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-100 leading-snug">
        依據：{quote}
      </div>
    );
  };

  const renderStatusBadge = (field: string) => {
    const status = resolvePropertyFieldStatus(formData, field);
    if (status === 'conflict') {
      return (
        <button
          type="button"
          onClick={() => setShowConflictModal(true)}
          className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200 cursor-pointer"
        >
          <AlertTriangle className="w-3 h-3" />
          <span>來源有衝突 (點擊核對)</span>
        </button>
      );
    }
    if (status === 'verified') {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700">
          <CheckCircle className="w-3 h-3" />
          <span>經紀人已核對</span>
        </span>
      );
    }
    if (status === 'recorded') {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700">
          <Info className="w-3 h-3" />
          <span>來源有記載</span>
        </span>
      );
    }
    if (status === 'not_applicable') {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
          <span>不適用</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">
        <HelpCircle className="w-3 h-3" />
        <span>待確認</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top action banner */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
              {formData.caseName || '未命名物件草稿'}
            </h2>
            <span className="text-xs font-mono font-bold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg">
              {formData.caseId}
            </span>
            <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 font-semibold rounded-lg">
              來源：{formData.sourcePlatform || (formData.sourceType === 'database' ? '物件資料庫' : formData.sourceType === 'url' ? '公開網頁' : '經紀人手動')}
              {formData.sourceListingId ? ` (${formData.sourceListingId})` : ''}
            </span>
            {formData.isDemo && (
              <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded-lg">
                示範資料
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-slate-800">
              {completeness.summaryText}
            </span>
            <span className="text-slate-400">｜</span>
            <span className="text-blue-700">來源有記載 {completeness.statusCounts.recorded}</span>
            <span className="text-emerald-700">已核對 {completeness.statusCounts.verified}</span>
            <span className="text-amber-700">待確認 {completeness.statusCounts.pending}</span>
            {completeness.statusCounts.not_applicable > 0 && (
              <span className="text-slate-500">不適用 {completeness.statusCounts.not_applicable}</span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            更新時間：{new Date(formData.updatedAt).toLocaleString('zh-TW')}
            {formData.fetchedAt ? ` ｜ 擷取時間：${new Date(formData.fetchedAt).toLocaleString('zh-TW')}` : ''}
            {(completeness.missingCoreLabels.length > 0 || completeness.missingAdvancedLabels.length > 0) &&
              ` ｜ 尚待補齊：${[...completeness.missingCoreLabels, ...completeness.missingAdvancedLabels].join('、')}`}
          </p>
        </div>

        <div className="flex flex-col items-start gap-2">
          {priceUnresolved && (
            <p role="status" className="text-xs font-semibold text-rose-700">開價來源有衝突，請先確認現行開價。</p>
          )}
          <button
            type="button"
            disabled={reportBlocked || priceUnresolved}            onClick={() => onProceedToReport(formData)}
            className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center space-x-2 shadow-xs transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>確認核對無誤，選擇報告用途</span>
            <span>&rarr;</span>
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Section 1: Basic Identifiers */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              一、基本案名與地址定位
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">物件案名 *</label>
                  {renderStatusBadge('caseName')}
                </div>
                <input
                  type="text"
                  value={formData.caseName}
                  onChange={(e) => handleChange('caseName', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-blue-500"
                />
                {renderEvidenceQuote('caseName')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">物件編號 (ID) *</label>
                  {renderStatusBadge('caseId')}
                </div>
                <input
                  type="text"
                  value={formData.caseId}
                  onChange={(e) => handleChange('caseId', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">縣市 / 行政區</label>
                  {renderStatusBadge('cityDistrict')}
                </div>
                <input
                  type="text"
                  value={formData.cityDistrict}
                  onChange={(e) => handleChange('cityDistrict', e.target.value)}
                  placeholder="待確認（例如：新竹縣竹北市）"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                {renderEvidenceQuote('cityDistrict')}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">可對外公開地址 / 路段</label>
                  {renderStatusBadge('address')}
                </div>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  placeholder="待確認（例如：文興路二段）"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                {renderEvidenceQuote('address')}
                <span className="text-[10px] text-slate-400">
                  客戶版預覽僅揭露至路段或社區名，避免完整門牌外洩。
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">建物型態</label>
                  {renderStatusBadge('propertyType')}
                </div>
                <select
                  value={formData.propertyType}
                  onChange={(e) => handleChange('propertyType', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">待確認 / 請選擇</option>
                  <option value="電梯大樓">電梯大樓</option>
                  <option value="華廈">華廈</option>
                  <option value="透天別墅">透天別墅</option>
                  <option value="公寓">公寓</option>
                </select>
                {renderEvidenceQuote('propertyType')}
              </div>
            </div>
          </div>

          {/* Section 2: Pricing & Parking breakdown */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">
                二、現行開價與車位權屬／坪價拆分
              </h3>
              <span className="text-[11px] text-blue-600 font-medium">
                車位未拆分時不計算扣車位單價；權屬與型式獨立記載
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">現行開價總金額 (萬元)</label>
                  {renderStatusBadge('askingPrice')}
                </div>
                <input
                  type="number"
                  step="1"
                  value={priceUnresolved ? '' : formData.askingPrice ?? ''}
                  readOnly={Boolean(openPriceConflict)}
                  onChange={(e) => handleNumberInput('askingPrice', e.target.value)}
                  placeholder="待確認（空白不計為 0）"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-extrabold text-blue-700 focus:ring-2 focus:ring-blue-500"
                />
                {renderEvidenceQuote('askingPrice')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">降價前原開價 (萬元，選填)</label>
                  {renderStatusBadge('previousAskingPrice')}
                </div>
                <input
                  type="number"
                  step="1"
                  value={formData.previousAskingPrice ?? ''}
                  onChange={(e) => handleNumberInput('previousAskingPrice', e.target.value)}
                  placeholder="無調價紀錄可留空"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-600"
                />
                {renderEvidenceQuote('previousAskingPrice')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">是否有車位</label>
                  {renderStatusBadge('hasParking')}
                </div>
                <select
                  value={
                    formData.hasParking === true
                      ? 'yes'
                      : formData.hasParking === false
                      ? 'no'
                      : ''
                  }
                  onChange={(e) => handleHasParkingChange(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">待確認</option>
                  <option value="yes">有附屬／權狀車位</option>
                  <option value="no">無車位</option>
                </select>
                {renderEvidenceQuote('hasParking')}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">車位是否含在總價內</label>
                  {renderStatusBadge('parkingIncluded')}
                </div>
                <select
                  value={
                    formData.parkingIncluded === true
                      ? 'yes'
                      : formData.parkingIncluded === false
                      ? 'no'
                      : ''
                  }
                  onChange={(e) =>
                    handleChange(
                      'parkingIncluded',
                      e.target.value === '' ? null : e.target.value === 'yes'
                    )
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">待確認</option>
                  <option value="yes">是 (含在開價總金額內)</option>
                  <option value="no">否 (車位價款外加 / 無車位)</option>
                </select>
                {renderEvidenceQuote('parkingIncluded')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">車位型式</label>
                  {renderStatusBadge('parkingType')}
                </div>
                <select
                  value={formData.parkingType}
                  onChange={(e) => handleChange('parkingType', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">待確認 / 請選擇</option>
                  <option value="坡道平面">坡道平面</option>
                  <option value="坡道機械">坡道機械</option>
                  <option value="機械機械">機械機械</option>
                  <option value="平面式">平面式</option>
                  <option value="無車位">無車位</option>
                  <option value="其他">其他</option>
                </select>
                {renderEvidenceQuote('parkingType')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">車位權屬</label>
                  {renderStatusBadge('parkingOwnership')}
                </div>
                <input
                  type="text"
                  value={formData.parkingOwnership || ''}
                  onChange={(e) => handleChange('parkingOwnership', e.target.value)}
                  placeholder="待確認（例如：私有、共有、約定專用）"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                />
                {renderEvidenceQuote('parkingOwnership')}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">車位獨立價格 (萬元)</label>
                  {renderStatusBadge('parkingPrice')}
                </div>
                <input
                  type="number"
                  step="1"
                  value={formData.parkingPrice ?? ''}
                  onChange={(e) => handleNumberInput('parkingPrice', e.target.value)}
                  placeholder="待確認（未拆分請留空）"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                />
                {renderEvidenceQuote('parkingPrice')}
                <span className="text-[10px] text-slate-500 block mt-1">
                  僅在總價含車位且車位價款與坪數均已知時，始計算扣車位單價。
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">車位登記坪數 (坪)</label>
                  {renderStatusBadge('parkingArea')}
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={formData.parkingArea ?? ''}
                  onChange={(e) => handleNumberInput('parkingArea', e.target.value)}
                  placeholder="待確認（未記載請留空）"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                />
                <label className="flex items-center space-x-1.5 mt-1.5 text-[11px] text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.parkingAreaIncludedInCommon === true}
                    onChange={(e) => handleChange('parkingAreaIncludedInCommon', e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>車位坪數包含在「共有部分(公設)」內（不重複計入總坪數）</span>
                </label>
                {renderEvidenceQuote('parkingArea')}
              </div>
            </div>
          </div>

          {/* Section 3: Area Composition */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              三、坪數組成明細（依建物謄本記載）
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">權狀總坪數</label>
                  {renderStatusBadge('totalArea')}
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={formData.totalArea ?? ''}
                  onChange={(e) => handleNumberInput('totalArea', e.target.value)}
                  placeholder="待確認"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold"
                />
                {renderEvidenceQuote('totalArea')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">主建物坪數</label>
                  {renderStatusBadge('mainArea')}
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={formData.mainArea ?? ''}
                  onChange={(e) => handleNumberInput('mainArea', e.target.value)}
                  placeholder="待確認"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                {renderEvidenceQuote('mainArea')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">附屬建物坪數</label>
                  {renderStatusBadge('auxArea')}
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={formData.auxArea ?? ''}
                  onChange={(e) => handleNumberInput('auxArea', e.target.value)}
                  placeholder="待確認"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                {renderEvidenceQuote('auxArea')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">共有部分(公設)</label>
                  {renderStatusBadge('commonArea')}
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={formData.commonArea ?? ''}
                  onChange={(e) => handleNumberInput('commonArea', e.target.value)}
                  placeholder="待確認"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                {renderEvidenceQuote('commonArea')}
              </div>
            </div>
          </div>

          {/* Section 4: Specifications & Details */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              四、成屋規格、樓層與管理現況
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">房廳衛格局</label>
                  {renderStatusBadge('layout')}
                </div>
                <input
                  type="text"
                  value={formData.layout}
                  onChange={(e) => handleChange('layout', e.target.value)}
                  placeholder="待確認（如 3房2廳2衛）"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold"
                />
                {isPartialLayout(formData.layout) && (
                  <div className="mt-1 text-[10px] text-amber-700 font-semibold">
                    目前僅取得房數，廳衛待確認（尚未計為完整格局）
                  </div>
                )}
                {renderEvidenceQuote('layout')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">樓層 / 總樓層</label>
                  {renderStatusBadge('floor')}
                </div>
                <div className="flex space-x-1 items-center">
                  <input
                    type="text"
                    value={formData.floor}
                    onChange={(e) => handleChange('floor', e.target.value)}
                    placeholder="樓層 / B1"
                    className="w-20 px-2 py-2 border border-slate-300 rounded-lg text-xs text-center"
                  />
                  <span className="text-slate-400">/</span>
                  <input
                    type="text"
                    value={formData.totalFloors}
                    onChange={(e) => handleChange('totalFloors', e.target.value)}
                    placeholder="總樓層"
                    className="w-20 px-2 py-2 border border-slate-300 rounded-lg text-xs text-center"
                  />
                </div>
                <div className="mt-1 text-[10px] text-blue-700 font-semibold">
                  正規化呈現：{formatFloor(formData.floor, formData.totalFloors, formData.floorRaw)}
                </div>
                {renderEvidenceQuote('floor')}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">屋齡 (年)</label>
                  {renderStatusBadge('age')}
                </div>
                <input
                  type="number"
                  step="0.1"
                  value={formData.age ?? ''}
                  onChange={(e) => handleNumberInput('age', e.target.value)}
                  placeholder="待確認"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                {renderEvidenceQuote('age')}
              </div>
            </div>

            {/* Management fee raw amount + period + monthly conversion */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">
                  管理費（保留原繳費金額、計費週期並於週期已知時換算月均）
                </label>
                {renderStatusBadge('managementFeePeriod')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                <input
                  type="number"
                  step="10"
                  value={formData.managementFeeAmount ?? formData.managementFee ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const amt = raw === '' ? null : Number(raw);
                    handleManagementFeeUpdate(
                      amt !== null && Number.isFinite(amt) ? amt : null,
                      (formData.managementFeePeriod || 'unknown') as ManagementFeePeriod
                    );
                  }}
                  placeholder="金額 (元)"
                  className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                />
                <select
                  value={formData.managementFeePeriod || (formData.managementFee !== null ? 'monthly' : 'unknown')}
                  onChange={(e) =>
                    handleManagementFeeUpdate(
                      formData.managementFeeAmount ?? formData.managementFee ?? null,
                      e.target.value as ManagementFeePeriod
                    )
                  }
                  className="px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="unknown">計費週期待確認</option>
                  <option value="monthly">每月繳</option>
                  <option value="quarterly">每季繳 (÷3)</option>
                  <option value="half_year">每半年繳 (÷6)</option>
                  <option value="yearly">每年繳 (÷12)</option>
                </select>
                <div className="text-xs font-bold text-slate-800 bg-white px-3 py-2 rounded-lg border border-slate-200">
                  呈現：{formatManagementFee(formData)}
                </div>
              </div>
              {renderEvidenceQuote('managementFee')}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">使用現況</label>
              <div className="flex flex-wrap gap-3 text-xs">
                <label className="flex items-center space-x-1.5 cursor-pointer text-slate-500">
                  <input
                    type="radio"
                    name="currentUsage"
                    checked={!formData.currentUsage}
                    onChange={() => handleChange('currentUsage', '')}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span>待確認</span>
                </label>
                {(['自住', '空屋', '出租中', '其他'] as const).map((usage) => (
                  <label key={usage} className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="currentUsage"
                      checked={formData.currentUsage === usage}
                      onChange={() => handleChange('currentUsage', usage)}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span>{usage}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Section 5: Public Photos Management */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                <Camera className="w-4 h-4 text-blue-600" />
                <span>可對外使用之物件照片 ({formData.photos?.length || 0})</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                由經紀人挑選確認，外部網頁圖片不自動放入客戶報告
              </span>
            </div>

            <div className="flex space-x-2">
              <input
                type="url"
                value={photoInput}
                onChange={(e) => setPhotoInput(e.target.value)}
                placeholder="貼上照片公開網址..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
              <button
                type="button"
                onClick={handleAddPhoto}
                disabled={!photoInput.trim()}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center space-x-1 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>加入照片</span>
              </button>
            </div>

            {formData.photos && formData.photos.length > 0 && (
              <div className="grid grid-cols-3 gap-3 pt-2">
                {formData.photos.map((url, idx) => (
                  <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 group aspect-video">
                    <img src={url} alt={`物件照片 ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(idx)}
                      className="absolute top-1.5 right-1.5 p-1 bg-rose-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 6: Strictly Confidential Section */}
          <div className="bg-rose-50/60 p-5 rounded-2xl border-2 border-rose-200 shadow-xs space-y-3">
            <div className="flex items-center space-x-2 text-rose-800">
              <Lock className="w-4 h-4" />
              <h3 className="text-sm font-extrabold tracking-tight">內部機密專區 (絕對不匯出至客戶版或外部預覽)</h3>
            </div>
            <p className="text-[11px] text-rose-700">
              此處填寫之屋主底價、內部委託背景及談判備忘，在伺服器端與客戶報告匯出時會被嚴格隔離濾除。
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
              <div>
                <label className="block text-xs font-bold text-rose-900 mb-1">
                  屋主底牌／底價 (萬元) [極機密]
                </label>
                <input
                  type="number"
                  value={formData.reservePrice ?? ''}
                  onChange={(e) => handleNumberInput('reservePrice', e.target.value)}
                  placeholder="待確認"
                  className="w-full px-3 py-2 border border-rose-300 rounded-lg text-xs font-bold text-rose-900 bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-rose-900 mb-1">
                  經紀人內部備註 (委託談判細節、急售原因、屋況私密查核)
                </label>
                <textarea
                  rows={2}
                  value={formData.internalNotes || ''}
                  onChange={(e) => handleChange('internalNotes', e.target.value)}
                  placeholder="內部備忘記錄..."
                  className="w-full px-3 py-2 border border-rose-300 rounded-lg text-xs bg-white text-slate-800"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Instant Calculator & Compliance Panel */}
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4 sticky top-20">
            <div className="flex items-center space-x-2 text-blue-700">
              <Calculator className="w-5 h-5" />
              <h3 className="font-bold text-sm text-slate-900">單價即時計算與口徑校驗</h3>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="text-xs text-slate-500 font-semibold">
                標準口徑：{unitPriceResult.caliberLabel}
              </div>
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-black text-slate-900">
                  {unitPriceResult.unitPrice !== null ? unitPriceResult.unitPrice : '待確認'}
                </span>
                {unitPriceResult.unitPrice !== null && (
                  <span className="text-xs font-bold text-slate-600">萬元 / 坪</span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed pt-1 border-t border-slate-200">
                {priceUnresolved ? '開價待核對，確認後才會計算單價。' : unitPriceResult.explanation}
              </p>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <div className="text-xs text-slate-500 font-semibold">公設比試算</div>
              <div className="text-lg font-extrabold text-slate-800">
                {publicRatioResult.label}
              </div>
              <div className="text-[11px] text-slate-500">
                {publicRatioResult.detail ||
                  `共有部分 ${formData.commonArea ?? '待確認'} 坪 ÷ (主建 ${formData.mainArea ?? '待確認'} + 附屬 ${formData.auxArea ?? '0'} + 公設 ${formData.commonArea ?? '待確認'})`}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="text-xs font-bold text-slate-700">關鍵欄位審核狀態</div>
              {unresolvedConflicts.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>本案尚有 {unresolvedConflicts.length} 項未釐清衝突</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowConflictModal(true)}
                    className="w-full py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs font-bold"
                  >
                    開啟雙來源核對視窗
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={reportBlocked || priceUnresolved}              onClick={() => onProceedToReport(formData)}
              className="w-full py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>前往建立報告書（屋主／買方）</span>
              <span>&rarr;</span>
            </button>
          </div>
        </div>
      </div>

      {showConflictModal && formData.conflicts && (
        <ConflictResolutionModal
          isOpen={showConflictModal}
          onClose={() => setShowConflictModal(false)}
          conflicts={formData.conflicts}
          onResolveConflict={handleResolveConflict}
          onKeepUnresolved={handleKeepUnresolved}
        />
      )}
    </div>
  );
};

