import React, { useState, useRef, useEffect } from 'react';
import {
  Database,
  Globe,
  Edit3,
  Search,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Upload,
  Sparkles,
  AlertTriangle,
  XCircle,
  RotateCcw,
  FilePlus,
} from 'lucide-react';
import { PropertyData, hasUnresolvedPrice } from '../types/property';
import {
  formatLayout,
  normalizeLayoutInput,
  isPartialLayout,
  formatFloor,
  formatWan,
  formatPing,
  formatManagementFee,
  calculatePropertyCompleteness,
} from '../utils/calculator';

export type ImportMergeAction = 'create' | 'copy' | 'reuse' | 'merge_unverified';

interface PropertySourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportProperty: (
    property: PropertyData,
    action: ImportMergeAction,
    matchedExistingId?: string
  ) => Promise<void>;
  existingProperties: PropertyData[];
  dbConfigured: boolean;
}

export const PropertySourceModal: React.FC<PropertySourceModalProps> = ({
  isOpen,
  onClose,
  onImportProperty,
  existingProperties,
  dbConfigured,
}) => {
  const [activeSourceTab, setActiveSourceTab] = useState<'db' | 'url' | 'manual'>('db');

  // DB search state
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isApplyingImport, setIsApplyingImport] = useState(false);
  const applyingImportRef = useRef(false);

  // URL state
  const [urlInput, setUrlInput] = useState('');
  const [isExtractingUrl, setIsExtractingUrl] = useState(false);
  const [urlElapsedSec, setUrlElapsedSec] = useState(0);
  const [urlExtractionResult, setUrlExtractionResult] = useState<any | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlAbortRef = useRef<AbortController | null>(null);
  const urlReqTokenRef = useRef(0);

  // Manual / Text / Screenshot state
  const [manualTitleOnly, setManualTitleOnly] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [isExtractingText, setIsExtractingText] = useState(false);
  const [textElapsedSec, setTextElapsedSec] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const textAbortRef = useRef<AbortController | null>(null);
  const textReqTokenRef = useRef(0);

  // Duplicate prompt & field-diff modal state
  const [duplicateMatchInfo, setDuplicateMatchInfo] = useState<{
    incoming: PropertyData;
    existing: PropertyData;
    matchReason: 'external_id' | 'case_id' | 'name_only';
    diffs: Array<{
      key: string;
      label: string;
      oldDisplay: string;
      newDisplay: string;
      isVerifiedLocked: boolean;
    }>;
  } | null>(null);

  useEffect(() => {
    if (!isExtractingUrl) {
      setUrlElapsedSec(0);
      return;
    }
    const timer = setInterval(() => setUrlElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isExtractingUrl]);

  useEffect(() => {
    if (!isExtractingText) {
      setTextElapsedSec(0);
      return;
    }
    const timer = setInterval(() => setTextElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isExtractingText]);

  useEffect(() => {
    if (!isOpen) {
      urlAbortRef.current?.abort();
      textAbortRef.current?.abort();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const applyImport = async (property: PropertyData, action: ImportMergeAction, existingId?: string) => {
    if (applyingImportRef.current) return;
    applyingImportRef.current = true;
    setIsApplyingImport(true);
    setImportError(null);
    try {
      await onImportProperty(property, action, existingId);
      setDuplicateMatchInfo(null);
      onClose();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '匯入失敗，請再試一次。');
    } finally {
      applyingImportRef.current = false;
      setIsApplyingImport(false);
    }
  };

  const buildFieldDiffs = (existing: PropertyData, incoming: PropertyData) => {
    const specs: Array<{ key: keyof PropertyData; label: string; fmt?: (v: any, p: PropertyData) => string }> = [
      { key: 'askingPrice', label: '現行開價', fmt: (v) => formatWan(v) },
      { key: 'previousAskingPrice', label: '降價前原開價', fmt: (v) => formatWan(v) },
      { key: 'totalArea', label: '權狀總坪數', fmt: (v) => formatPing(v) },
      { key: 'mainArea', label: '主建物坪數', fmt: (v) => formatPing(v) },
      { key: 'commonArea', label: '共有部分(公設)', fmt: (v) => formatPing(v) },
      { key: 'parkingArea', label: '車位坪數', fmt: (v) => formatPing(v) },
      { key: 'parkingType', label: '車位型式' },
      { key: 'parkingOwnership', label: '車位權屬' },
      { key: 'layout', label: '格局', fmt: (v) => formatLayout(v) },
      { key: 'floor', label: '樓層', fmt: (_v, p) => formatFloor(p.floor, p.totalFloors, p.floorRaw) },
      { key: 'managementFeeAmount', label: '管理費', fmt: (_v, p) => formatManagementFee(p) },
    ];
    const diffs: Array<{
      key: string;
      label: string;
      oldDisplay: string;
      newDisplay: string;
      isVerifiedLocked: boolean;
    }> = [];
    for (const s of specs) {
      const oldDisp = s.fmt ? s.fmt(existing[s.key], existing) : String(existing[s.key] ?? '待確認') || '待確認';
      const newDisp = s.fmt ? s.fmt(incoming[s.key], incoming) : String(incoming[s.key] ?? '待確認') || '待確認';
      if (oldDisp !== newDisp && newDisp !== '待確認') {
        diffs.push({
          key: String(s.key),
          label: s.label,
          oldDisplay: oldDisp,
          newDisplay: newDisp,
          isVerifiedLocked: existing.fieldStatus?.[String(s.key)] === 'verified',
        });
      }
    }
    return diffs;
  };

  const checkDuplicate = (prop: PropertyData) => {
    // 1. Primary identity: (sourcePlatform, sourceListingId)
    let matched: PropertyData | undefined;
    let matchReason: 'external_id' | 'case_id' | 'name_only' = 'external_id';

    if (prop.sourcePlatform && prop.sourceListingId) {
      matched = existingProperties.find(
        (p) =>
          p.sourcePlatform === prop.sourcePlatform &&
          p.sourceListingId &&
          p.sourceListingId.toUpperCase() === prop.sourceListingId!.toUpperCase()
      );
    }

    // 2. Secondary: internal caseId (only if non-generic)
    if (!matched && prop.caseId) {
      matched = existingProperties.find((p) => p.caseId && p.caseId === prop.caseId);
      if (matched) matchReason = 'case_id';
    }

    // 3. Soft warning only: same caseName without matching external ID
    if (!matched && prop.caseName) {
      matched = existingProperties.find(
        (p) => p.caseName && p.caseName.trim().toLowerCase() === prop.caseName.trim().toLowerCase()
      );
      if (matched) matchReason = 'name_only';
    }

    if (matched) {
      setDuplicateMatchInfo({
        incoming: prop,
        existing: matched,
        matchReason,
        diffs: buildFieldDiffs(matched, prop),
      });
    } else {
      void applyImport(prop, 'create');
    }
  };

  // Build clean empty draft leaving unknown fields null / ''
  const buildEmptyDraft = (caseName: string, extra?: Partial<PropertyData>): PropertyData => ({
    id: `prop-draft-${Date.now()}`,
    caseId: `DRAFT-${Math.floor(Math.random() * 9000 + 1000)}`,
    caseName: caseName.trim() || '未命名物件草稿',
    cityDistrict: '',
    address: '',
    propertyType: '',
    askingPrice: null,
    parkingIncluded: null,
    totalArea: null,
    mainArea: null,
    auxArea: null,
    commonArea: null,
    parkingArea: null,
    parkingPrice: null,
    parkingType: '',
    layout: '',
    floor: '',
    totalFloors: '',
    age: null,
    managementFee: null,
    currentUsage: '',
    photos: [],
    isDemo: false,
    internalNotes: '',
    reservePrice: null,
    fieldStatus: {
      caseName: caseName.trim() ? 'verified' : 'pending',
    },
    evidenceSummaries: {
      caseName: '經紀人手動建立物件草稿',
    },
    conflicts: [],
    sourceType: extra?.sourceUrl ? 'url' : 'manual',
    sourceId: extra?.sourceUrl || `MANUAL-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    ...extra,
  });

  // Open blank proofread form directly (with optional URL reference preserved)
  const handleOpenBlankProofread = (titleOverride?: string, sourceUrl?: string) => {
    const fallbackTitle =
      titleOverride?.trim() ||
      manualTitleOnly.trim() ||
      (sourceUrl ? `待補公開網址物件 (${new Date().toLocaleDateString('zh-TW')})` : '新成屋草稿 (待補規格)');
    const draft = buildEmptyDraft(fallbackTitle, sourceUrl ? { sourceUrl, sourceType: 'url' } : undefined);
    void applyImport(draft, 'create');
  };

  // URL extraction (with optional cachedText reuse on AI timeout retry)
  const handleExtractUrlFor = async (targetUrl: string, cachedText?: string) => {
    if (!targetUrl.trim()) return;
    urlAbortRef.current?.abort();
    const controller = new AbortController();
    urlAbortRef.current = controller;
    const token = ++urlReqTokenRef.current;

    setUrlInput(targetUrl);
    setIsExtractingUrl(true);
    if (!cachedText) setUrlExtractionResult(null);
    setUrlError(null);

    try {
      const res = await fetch('/api/extract/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          cachedText,
          priorData: cachedText ? urlExtractionResult?.data : undefined,
        }),
        signal: controller.signal,
      });
      const result = await res.json();
      if (token !== urlReqTokenRef.current) return;

      if (!res.ok) {
        setUrlExtractionResult(result?.webFetchStatus ? result : null);
        setUrlError(result?.error || '網址分析失敗，請重試或改用空白表單。');
        return;
      }
      setUrlExtractionResult(result);
    } catch (err: any) {
      if (token !== urlReqTokenRef.current) return;
      if (err?.name === 'AbortError') {
        setUrlError('已取消網址擷取，您的輸入與現有資料已保留。');
      } else {
        setUrlError('網址連線失敗，請檢查網路或改用貼上文字／空白校對表單。');
      }
    } finally {
      if (token === urlReqTokenRef.current) {
        setIsExtractingUrl(false);
      }
    }
  };

  const handleCancelUrlExtract = () => {
    urlReqTokenRef.current += 1;
    urlAbortRef.current?.abort();
    setIsExtractingUrl(false);
    setUrlError('已手動停止本次網址擷取。');
  };

  // Text/Screenshot extraction (preserving pastedText & screenshotBase64 on error/cancel)
  const handleExtractTextOrImage = async () => {
    if (!pastedText.trim() && !screenshotBase64) return;
    textAbortRef.current?.abort();
    const controller = new AbortController();
    textAbortRef.current = controller;
    const token = ++textReqTokenRef.current;

    setIsExtractingText(true);
    setExtractError(null);

    try {
      const res = await fetch('/api/extract/text-or-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: pastedText,
          imageBase64: screenshotBase64,
        }),
        signal: controller.signal,
      });
      const result = await res.json();
      if (token !== textReqTokenRef.current) return;

      if (!res.ok || result.error) {
        throw new Error(result.error || '文字或圖片解析失敗，請稍後重試。');
      }

      const d = result.data || {};
      const imported: PropertyData = {
        ...d,
        id: `prop-gen-${Date.now()}`,
        caseId: d.caseId || `IMP-${Math.floor(Math.random() * 9000 + 1000)}`,
        caseName: d.caseName || '新匯入物件 (待校對)',
        cityDistrict: d.cityDistrict || '',
        address: d.address || '',
        propertyType: d.propertyType || '',
        askingPrice: d.askingPrice ?? null,
        previousAskingPrice: d.previousAskingPrice ?? null,
        hasParking: typeof d.hasParking === 'boolean' ? d.hasParking : null,
        parkingIncluded: typeof d.parkingIncluded === 'boolean' ? d.parkingIncluded : null,
        totalArea: d.totalArea ?? null,
        mainArea: d.mainArea ?? null,
        auxArea: d.auxArea ?? null,
        commonArea: d.commonArea ?? null,
        parkingArea: d.parkingArea ?? null,
        parkingAreaIncludedInCommon:
          typeof d.parkingAreaIncludedInCommon === 'boolean' ? d.parkingAreaIncludedInCommon : null,
        parkingPrice: d.parkingPrice ?? null,
        parkingType: d.parkingType || '',
        parkingOwnership: d.parkingOwnership || '',
        layout: normalizeLayoutInput(d.layout),
        floor: d.floor ? String(d.floor) : '',
        totalFloors: d.totalFloors ? String(d.totalFloors) : '',
        floorRaw: d.floorRaw || '',
        age: d.age ?? null,
        managementFee: d.managementFee ?? null,
        managementFeeAmount: d.managementFeeAmount ?? null,
        managementFeePeriod: d.managementFeePeriod || '',
        managementFeeRaw: d.managementFeeRaw || '',
        currentUsage: d.currentUsage || '',
        photos: [],
        isDemo: false,
        internalNotes: '',
        reservePrice: null,
        fieldStatus: {
          ...(d.fieldStatus || {}),
          caseName: d.caseName ? 'recorded' : 'pending',
          askingPrice: d.askingPrice !== null && d.askingPrice !== undefined ? 'recorded' : 'pending',
          totalArea: d.totalArea !== null && d.totalArea !== undefined ? 'recorded' : 'pending',
          layout:
            d.layout && !isPartialLayout(d.layout)
              ? d.fieldStatus?.layout || 'recorded'
              : 'pending',
        },
        evidenceSummaries: {
          ...(d.evidenceSummaries || {}),
          caseName: result.evidenceSummary || '截自輸入之文字或截圖內容',
        },
        conflicts: result.conflicts || [],
        sourceType: screenshotBase64 ? 'screenshot' : 'manual',
        sourceId: `SRC-${Date.now()}`,
        updatedAt: new Date().toISOString(),
      };

      checkDuplicate(imported);
    } catch (err: any) {
      if (token !== textReqTokenRef.current) return;
      if (err?.name === 'AbortError') {
        setExtractError('已手動取消解析，您貼上的文字與截圖內容已完整保留。');
      } else {
        setExtractError(err.message || '文字或圖片擷取失敗，您的原始輸入已保留，可重試或改用空白表單。');
      }
    } finally {
      if (token === textReqTokenRef.current) {
        setIsExtractingText(false);
      }
    }
  };

  const handleCancelTextExtract = () => {
    textReqTokenRef.current += 1;
    textAbortRef.current?.abort();
    setIsExtractingText(false);
    setExtractError('已手動停止 AI 解析，已保留您貼上的文字／圖片。');
  };

  // Quick draft creation with ONLY title (all unknown fields stay empty/null!)
  const handleCreateDraftTitleOnly = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitleOnly.trim()) return;
    const newDraft = buildEmptyDraft(manualTitleOnly.trim());
    checkDuplicate(newDraft);
  };

  // Convert url extraction result to property without fabricating missing defaults
  const handleApplyUrlResult = () => {
    if (!urlExtractionResult?.data) return;
    const d = urlExtractionResult.data;
    const imported: PropertyData = {
      ...d,
      id: `prop-url-${Date.now()}`,
      caseId: d.caseId || `WEB-${Math.floor(Math.random() * 9000 + 1000)}`,
      caseName: d.caseName || '外部公開物件 (待校對)',
      cityDistrict: d.cityDistrict || '',
      address: d.address || '',
      propertyType: d.propertyType || '',
      askingPrice: d.askingPrice ?? null,
      previousAskingPrice: d.previousAskingPrice ?? null,
      hasParking: typeof d.hasParking === 'boolean' ? d.hasParking : null,
      parkingIncluded: typeof d.parkingIncluded === 'boolean' ? d.parkingIncluded : null,
      totalArea: d.totalArea ?? null,
      mainArea: d.mainArea ?? null,
      auxArea: d.auxArea ?? null,
      commonArea: d.commonArea ?? null,
      parkingArea: d.parkingArea ?? null,
      parkingAreaIncludedInCommon:
        typeof d.parkingAreaIncludedInCommon === 'boolean' ? d.parkingAreaIncludedInCommon : null,
      parkingPrice: d.parkingPrice ?? null,
      parkingType: d.parkingType || '',
      parkingOwnership: d.parkingOwnership || '',
      layout: normalizeLayoutInput(d.layout),
      floor: d.floor ? String(d.floor) : '',
      totalFloors: d.totalFloors ? String(d.totalFloors) : '',
      floorRaw: d.floorRaw || '',
      age: d.age ?? null,
      managementFee: d.managementFee ?? null,
      managementFeeAmount: d.managementFeeAmount ?? null,
      managementFeePeriod: d.managementFeePeriod || '',
      managementFeeRaw: d.managementFeeRaw || '',
      currentUsage: d.currentUsage || '',
      photos: [],
      isDemo: Boolean(d.isDemo),
      internalNotes: '',
      reservePrice: null,
      fieldStatus: {
        ...(d.fieldStatus || {}),
        caseName: d.caseName ? d.fieldStatus?.caseName || 'recorded' : 'pending',
        askingPrice:
          d.askingPrice !== null && d.askingPrice !== undefined
            ? d.fieldStatus?.askingPrice || 'recorded'
            : 'pending',
        totalArea:
          d.totalArea !== null && d.totalArea !== undefined
            ? d.fieldStatus?.totalArea || 'recorded'
            : 'pending',
        layout:
          d.layout && !isPartialLayout(d.layout)
            ? d.fieldStatus?.layout || 'recorded'
            : 'pending',
      },
      evidenceSummaries: {
        ...(d.evidenceSummaries || {}),
        caseName: d.evidenceSummaries?.caseName || `公開網頁網址：${urlInput}`,
      },
      conflicts: Array.isArray(d.conflicts) ? d.conflicts : [],
      sourceType: 'url',
      sourcePlatform: urlExtractionResult.sourcePlatform || d.sourcePlatform || '',
      sourceListingId: urlExtractionResult.sourceListingId || d.sourceListingId || '',
      sourceId: urlExtractionResult.sourceListingId || urlInput,
      sourceUrl: urlInput,
      fetchedAt: d.fetchedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    checkDuplicate(imported);
  };

  const handleOpenRawTextInManualTab = () => {
    const txt = urlExtractionResult?.rawFetchedText || '';
    if (txt) {
      setPastedText(txt);
    }
    setActiveSourceTab('manual');
  };

  const filteredDbProperties = existingProperties.filter(
    (p) =>
      p.caseName.toLowerCase().includes(dbSearchQuery.toLowerCase()) ||
      p.caseId.toLowerCase().includes(dbSearchQuery.toLowerCase()) ||
      p.cityDistrict.toLowerCase().includes(dbSearchQuery.toLowerCase())
  );

  const renderWebStatusLabel = (status?: string) => {
    switch (status) {
      case 'ok':
        return <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">目標網頁可讀取</span>;
      case 'blocked_or_login':
        return <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">目標網站存取受限 / 需驗證</span>;
      case 'timeout':
        return <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">目標網頁連線逾時</span>;
      case 'unreachable':
        return <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">目標網頁無法讀取</span>;
      default:
        return <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">未執行網頁連線</span>;
    }
  };

  const renderTargetMatchLabel = (pageType?: string) => {
    switch (pageType) {
      case 'single_listing':
        return <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">單一待售物件頁</span>;
      case 'listing_index':
        return <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">列表 / 地圖搜尋頁</span>;
      case 'homepage':
        return <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">網站首頁 (非單一物件)</span>;
      case 'delisted_or_redirected':
        return <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">已下架或轉址</span>;
      case 'template_only':
        return <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">動態樣板無靜態規格</span>;
      default:
        return <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">未判別</span>;
    }
  };

  const renderAiStatusLabel = (status?: string) => {
    switch (status) {
      case 'ok':
        return <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">AI 補齊正常</span>;
      case 'unavailable':
        return <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">AI 服務暫時忙碌 (503)</span>;
      case 'quota':
        return <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">AI 請求額度受限 (429)</span>;
      case 'timeout':
        return <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">AI 補齊逾時 (已保留規則欄位)</span>;
      case 'skipped':
        return <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">已透過規則解析 / 未呼叫 AI</span>;
      default:
        return <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold">AI 服務異常</span>;
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 no-print">
        <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base flex items-center space-x-2">
                <span>匯入物件資料進入校對表單</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                支援資料庫選取、公開網址擷取、文字／截圖解析或空白草稿，未記載欄位一律維持「待確認」不預設補值
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isApplyingImport}
              aria-label="關閉匯入視窗"
              className="text-slate-400 hover:text-white text-xl leading-none"
            >
              &times;
            </button>
          </div>

          {/* Source Tabs */}
          <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3">
            <button
              type="button"
              onClick={() => setActiveSourceTab('db')}
              className={`flex items-center space-x-2 pb-3 px-4 text-xs font-bold border-b-2 transition-all ${
                activeSourceTab === 'db'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>入口一：選取物件庫</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSourceTab('url')}
              className={`flex items-center space-x-2 pb-3 px-4 text-xs font-bold border-b-2 transition-all ${
                activeSourceTab === 'url'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>入口二：貼上公開物件網址</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSourceTab('manual')}
              className={`flex items-center space-x-2 pb-3 px-4 text-xs font-bold border-b-2 transition-all ${
                activeSourceTab === 'manual'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Edit3 className="w-4 h-4" />
              <span>入口三：手動 / 文字 / 截圖</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            {importError && !duplicateMatchInfo && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{importError}</p>}
            {/* TAB 1: FROM DATABASE */}
            {activeSourceTab === 'db' && (
              <div className="space-y-4">
                {!dbConfigured && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start space-x-3 text-amber-900 text-xs">
                    <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-bold text-sm">正式資料庫尚未連線</div>
                      <p className="mt-0.5 text-amber-800">
                        可開啟示範物件，或先完成新物件校對，待資料庫恢復後再儲存。
                      </p>
                    </div>
                  </div>
                )}

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={dbSearchQuery}
                    onChange={(e) => setDbSearchQuery(e.target.value)}
                    placeholder="輸入物件編號、案名、縣市或行政區查詢..."
                    className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-2.5">
                  <div className="text-xs font-bold text-slate-600 flex justify-between items-center">
                    <span>可選取物件 ({filteredDbProperties.length})</span>
                    <button
                      type="button"
                      onClick={() => handleOpenBlankProofread()}
                      className="text-blue-700 hover:underline font-semibold flex items-center space-x-1"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                      <span>開啟空白校對表單</span>
                    </button>
                  </div>

                  {filteredDbProperties.length === 0 && (
                    <p className="py-3 text-xs text-slate-600">
                      {dbSearchQuery.trim() ? '找不到符合搜尋條件的物件。' : '物件庫目前沒有資料，可先開啟空白校對表單。'}
                    </p>
                  )}
                  {filteredDbProperties.map((prop) => (
                    <div
                      key={prop.id}
                      className="p-3.5 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50/40 transition-all flex items-center justify-between group"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                            {prop.caseId}
                          </span>
                          <span className="font-bold text-slate-900 text-sm">{prop.caseName}</span>
                          {prop.isDemo && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-bold">
                              示範資料
                            </span>
                          )}
                          {hasUnresolvedPrice(prop) && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded font-bold">
                              有價格衝突待確認
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center space-x-3">
                          <span>{prop.cityDistrict || '待確認'}</span>
                          <span>•</span>
                          <span>開價 <strong className="text-blue-700">{hasUnresolvedPrice(prop) ? '待核對' : formatWan(prop.askingPrice)}</strong></span>
                          <span>•</span>
                          <span>權狀 {formatPing(prop.totalArea)}</span>
                          <span>•</span>
                          <span>{formatLayout(prop.layout)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void applyImport(prop, 'reuse', prop.id)}
                        disabled={isApplyingImport}
                        className="px-3.5 py-1.5 bg-blue-700 group-hover:bg-blue-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1 shrink-0 shadow-xs"
                      >
                        <span>開啟校對</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 2: FROM PUBLIC URL */}
            {activeSourceTab === 'url' && (
              <div className="space-y-4 text-xs">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-blue-900">
                  <div className="font-bold text-sm">公開網址讀取與雙重狀態診斷</div>
                  <p className="mt-0.5 text-blue-800">
                    系統會分別呈現「目標網頁擷取狀態」、「AI 模型服務狀態」與「欄位完整度 %」，不會將 AI 忙碌誤判為網站封鎖；若遭遇限制或逾時，可隨時取消或一鍵轉入空白校對／草稿。
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    公開售屋物件網址
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="url"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="輸入各大房仲公開物件網址（如 591、信義、永慶、住商）..."
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-blue-500"
                    />
                    {isExtractingUrl ? (
                      <button
                        type="button"
                        onClick={handleCancelUrlExtract}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold flex items-center space-x-1.5 shrink-0"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>取消 ({urlElapsedSec}s)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleExtractUrlFor(urlInput)}
                        disabled={!urlInput.trim()}
                        className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-semibold flex items-center space-x-1.5 shrink-0 disabled:opacity-50"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>開始擷取</span>
                      </button>
                    )}
                  </div>

                  {/* Preset test buttons */}
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-500 mr-1">情境測試：</span>
                    <button
                      type="button"
                      onClick={() => handleExtractUrlFor('https://demo.taiwan-estate.com/listings/zb-highspeed-4r')}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-medium"
                    >
                      1. 完整可讀取 (示範)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExtractUrlFor('https://demo.taiwan-estate.com/listings/partial-specs')}
                      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[11px] font-medium"
                    >
                      2. 部分欄位待補 (示範)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExtractUrlFor('https://demo.taiwan-estate.com/listings/auth-required-login')}
                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-lg text-[11px] font-medium"
                    >
                      3. 目標網站防爬蟲阻擋 (示範)
                    </button>
                  </div>
                </div>

                {/* Direct fallback shortcuts right in URL screen */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200">
                  <span className="text-slate-600 text-[11px]">
                    不等待外部網址或遇網站阻擋？可直接建立空白表單：
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => handleOpenBlankProofread('', urlInput.trim() || undefined)}
                      className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-lg text-[11px] font-semibold"
                    >
                      開啟空白校對表單
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSourceTab('manual')}
                      className="px-3 py-1 bg-slate-800 hover:bg-black text-white rounded-lg text-[11px] font-semibold"
                    >
                      轉往貼上文字／標題草稿
                    </button>
                  </div>
                </div>

                {urlError && (
                  <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl space-y-2.5">
                    <div className="flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-bold">連線或 AI 服務狀態通知</div>
                        <div className="mt-0.5">{urlError}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleExtractUrlFor(urlInput)}
                        disabled={!urlInput.trim() || isExtractingUrl}
                        className="px-3 py-1 bg-white border border-rose-300 text-rose-800 rounded-lg text-[11px] font-bold flex items-center space-x-1 hover:bg-rose-100"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>重試網址擷取</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenBlankProofread('', urlInput.trim() || undefined)}
                        className="px-3 py-1 bg-blue-700 text-white rounded-lg text-[11px] font-bold"
                      >
                        改開空白校對表單
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveSourceTab('manual')}
                        className="px-3 py-1 bg-slate-800 text-white rounded-lg text-[11px] font-bold"
                      >
                        改貼文字／先存標題草稿
                      </button>
                    </div>
                  </div>
                )}

                {urlExtractionResult && (() => {
                  const comp =
                    urlExtractionResult.completeness ||
                    calculatePropertyCompleteness(urlExtractionResult.data);
                  const aiFailed = ['timeout', 'unavailable', 'quota', 'error'].includes(
                    urlExtractionResult.aiServiceStatus
                  );

                  return (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                      {/* Multi-stage status badges & core checklist count */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span>1. 網頁讀取：{renderWebStatusLabel(urlExtractionResult.webFetchStatus)}</span>
                          <span>2. 頁型辨識：{renderTargetMatchLabel(urlExtractionResult.pageType)}</span>
                          <span>3. 模型補齊：{renderAiStatusLabel(urlExtractionResult.aiServiceStatus)}</span>
                        </div>
                        <span className="text-slate-800 font-extrabold text-xs">
                          已取得 {comp.coreAvailable}／{comp.coreTotal} 項核心欄位（總可用 {comp.totalAvailable}／{comp.totalApplicable}）
                        </span>
                      </div>

                      <p className="text-slate-800 bg-white p-2.5 rounded-lg border border-slate-200 leading-relaxed">
                        {urlExtractionResult.statusDescription || urlExtractionResult.evidenceSummary}
                      </p>

                      {/* Status breakdown pills & missing items */}
                      {urlExtractionResult.data && (
                        <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1.5 text-[11px]">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                              來源有記載：{comp.statusCounts.recorded}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">
                              已核對：{comp.statusCounts.verified}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-semibold">
                              待確認：{comp.statusCounts.pending}
                            </span>
                            {comp.statusCounts.not_applicable > 0 && (
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                                不適用：{comp.statusCounts.not_applicable}
                              </span>
                            )}
                          </div>
                          {(comp.missingCoreLabels.length > 0 || comp.missingAdvancedLabels.length > 0) && (
                            <div className="text-slate-600">
                              尚待確認補充：
                              <span className="text-amber-800 font-medium">
                                {[...comp.missingCoreLabels, ...comp.missingAdvancedLabels].join('、')}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Extracted Preview Grid */}
                      {urlExtractionResult.data ? (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-white p-3 rounded-lg border border-slate-200 text-slate-800">
                            <div>案名：<strong>{urlExtractionResult.data.caseName || '待確認'}</strong></div>
                            <div>
                              開價：<strong>{formatWan(urlExtractionResult.data.askingPrice)}</strong>
                              {urlExtractionResult.data.previousAskingPrice ? (
                                <span className="ml-1 text-[10px] text-slate-400 line-through">
                                  {urlExtractionResult.data.previousAskingPrice}萬
                                </span>
                              ) : null}
                            </div>
                            <div>建物型態：<strong>{urlExtractionResult.data.propertyType || '待確認'}</strong></div>
                            <div>總坪數：<strong>{formatPing(urlExtractionResult.data.totalArea)}</strong></div>
                            <div>主建物：<strong>{formatPing(urlExtractionResult.data.mainArea)}</strong></div>
                            <div>屋齡：<strong>{urlExtractionResult.data.age != null ? `${urlExtractionResult.data.age} 年` : '待確認'}</strong></div>
                            <div>格局：{formatLayout(urlExtractionResult.data.layout)}</div>
                            <div>
                              樓層：{formatFloor(urlExtractionResult.data.floor, urlExtractionResult.data.totalFloors, urlExtractionResult.data.floorRaw)}
                            </div>
                            <div>
                              車位：{urlExtractionResult.data.parkingOwnership ? `${urlExtractionResult.data.parkingOwnership} ` : ''}
                              {urlExtractionResult.data.parkingType || (urlExtractionResult.data.hasParking ? '車位型式待確認' : '待確認')}
                            </div>
                            <div className="sm:col-span-2">
                              管理費：<strong>{formatManagementFee(urlExtractionResult.data)}</strong>
                            </div>
                            <div>
                              來源：{urlExtractionResult.sourcePlatform || '網頁'} {urlExtractionResult.sourceListingId ? `(${urlExtractionResult.sourceListingId})` : ''}
                            </div>
                          </div>

                          {urlExtractionResult.data.evidenceSummaries &&
                            Object.keys(urlExtractionResult.data.evidenceSummaries).length > 0 && (
                              <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1">
                                <div className="font-bold text-slate-700">主要欄位原文與來源出處：</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                                  {Object.entries(urlExtractionResult.data.evidenceSummaries).map(([k, v]) => (
                                    <div key={k} className="truncate" title={String(v)}>
                                      <span className="font-mono text-slate-400 mr-1">{k}:</span>
                                      <span>{String(v)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleApplyUrlResult}
                              className="flex-1 py-2 px-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold flex items-center justify-center space-x-2"
                            >
                              <span>{aiFailed ? '帶入已擷取欄位進入校對' : '套用擷取資料並進入校對表單'}</span>
                              <ArrowRight className="w-4 h-4" />
                            </button>

                            {urlExtractionResult.rawFetchedText && (
                              <button
                                type="button"
                                onClick={handleOpenRawTextInManualTab}
                                className="px-3.5 py-2 bg-slate-800 hover:bg-black text-white rounded-lg text-xs font-semibold"
                              >
                                查看／帶入已讀文字
                              </button>
                            )}

                            {aiFailed && urlExtractionResult.rawFetchedText && (
                              <button
                                type="button"
                                onClick={() => handleExtractUrlFor(urlInput, urlExtractionResult.rawFetchedText)}
                                disabled={isExtractingUrl}
                                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>沿用已讀內容重試 AI</span>
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {urlExtractionResult.rawFetchedText && (
                            <button
                              type="button"
                              onClick={handleOpenRawTextInManualTab}
                              className="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>查看／帶入已讀文字至貼上區</span>
                            </button>
                          )}
                          {!urlExtractionResult.rawFetchedText && (
                            <button
                              type="button"
                              onClick={() => setActiveSourceTab('manual')}
                              className="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>切換入口三：貼上文字／截圖／存標題草稿</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenBlankProofread('', urlInput.trim() || undefined)}
                            className="px-3.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold"
                          >
                            直接開啟空白校對表單
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB 3: MANUAL / TEXT / SCREENSHOT */}
            {activeSourceTab === 'manual' && (
              <div className="space-y-4 text-xs">
                {/* Method 1: Title only draft */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div className="font-bold text-slate-900 text-sm mb-1">
                    方案 A：只輸入案名先存草稿（不預填任何預設值）
                  </div>
                  <p className="text-slate-500 mb-2">
                    只輸入案名建立草稿，縣市、建物型態、車位型式、價格與坪數全部留空標記「待確認」，絕不自動填入竹北或 0 萬。
                  </p>
                  <form onSubmit={handleCreateDraftTitleOnly} className="flex space-x-2">
                    <input
                      type="text"
                      value={manualTitleOnly}
                      onChange={(e) => setManualTitleOnly(e.target.value)}
                      placeholder="例如：竹北高鐵東側晴川三房平車（測試案）"
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={!manualTitleOnly.trim()}
                      className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold disabled:opacity-50 shrink-0"
                    >
                      先存草稿
                    </button>
                  </form>
                </div>

                {/* Method 2: Paste listing text or upload screenshot */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-900 text-sm">
                      方案 B：貼上物件頁文字或上傳截圖（由 AI 智慧解析欄位）
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenBlankProofread()}
                      className="text-blue-700 hover:underline font-semibold text-[11px]"
                    >
                      直接開啟空白校對表單 &rarr;
                    </button>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      貼上物件介紹、謄本文字或規格摘要
                    </label>
                    <textarea
                      rows={4}
                      value={pastedText}
                      onChange={(e) => setPastedText(e.target.value)}
                      placeholder="貼上文字，例如：案名、開價、權狀總坪數、主建/附屬/公設/車位坪數、格局、樓層、屋齡..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      或上傳物件截圖（選填）
                    </label>
                    <div className="flex items-center space-x-3">
                      <label className="px-3 py-2 bg-white border border-slate-300 hover:border-slate-400 rounded-lg cursor-pointer flex items-center space-x-2 font-medium">
                        <Upload className="w-3.5 h-3.5 text-slate-500" />
                        <span>選擇物件規格截圖</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => {
                              const rawDataUrl = reader.result as string;
                              if (file.size <= 350 * 1024 || file.type === 'image/svg+xml') {
                                setScreenshotBase64(rawDataUrl);
                                return;
                              }
                              const img = new Image();
                              img.onload = () => {
                                const maxDim = 1600;
                                let { width, height } = img;
                                if (width > maxDim || height > maxDim) {
                                  const ratio = Math.min(maxDim / width, maxDim / height);
                                  width = Math.round(width * ratio);
                                  height = Math.round(height * ratio);
                                }
                                const canvas = document.createElement('canvas');
                                canvas.width = width;
                                canvas.height = height;
                                const ctx = canvas.getContext('2d');
                                if (ctx) {
                                  ctx.drawImage(img, 0, 0, width, height);
                                  setScreenshotBase64(canvas.toDataURL('image/jpeg', 0.85));
                                } else {
                                  setScreenshotBase64(rawDataUrl);
                                }
                              };
                              img.onerror = () => setScreenshotBase64(rawDataUrl);
                              img.src = rawDataUrl;
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                      {screenshotBase64 && (
                        <div className="flex items-center space-x-2">
                          <span className="text-emerald-700 font-medium">已載入截圖</span>
                          <button
                            type="button"
                            onClick={() => setScreenshotBase64(null)}
                            className="text-rose-600 hover:underline"
                          >
                            移除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {extractError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-900 rounded-lg space-y-2">
                      <div>{extractError}</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleExtractTextOrImage}
                          disabled={isExtractingText}
                          className="px-3 py-1 bg-white border border-rose-300 text-rose-800 rounded font-semibold flex items-center space-x-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>重試 AI 解析</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenBlankProofread()}
                          className="px-3 py-1 bg-blue-700 text-white rounded font-semibold"
                        >
                          開啟空白校對表單手動填寫
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleExtractTextOrImage}
                      disabled={isExtractingText || (!pastedText.trim() && !screenshotBase64)}
                      className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-semibold flex items-center justify-center space-x-2 disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>
                        {isExtractingText
                          ? `AI 正在解析成屋規格 (${textElapsedSec}s)...`
                          : '解析文字/截圖並送入校對表單'}
                      </span>
                    </button>
                    {isExtractingText && (
                      <button
                        type="button"
                        onClick={handleCancelTextExtract}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold flex items-center space-x-1"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>取消解析</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Duplicate / Field Diff Merge Prompt Modal */}
      {duplicateMatchInfo && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 p-4 no-print">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center space-x-3 text-amber-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <div>
                <h4 className="font-bold text-base text-slate-900">
                  {duplicateMatchInfo.matchReason === 'external_id'
                    ? '偵測到相同來源平台與物件編號'
                    : duplicateMatchInfo.matchReason === 'case_id'
                    ? '偵測到相同內部物件編號'
                    : '偵測到同名物件提醒（非相同外部來源編號）'}
                </h4>
                <p className="text-[11px] text-slate-500">
                  既有物件：{duplicateMatchInfo.existing.caseName} ({duplicateMatchInfo.existing.caseId})
                </p>
              </div>
            </div>

            {duplicateMatchInfo.diffs.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700">
                  欄位差異比較（已標記「經紀人已核對」欄位將受保護不被自動覆蓋）：
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="p-2">欄位</th>
                        <th className="p-2">既有值</th>
                        <th className="p-2">本次新讀取</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {duplicateMatchInfo.diffs.map((d) => (
                        <tr key={d.key}>
                          <td className="p-2 font-semibold text-slate-800">
                            {d.label}
                            {d.isVerifiedLocked && (
                              <span className="ml-1 px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded text-[10px]">
                                已核對受保護
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-slate-500">{d.oldDisplay}</td>
                          <td className="p-2 font-bold text-blue-700">{d.newDisplay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-600">
                新讀取資料與既有紀錄核心欄位無差異，您可以直接沿用既有物件檢視，或另存為獨立物件。
              </p>
            )}

            {duplicateMatchInfo.matchReason === 'name_only' && (
              <p className="text-xs text-slate-600">只有案名相同，請保留既有紀錄或另存新物件。</p>
            )}
            {!dbConfigured && <p className="text-xs text-slate-600">資料庫尚未連線，暫時無法合併既有紀錄。</p>}
            {importError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{importError}</p>}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isApplyingImport}
                onClick={() => { setDuplicateMatchInfo(null); setImportError(null); }}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700"
              >
                返回修改
              </button>
              <button
                type="button"
                disabled={isApplyingImport}
                onClick={() => void applyImport(duplicateMatchInfo.incoming, 'copy')}
                className="px-3.5 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50"
              >
                另存為新物件
              </button>
              <button
                type="button"
                disabled={isApplyingImport}
                onClick={() => void applyImport(duplicateMatchInfo.incoming, 'reuse', duplicateMatchInfo.existing.id)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold"
              >
                保留既有紀錄不更新
              </button>
              <button
                type="button"
                disabled={isApplyingImport || !dbConfigured || duplicateMatchInfo.matchReason === 'name_only'}
                onClick={() => void applyImport(duplicateMatchInfo.incoming, 'merge_unverified', duplicateMatchInfo.existing.id)}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-bold shadow-xs"
              >
                {isApplyingImport ? '處理中…' : '只更新空白／未核對欄位'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
