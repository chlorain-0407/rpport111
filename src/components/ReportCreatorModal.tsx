import React, { useState, useEffect, useRef } from 'react';
import {
  User,
  UserCheck,
  Plus,
  Trash2,
  Sparkles,
  AlertCircle,
  XCircle,
  RotateCcw,
  Save,
  Edit2,
  Check,
} from 'lucide-react';
import { PropertyData, ComparableSale, CompetingListing } from '../types/property';
import {
  ReportType,
  OwnerSubType,
  BuyerRequirements,
  OwnerProgressData,
  AnonymousFeedback,
  ReportDocument,
} from '../types/report';
import {
  DEMO_COMPARABLES_ZB,
  DEMO_COMPETING_ZB,
  DEMO_BUYER_A,
  DEMO_BUYER_B,
  DEMO_OWNER_PROGRESS,
} from '../utils/mockData';
import { formatLayout, formatWan, formatPing } from '../utils/calculator';

interface ReportCreatorModalProps {
  property: PropertyData;
  onReportCreated: (newReport: ReportDocument) => void;
  onCancel?: () => void;
}

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultPeriodStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString().slice(0, 10);
}

function createEmptyProgress(propertyId: string, periodStart: string, periodEnd: string): OwnerProgressData {
  return {
    propertyId,
    periodStart,
    periodEnd,
    onlineImpressions: null,
    inquiryCount: null,
    showingCount: null,
    anonymousFeedback: [],
    completedActions: [],
    nextPlannedActions: [],
    isDemo: false,
  };
}

function createEmptyBuyer(propertyId: string): BuyerRequirements {
  return {
    propertyId,
    buyerId: `buyer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    buyerNickname: '',
    buyerContact: '',
    budgetMin: null,
    budgetMax: null,
    mustHaves: [],
    preferences: [],
    dealBreakers: [],
    livingCircle: '',
    privateNotes: '',
    isDemo: false,
  };
}

export const ReportCreatorModal: React.FC<ReportCreatorModalProps> = ({
  property,
  onReportCreated,
  onCancel,
}) => {
  const [reportType, setReportType] = useState<ReportType>('owner');
  const [ownerSubType, setOwnerSubType] = useState<OwnerSubType>('pre_listing');

  // Race-condition protection token & AbortController for property switching
  const propLoadTokenRef = useRef(0);
  const propAbortRef = useRef<AbortController | null>(null);
  const progressFetchTokenRef = useRef(0);

  // Owner Progress State (starts empty for current property, never pre-filled with demo!)
  const [ownerProgress, setOwnerProgress] = useState<OwnerProgressData>(() =>
    createEmptyProgress(property.id, getDefaultPeriodStart(), getTodayDateString())
  );
  const [savedProgressList, setSavedProgressList] = useState<OwnerProgressData[]>([]);
  const [progressStatusMsg, setProgressStatusMsg] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);

  // Feedback & Action editor states
  const [newFbDate, setNewFbDate] = useState(getTodayDateString());
  const [newFbFocus, setNewFbFocus] = useState<AnonymousFeedback['focus']>('價格');
  const [newFbContent, setNewFbContent] = useState('');
  const [editingFbId, setEditingFbId] = useState<string | null>(null);
  const [editingFbText, setEditingFbText] = useState('');

  const [newCompletedAction, setNewCompletedAction] = useState('');
  const [editingCompletedIdx, setEditingCompletedIdx] = useState<number | null>(null);
  const [editingCompletedText, setEditingCompletedText] = useState('');

  const [newNextAction, setNewNextAction] = useState('');
  const [editingNextIdx, setEditingNextIdx] = useState<number | null>(null);
  const [editingNextText, setEditingNextText] = useState('');

  // Buyer Requirements State (starts empty/opt-in for current property)
  const [savedBuyers, setSavedBuyers] = useState<BuyerRequirements[]>([]);
  const [hasBuyerRequirements, setHasBuyerRequirements] = useState(false);
  const [buyerInput, setBuyerInput] = useState<BuyerRequirements>(() => createEmptyBuyer(property.id));
  const [buyerStatusMsg, setBuyerStatusMsg] = useState<string | null>(null);
  const [buyerError, setBuyerError] = useState<string | null>(null);

  // Comps & Competing Listings State (starts empty for current property; fetched from DB)
  const [comparables, setComparables] = useState<ComparableSale[]>([]);
  const [competingListings, setCompetingListings] = useState<CompetingListing[]>([]);
  const [showAddCompForm, setShowAddCompForm] = useState(false);
  const [newComp, setNewComp] = useState<Partial<ComparableSale>>({
    communityName: '',
    dealDate: '',
    totalPrice: 0,
    totalPing: 0,
    parkingPrice: null,
    parkingPing: null,
    parkingCaliber: '扣車位單價',
    floor: '',
    age: null,
    source: '內政部實價登錄',
    comparabilityNotes: '',
  });
  const [showAddCompetingForm, setShowAddCompetingForm] = useState(false);
  const [newCompeting, setNewCompeting] = useState<Partial<CompetingListing>>({
    title: '',
    communityName: '',
    askingPrice: 0,
    totalPing: 0,
    parkingCaliber: '含車位單價',
    layout: '',
    floor: '',
    source: '公開售屋平台',
    comparativeAdvantage: '',
  });

  // Generation state with AbortController + RequestId idempotency
  const [isGenerating, setIsGenerating] = useState(false);
  const [genElapsedSec, setGenElapsedSec] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const genAbortRef = useRef<AbortController | null>(null);
  const genTokenRef = useRef(0);

  useEffect(() => {
    if (!isGenerating) {
      setGenElapsedSec(0);
      return;
    }
    const timer = setInterval(() => setGenElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);

  // Reset and load property-scoped records whenever property.id changes
  useEffect(() => {
    propAbortRef.current?.abort();
    const controller = new AbortController();
    propAbortRef.current = controller;
    const token = ++propLoadTokenRef.current;

    // Immediately clear previous property state so cross-property bleed is impossible
    const defStart = getDefaultPeriodStart();
    const defEnd = getTodayDateString();
    setOwnerProgress(createEmptyProgress(property.id, defStart, defEnd));
    setSavedProgressList([]);
    setProgressStatusMsg(null);
    setProgressError(null);

    setSavedBuyers([]);
    setBuyerInput(createEmptyBuyer(property.id));
    setHasBuyerRequirements(false);
    setBuyerStatusMsg(null);
    setBuyerError(null);

    setComparables([]);
    setCompetingListings([]);
    setGenError(null);
    setActiveRequestId(null);

    const loadPropertyScopedData = async () => {
      setIsLoadingProgress(true);
      try {
        const [progRes, buyersRes, marketRes] = await Promise.all([
          fetch(`/api/properties/${encodeURIComponent(property.id)}/progress`, {
            signal: controller.signal,
          }),
          fetch(`/api/properties/${encodeURIComponent(property.id)}/buyers`, {
            signal: controller.signal,
          }),
          fetch(`/api/properties/${encodeURIComponent(property.id)}/market-data`, {
            signal: controller.signal,
          }),
        ]);

        if (token !== propLoadTokenRef.current) return;

        if (progRes.ok) {
          const progData = await progRes.json();
          if (token !== propLoadTokenRef.current) return;
          const list: OwnerProgressData[] = Array.isArray(progData.records) ? progData.records : [];
          setSavedProgressList(list);
          if (list.length > 0) {
            setOwnerProgress(list[0]);
          }
        }

        if (buyersRes.ok) {
          const bData = await buyersRes.json();
          if (token !== propLoadTokenRef.current) return;
          const bList: BuyerRequirements[] = Array.isArray(bData.buyers) ? bData.buyers : [];
          setSavedBuyers(bList);
        }

        if (marketRes.ok) {
          const mData = await marketRes.json();
          if (token !== propLoadTokenRef.current) return;
          setComparables(Array.isArray(mData.comparables) ? mData.comparables : []);
          setCompetingListings(
            Array.isArray(mData.competingListings) ? mData.competingListings : []
          );
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Property scoped load error:', err);
        }
      } finally {
        if (token === propLoadTokenRef.current) {
          setIsLoadingProgress(false);
        }
      }
    };

    loadPropertyScopedData();

    return () => {
      controller.abort();
    };
  }, [property.id]);

  // Fetch specific period progress when periodStart/periodEnd changes
  const handlePeriodChange = async (nextStart: string, nextEnd: string) => {
    setProgressStatusMsg(null);
    if (nextStart && nextEnd && nextStart > nextEnd) {
      setProgressError('回報截止日不可早於回報起始日');
      setOwnerProgress((prev) => ({ ...prev, periodStart: nextStart, periodEnd: nextEnd }));
      return;
    }
    setProgressError(null);
    setOwnerProgress((prev) => ({ ...prev, periodStart: nextStart, periodEnd: nextEnd }));

    if (!nextStart || !nextEnd) return;

    const reqToken = ++progressFetchTokenRef.current;
    try {
      const res = await fetch(
        `/api/properties/${encodeURIComponent(property.id)}/progress?periodStart=${encodeURIComponent(
          nextStart
        )}&periodEnd=${encodeURIComponent(nextEnd)}`
      );
      if (reqToken !== progressFetchTokenRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (reqToken !== progressFetchTokenRef.current) return;
        if (data.record) {
          setOwnerProgress(data.record);
        }
      }
    } catch {
      // keep user edits safely
    }
  };

  // Save owner progress for current (property.id, periodStart, periodEnd)
  const handleSaveProgress = async (): Promise<boolean> => {
    setProgressStatusMsg(null);
    if (!ownerProgress.periodStart || !ownerProgress.periodEnd) {
      setProgressError('請先選擇回報起始日與截止日');
      return false;
    }
    if (ownerProgress.periodStart > ownerProgress.periodEnd) {
      setProgressError('回報截止日不可早於回報起始日');
      return false;
    }
    setProgressError(null);

    try {
      const res = await fetch(`/api/properties/${encodeURIComponent(property.id)}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ownerProgress,
          propertyId: property.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProgressError(data.error || '儲存銷售進度失敗');
        return false;
      }
      const saved: OwnerProgressData = data.record;
      setOwnerProgress(saved);
      setSavedProgressList((prev) => {
        const filtered = prev.filter(
          (p) => !(p.periodStart === saved.periodStart && p.periodEnd === saved.periodEnd)
        );
        return [saved, ...filtered];
      });
      setProgressStatusMsg(
        `已儲存「${saved.periodStart} ~ ${saved.periodEnd}」進度紀錄（僅屬本物件）`
      );
      return true;
    } catch {
      setProgressError('儲存銷售進度時發生連線異常');
      return false;
    }
  };

  // Explicit Demo Progress Loader
  const handleLoadDemoProgress = () => {
    setProgressError(null);
    setOwnerProgress({
      ...DEMO_OWNER_PROGRESS,
      propertyId: property.id,
      isDemo: true,
    });
    setProgressStatusMsg('已載入示範銷售進度範例（生成報告將標示「示範資料」）');
  };

  // Feedback CRUD handlers
  const handleAddFeedback = () => {
    if (!newFbContent.trim()) return;
    const item: AnonymousFeedback = {
      id: `fb-${Date.now()}`,
      date: newFbDate || getTodayDateString(),
      focus: newFbFocus,
      content: newFbContent.trim(),
    };
    setOwnerProgress((prev) => ({
      ...prev,
      isDemo: false,
      anonymousFeedback: [...prev.anonymousFeedback, item],
    }));
    setNewFbContent('');
  };

  const handleSaveEditFeedback = (id: string) => {
    if (!editingFbText.trim()) return;
    setOwnerProgress((prev) => ({
      ...prev,
      anonymousFeedback: prev.anonymousFeedback.map((fb) =>
        fb.id === id ? { ...fb, content: editingFbText.trim() } : fb
      ),
    }));
    setEditingFbId(null);
    setEditingFbText('');
  };

  const handleDeleteFeedback = (id: string) => {
    setOwnerProgress((prev) => ({
      ...prev,
      anonymousFeedback: prev.anonymousFeedback.filter((fb) => fb.id !== id),
    }));
  };

  // Completed & Next Actions CRUD handlers
  const handleAddCompletedAction = () => {
    if (!newCompletedAction.trim()) return;
    setOwnerProgress((prev) => ({
      ...prev,
      isDemo: false,
      completedActions: [...prev.completedActions, newCompletedAction.trim()],
    }));
    setNewCompletedAction('');
  };

  const handleSaveCompletedAction = (idx: number) => {
    if (!editingCompletedText.trim()) return;
    setOwnerProgress((prev) => ({
      ...prev,
      completedActions: prev.completedActions.map((a, i) =>
        i === idx ? editingCompletedText.trim() : a
      ),
    }));
    setEditingCompletedIdx(null);
    setEditingCompletedText('');
  };

  const handleRemoveCompletedAction = (idx: number) => {
    setOwnerProgress((prev) => ({
      ...prev,
      completedActions: prev.completedActions.filter((_, i) => i !== idx),
    }));
  };

  const handleAddNextAction = () => {
    if (!newNextAction.trim()) return;
    setOwnerProgress((prev) => ({
      ...prev,
      isDemo: false,
      nextPlannedActions: [...prev.nextPlannedActions, newNextAction.trim()],
    }));
    setNewNextAction('');
  };

  const handleSaveNextAction = (idx: number) => {
    if (!editingNextText.trim()) return;
    setOwnerProgress((prev) => ({
      ...prev,
      nextPlannedActions: prev.nextPlannedActions.map((a, i) =>
        i === idx ? editingNextText.trim() : a
      ),
    }));
    setEditingNextIdx(null);
    setEditingNextText('');
  };

  const handleRemoveNextAction = (idx: number) => {
    setOwnerProgress((prev) => ({
      ...prev,
      nextPlannedActions: prev.nextPlannedActions.filter((_, i) => i !== idx),
    }));
  };

  // Save buyer profile scoped to property.id
  const handleSaveBuyerProfile = async (): Promise<boolean> => {
    setBuyerStatusMsg(null);
    setBuyerError(null);

    if (
      buyerInput.budgetMin !== null &&
      buyerInput.budgetMax !== null &&
      buyerInput.budgetMin > buyerInput.budgetMax
    ) {
      setBuyerError('預算下限不可高於預算上限');
      return false;
    }

    try {
      const targetBuyerId = buyerInput.buyerId || `buyer-${Date.now()}`;
      const res = await fetch(
        `/api/properties/${encodeURIComponent(property.id)}/buyers/${encodeURIComponent(targetBuyerId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...buyerInput,
            buyerId: targetBuyerId,
            propertyId: property.id,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setBuyerError(data.error || '儲存買方需求失敗');
        return false;
      }
      const saved: BuyerRequirements = data.buyer;
      setBuyerInput(saved);
      setSavedBuyers((prev) => {
        const filtered = prev.filter((b) => b.buyerId !== saved.buyerId);
        return [saved, ...filtered];
      });
      setBuyerStatusMsg(
        `已儲存買方「${saved.buyerNickname || saved.buyerId}」需求條件（獨立編號保存）`
      );
      return true;
    } catch {
      setBuyerError('儲存買方需求時發生連線異常');
      return false;
    }
  };

  const handleCreateNewBuyer = () => {
    setBuyerError(null);
    setBuyerStatusMsg(null);
    setBuyerInput(createEmptyBuyer(property.id));
    setHasBuyerRequirements(true);
  };

  const handleDeleteBuyer = async (buyerId: string) => {
    try {
      await fetch(
        `/api/properties/${encodeURIComponent(property.id)}/buyers/${encodeURIComponent(buyerId)}`,
        { method: 'DELETE' }
      );
      setSavedBuyers((prev) => prev.filter((b) => b.buyerId !== buyerId));
      if (buyerInput.buyerId === buyerId) {
        setBuyerInput(createEmptyBuyer(property.id));
      }
    } catch {
      // ignore
    }
  };

  const applyBuyerTemplate = (template: BuyerRequirements) => {
    setBuyerError(null);
    setBuyerInput({
      ...template,
      propertyId: property.id,
      buyerId: `buyer-demo-${Date.now()}`,
      isDemo: true,
    });
    setHasBuyerRequirements(true);
    setBuyerStatusMsg('已載入示範買方需求範本（生成報告將標示「示範資料」）');
  };

  // Persist Comparables & Competing Listings to DB
  const persistComparables = async (nextList: ComparableSale[]) => {
    setComparables(nextList);
    try {
      await fetch(`/api/properties/${encodeURIComponent(property.id)}/comparables`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: nextList }),
      });
    } catch {
      // non-fatal
    }
  };

  const persistCompetingListings = async (nextList: CompetingListing[]) => {
    setCompetingListings(nextList);
    try {
      await fetch(`/api/properties/${encodeURIComponent(property.id)}/competing-listings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: nextList }),
      });
    } catch {
      // non-fatal
    }
  };

  const handleAddComparable = () => {
    if (!newComp.communityName?.trim() || !newComp.totalPrice || !newComp.totalPing) return;
    const tp = Number(newComp.totalPrice);
    const tping = Number(newComp.totalPing);
    const pp = newComp.parkingPrice ? Number(newComp.parkingPrice) : null;
    const pping = newComp.parkingPing ? Number(newComp.parkingPing) : null;
    let unitPrice = Number((tp / tping).toFixed(2));
    let caliber: ComparableSale['parkingCaliber'] = newComp.parkingCaliber || '含車位單價';

    if (
      caliber === '扣車位單價' &&
      pp !== null &&
      pp > 0 &&
      pping !== null &&
      pping > 0 &&
      tping - pping > 0
    ) {
      unitPrice = Number(((tp - pp) / (tping - pping)).toFixed(2));
    } else if (caliber === '扣車位單價') {
      caliber = '含車位單價';
    }

    const item: ComparableSale = {
      id: `comp-${Date.now()}`,
      propertyId: property.id,
      communityName: newComp.communityName.trim(),
      dealDate: newComp.dealDate?.trim() || '待確認',
      totalPrice: tp,
      totalPing: tping,
      parkingPrice: pp,
      parkingPing: pping,
      unitPrice,
      parkingCaliber: caliber,
      floor: newComp.floor?.trim() || '待確認',
      age: newComp.age ?? null,
      comparabilityNotes: newComp.comparabilityNotes?.trim() || '經紀人手動登錄可比案例',
      source: newComp.source?.trim() || '內政部實價登錄',
      isDemo: false,
    };
    persistComparables([...comparables, item]);
    setShowAddCompForm(false);
    setNewComp({
      communityName: '',
      dealDate: '',
      totalPrice: 0,
      totalPing: 0,
      parkingPrice: null,
      parkingPing: null,
      parkingCaliber: '扣車位單價',
      floor: '',
      age: null,
      source: '內政部實價登錄',
      comparabilityNotes: '',
    });
  };

  const handleAddCompeting = () => {
    if (!newCompeting.title?.trim() || !newCompeting.askingPrice || !newCompeting.totalPing) return;
    const ap = Number(newCompeting.askingPrice);
    const tp = Number(newCompeting.totalPing);
    const item: CompetingListing = {
      id: `compete-${Date.now()}`,
      propertyId: property.id,
      title: newCompeting.title.trim(),
      communityName: newCompeting.communityName?.trim() || '',
      askingPrice: ap,
      totalPing: tp,
      unitPrice: Number((ap / tp).toFixed(2)),
      parkingCaliber: newCompeting.parkingCaliber?.trim() || '含車位單價',
      layout: newCompeting.layout?.trim() || '待確認',
      floor: newCompeting.floor?.trim() || '待確認',
      source: newCompeting.source?.trim() || '公開售屋平台',
      comparativeAdvantage: newCompeting.comparativeAdvantage?.trim() || '',
      isDemo: false,
    };
    persistCompetingListings([...competingListings, item]);
    setShowAddCompetingForm(false);
    setNewCompeting({
      title: '',
      communityName: '',
      askingPrice: 0,
      totalPing: 0,
      parkingCaliber: '含車位單價',
      layout: '',
      floor: '',
      source: '公開售屋平台',
      comparativeAdvantage: '',
    });
  };

  // Generate Report with idempotency requestId & AbortController cancel/retry
  const handleGenerateReport = async (reuseExistingRequestId = false) => {
    if (isGenerating) return;

    // Validate progress dates & persist before generating if owner progress
    if (reportType === 'owner' && ownerSubType === 'progress') {
      if (ownerProgress.periodStart > ownerProgress.periodEnd) {
        setGenError('回報截止日不可早於回報起始日，請修正日期後再生成報告。');
        return;
      }
      await handleSaveProgress();
    }

    if (reportType === 'buyer' && hasBuyerRequirements) {
      if (
        buyerInput.budgetMin !== null &&
        buyerInput.budgetMax !== null &&
        buyerInput.budgetMin > buyerInput.budgetMax
      ) {
        setGenError('買方預算下限不可高於預算上限，請修正後再生成。');
        return;
      }
      await handleSaveBuyerProfile();
    }

    genAbortRef.current?.abort();
    const controller = new AbortController();
    genAbortRef.current = controller;
    const token = ++genTokenRef.current;

    const reqId =
      reuseExistingRequestId && activeRequestId
        ? activeRequestId
        : `req-${property.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setActiveRequestId(reqId);
    setIsGenerating(true);
    setGenError(null);

    try {
      const payload = {
        requestId: reqId,
        saveDraft: true,
        property,
        reportType,
        subType: ownerSubType,
        ownerProgressInput:
          reportType === 'owner' && ownerSubType === 'progress' ? ownerProgress : undefined,
        buyerInput: reportType === 'buyer' && hasBuyerRequirements ? buyerInput : undefined,
        comparables,
        competingListings,
      };

      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await res.json();
      if (token !== genTokenRef.current) return;

      if (!res.ok || data.error || !data.report) {
        throw new Error(data.error || '生成報告書失敗，請重試。');
      }

      const generatedReport: ReportDocument = {
        ...data.report,
        sections: (data.report.sections || []).map((sec: any) => ({
          ...sec,
          isEditedManually: false,
          originalAiContent: sec.contentMarkdown,
        })),
      };

      setActiveRequestId(null);
      onReportCreated(generatedReport);
    } catch (err: any) {
      if (token !== genTokenRef.current) return;
      if (err?.name === 'AbortError') {
        setGenError('已取消生成報告，您輸入的所有條件與進度紀錄皆已安全保留。');
      } else {
        setGenError(err.message || 'AI 生成報告書失敗，您的輸入內容已保留，可點選重試。');
      }
    } finally {
      if (token === genTokenRef.current) {
        setIsGenerating(false);
      }
    }
  };

  const handleCancelGenerate = () => {
    genTokenRef.current += 1;
    genAbortRef.current?.abort();
    setIsGenerating(false);
    setGenError('已手動停止報告生成，您的表單輸入與紀錄已保留。');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
      {/* Target Property Summary Header */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-blue-700 bg-blue-100/60 px-2.5 py-0.5 rounded-md">
              目前標的物件（獨立資料空間）
            </span>
            {property.isDemo && (
              <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                示範物件
              </span>
            )}
          </div>
          <h3 className="text-base font-extrabold text-slate-900 mt-1">
            {property.caseName} ({property.caseId})
          </h3>
          <p className="text-xs text-slate-500">
            {property.cityDistrict || '縣市待確認'} {property.address} ｜ 開價 {formatWan(property.askingPrice)} ｜ 權狀 {formatPing(property.totalArea)} ｜ {formatLayout(property.layout)}
          </p>
        </div>

        <div className="text-xs text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
          底價與經紀人私密備註：<strong className="text-emerald-700">已自動隔離</strong>
        </div>
      </div>

      {/* Step 1: Select Report Purpose / Version */}
      <div className="space-y-3">
        <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-500">
          步驟一：選擇報告類型與對象
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            onClick={() => setReportType('owner')}
            className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
              reportType === 'owner'
                ? 'border-blue-700 bg-blue-50/30 shadow-xs'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-center space-x-2 text-blue-700 font-bold text-sm mb-1">
              <UserCheck className="w-4 h-4" />
              <span>屋主版：房屋銷售評估報告</span>
            </div>
            <p className="text-xs text-slate-600">
              依當前物件 ID 與回報期間獨立管理實價案例、在售競品或銷售帶看進度，絕不跨案帶入他案數據。
            </p>
          </div>

          <div
            onClick={() => setReportType('buyer')}
            className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
              reportType === 'buyer'
                ? 'border-blue-700 bg-blue-50/30 shadow-xs'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-center space-x-2 text-purple-700 font-bold text-sm mb-1">
              <User className="w-4 h-4" />
              <span>買方版：購屋評估報告</span>
            </div>
            <p className="text-xs text-slate-600">
              一般評估預設為空白條件，可依單一買方識別碼獨立儲存／切換需求，範本僅在手動點擊時載入。
            </p>
          </div>
        </div>
      </div>

      {/* Step 2: Owner vs Buyer Inputs */}
      {reportType === 'owner' ? (
        <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-200 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-800 text-sm">屋主版用途選擇</span>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => setOwnerSubType('pre_listing')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  ownerSubType === 'pre_listing'
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                1. 委託前評估 (定價策略與客群)
              </button>
              <button
                type="button"
                onClick={() => setOwnerSubType('progress')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  ownerSubType === 'progress'
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                2. 銷售進度回報 (帶看與反饋)
              </button>
            </div>
          </div>

          {/* Subtype A: Pre-Listing valuation */}
          {ownerSubType === 'pre_listing' && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Comparables Panel */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>可比成交案例 (實價登錄) ({comparables.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowAddCompForm((v) => !v)}
                      className="px-2.5 py-1 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-[11px] font-semibold flex items-center space-x-1"
                    >
                      <Plus className="w-3 h-3" />
                      <span>手動新增實價案例</span>
                    </button>
                  </div>

                  {showAddCompForm && (
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-[11px]">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="社區/建案名稱 *"
                          value={newComp.communityName || ''}
                          onChange={(e) => setNewComp({ ...newComp, communityName: e.target.value })}
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="text"
                          placeholder="交易年月 (如 114/09)"
                          value={newComp.dealDate || ''}
                          onChange={(e) => setNewComp({ ...newComp, dealDate: e.target.value })}
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="number"
                          placeholder="成交總價(萬) *"
                          value={newComp.totalPrice || ''}
                          onChange={(e) => setNewComp({ ...newComp, totalPrice: Number(e.target.value) })}
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="總坪數(坪) *"
                          value={newComp.totalPing || ''}
                          onChange={(e) => setNewComp({ ...newComp, totalPing: Number(e.target.value) })}
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="number"
                          placeholder="車位價(萬，選填)"
                          value={newComp.parkingPrice ?? ''}
                          onChange={(e) =>
                            setNewComp({
                              ...newComp,
                              parkingPrice: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="車位坪(坪，選填)"
                          value={newComp.parkingPing ?? ''}
                          onChange={(e) =>
                            setNewComp({
                              ...newComp,
                              parkingPing: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={newComp.parkingCaliber}
                          onChange={(e) =>
                            setNewComp({ ...newComp, parkingCaliber: e.target.value as any })
                          }
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        >
                          <option value="扣車位單價">扣車位單價</option>
                          <option value="含車位單價">含車位單價</option>
                          <option value="無車位">無車位</option>
                        </select>
                        <input
                          type="text"
                          placeholder="來源 (如 內政部實價登錄)"
                          value={newComp.source || ''}
                          onChange={(e) => setNewComp({ ...newComp, source: e.target.value })}
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="可比性與差異說明"
                        value={newComp.comparabilityNotes || ''}
                        onChange={(e) =>
                          setNewComp({ ...newComp, comparabilityNotes: e.target.value })
                        }
                        className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                      />
                      <div className="flex justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => setShowAddCompForm(false)}
                          className="px-2.5 py-1 border border-slate-300 rounded text-slate-600"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={handleAddComparable}
                          className="px-3 py-1 bg-blue-700 text-white rounded font-bold"
                        >
                          加入成交案例
                        </button>
                      </div>
                    </div>
                  )}

                  {comparables.length > 0 ? (
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {comparables.map((c) => (
                        <div
                          key={c.id}
                          className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-[11px] flex items-start justify-between gap-2"
                        >
                          <div>
                            <div className="font-semibold text-slate-800 flex items-center space-x-1.5">
                              <span>{c.communityName} ({c.dealDate})</span>
                              {c.isDemo && (
                                <span className="px-1 py-0.2 bg-amber-100 text-amber-800 rounded text-[9px] font-bold">
                                  示範資料
                                </span>
                              )}
                            </div>
                            <div className="text-slate-500">
                              總價 {c.totalPrice} 萬 ｜ {c.totalPing} 坪 ｜ {c.parkingCaliber} {c.unitPrice} 萬/坪
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => persistComparables(comparables.filter((x) => x.id !== c.id))}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px]">
                      目前無可比成交案例。報告書將嚴格標示「待補可比成交案例」及應補充查詢指標，絕不憑空推估行情或議價空間。
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        persistComparables(
                          DEMO_COMPARABLES_ZB.map((d) => ({ ...d, propertyId: property.id, isDemo: true }))
                        )
                      }
                      className="px-2.5 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium"
                    >
                      載入竹北示範實價 (示範資料)
                    </button>
                    {comparables.length > 0 && (
                      <button
                        type="button"
                        onClick={() => persistComparables([])}
                        className="px-2.5 py-1 text-[11px] text-rose-600 hover:bg-rose-50 rounded"
                      >
                        清空成交案例
                      </button>
                    )}
                  </div>
                </div>

                {/* Competing Listings Panel */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>在售競品參考 ({competingListings.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowAddCompetingForm((v) => !v)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-black text-white rounded-lg text-[11px] font-semibold flex items-center space-x-1"
                    >
                      <Plus className="w-3 h-3" />
                      <span>手動新增在售競品</span>
                    </button>
                  </div>

                  {showAddCompetingForm && (
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-[11px]">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="競品標題/案名 *"
                          value={newCompeting.title || ''}
                          onChange={(e) => setNewCompeting({ ...newCompeting, title: e.target.value })}
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="text"
                          placeholder="社區名稱"
                          value={newCompeting.communityName || ''}
                          onChange={(e) =>
                            setNewCompeting({ ...newCompeting, communityName: e.target.value })
                          }
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="number"
                          placeholder="開價(萬) *"
                          value={newCompeting.askingPrice || ''}
                          onChange={(e) =>
                            setNewCompeting({ ...newCompeting, askingPrice: Number(e.target.value) })
                          }
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="總坪數(坪) *"
                          value={newCompeting.totalPing || ''}
                          onChange={(e) =>
                            setNewCompeting({ ...newCompeting, totalPing: Number(e.target.value) })
                          }
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="text"
                          placeholder="格局 / 樓層 (如 3房 8/14F)"
                          value={newCompeting.layout || ''}
                          onChange={(e) => setNewCompeting({ ...newCompeting, layout: e.target.value })}
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                        <input
                          type="text"
                          placeholder="單價口徑 (如 含車位)"
                          value={newCompeting.parkingCaliber || ''}
                          onChange={(e) =>
                            setNewCompeting({ ...newCompeting, parkingCaliber: e.target.value })
                          }
                          className="px-2 py-1.5 border border-slate-300 rounded bg-white"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="本案相對優勢或差異分析"
                        value={newCompeting.comparativeAdvantage || ''}
                        onChange={(e) =>
                          setNewCompeting({ ...newCompeting, comparativeAdvantage: e.target.value })
                        }
                        className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white"
                      />
                      <div className="flex justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => setShowAddCompetingForm(false)}
                          className="px-2.5 py-1 border border-slate-300 rounded text-slate-600"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={handleAddCompeting}
                          className="px-3 py-1 bg-slate-800 text-white rounded font-bold"
                        >
                          加入在售競品
                        </button>
                      </div>
                    </div>
                  )}

                  {competingListings.length > 0 ? (
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {competingListings.map((cl) => (
                        <div
                          key={cl.id}
                          className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-[11px] flex items-start justify-between gap-2"
                        >
                          <div>
                            <div className="font-semibold text-slate-800 flex items-center space-x-1.5">
                              <span>{cl.title}</span>
                              {cl.isDemo && (
                                <span className="px-1 py-0.2 bg-amber-100 text-amber-800 rounded text-[9px] font-bold">
                                  示範資料
                                </span>
                              )}
                            </div>
                            <div className="text-slate-500">
                              開價 {cl.askingPrice} 萬 ｜ {cl.totalPing} 坪 ｜ {cl.parkingCaliber}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              persistCompetingListings(
                                competingListings.filter((x) => x.id !== cl.id)
                              )
                            }
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-[11px]">
                      目前無本案登錄之在售競品。
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        persistCompetingListings(
                          DEMO_COMPETING_ZB.map((d) => ({
                            ...d,
                            propertyId: property.id,
                            isDemo: true,
                          }))
                        )
                      }
                      className="px-2.5 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium"
                    >
                      載入在售競品範例 (示範資料)
                    </button>
                    {competingListings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => persistCompetingListings([])}
                        className="px-2.5 py-1 text-[11px] text-rose-600 hover:bg-rose-50 rounded"
                      >
                        清空在售競品
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Subtype B: Sales Progress Report (Strictly scoped to property.id + periodStart/End) */}
          {ownerSubType === 'progress' && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3.5 py-2.5 rounded-xl border border-slate-200">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-slate-800">
                    本物件銷售進度紀錄（案件：{property.caseName}）
                  </span>
                  {ownerProgress.isDemo && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">
                      示範資料
                    </span>
                  )}
                  {isLoadingProgress && <span className="text-slate-400">載入中...</span>}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {savedProgressList.length > 0 && (
                    <select
                      value={`${ownerProgress.periodStart}__${ownerProgress.periodEnd}`}
                      onChange={(e) => {
                        const [s, en] = e.target.value.split('__');
                        if (s && en) handlePeriodChange(s, en);
                      }}
                      className="px-2 py-1 border border-slate-300 rounded text-[11px] bg-slate-50"
                    >
                      <option value="__">切換已儲存期間 ({savedProgressList.length})</option>
                      {savedProgressList.map((rec) => (
                        <option
                          key={`${rec.periodStart}-${rec.periodEnd}`}
                          value={`${rec.periodStart}__${rec.periodEnd}`}
                        >
                          {rec.periodStart} ~ {rec.periodEnd} {rec.isDemo ? '(示範)' : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={handleLoadDemoProgress}
                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-lg text-[11px] font-semibold"
                  >
                    載入示範進度範例
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setOwnerProgress(
                        createEmptyProgress(
                          property.id,
                          ownerProgress.periodStart,
                          ownerProgress.periodEnd
                        )
                      )
                    }
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px]"
                  >
                    清空重置
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveProgress}
                    className="px-3 py-1 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-[11px] font-bold flex items-center space-x-1"
                  >
                    <Save className="w-3 h-3" />
                    <span>儲存本期紀錄</span>
                  </button>
                </div>
              </div>

              {progressError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-semibold">
                  {progressError}
                </div>
              )}
              {progressStatusMsg && !progressError && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold">
                  {progressStatusMsg}
                </div>
              )}

              {/* Metrics & Dates Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">回報起始日</label>
                  <input
                    type="date"
                    value={ownerProgress.periodStart}
                    onChange={(e) => handlePeriodChange(e.target.value, ownerProgress.periodEnd)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">回報截止日</label>
                  <input
                    type="date"
                    value={ownerProgress.periodEnd}
                    onChange={(e) => handlePeriodChange(ownerProgress.periodStart, e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    網路曝光數
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={ownerProgress.onlineImpressions ?? ''}
                    onChange={(e) =>
                      setOwnerProgress((prev) => ({
                        ...prev,
                        isDemo: false,
                        onlineImpressions: e.target.value === '' ? null : parseInt(e.target.value, 10),
                      }))
                    }
                    placeholder="尚無紀錄"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
                  />
                  <span className="text-[10px] text-slate-400">
                    {ownerProgress.onlineImpressions === null ? '顯示：尚無紀錄' : `目前值：${ownerProgress.onlineImpressions}`}
                  </span>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    詢問數 (來電/線上)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={ownerProgress.inquiryCount ?? ''}
                    onChange={(e) =>
                      setOwnerProgress((prev) => ({
                        ...prev,
                        isDemo: false,
                        inquiryCount: e.target.value === '' ? null : parseInt(e.target.value, 10),
                      }))
                    }
                    placeholder="尚無紀錄"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
                  />
                  <span className="text-[10px] text-slate-400">
                    {ownerProgress.inquiryCount === null ? '顯示：尚無紀錄' : `目前值：${ownerProgress.inquiryCount}`}
                  </span>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    實地帶看組數
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={ownerProgress.showingCount ?? ''}
                    onChange={(e) =>
                      setOwnerProgress((prev) => ({
                        ...prev,
                        isDemo: false,
                        showingCount: e.target.value === '' ? null : parseInt(e.target.value, 10),
                      }))
                    }
                    placeholder="尚無紀錄"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
                  />
                  <span className="text-[10px] text-slate-400">
                    {ownerProgress.showingCount === null
                      ? '顯示：尚無紀錄'
                      : ownerProgress.showingCount === 0
                      ? '目前值：0 (確認為零)'
                      : `目前值：${ownerProgress.showingCount}`}
                  </span>
                </div>
              </div>

              {/* Anonymous buyer feedback CRUD */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                <div className="font-bold text-slate-800">
                  買方市場匿名回饋 ({ownerProgress.anonymousFeedback.length} 則)
                </div>

                {ownerProgress.anonymousFeedback.length > 0 ? (
                  <div className="space-y-1.5">
                    {ownerProgress.anonymousFeedback.map((fb) => (
                      <div
                        key={fb.id}
                        className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-[11px] flex items-center justify-between gap-2"
                      >
                        {editingFbId === fb.id ? (
                          <div className="flex-1 flex items-center space-x-2">
                            <input
                              type="text"
                              value={editingFbText}
                              onChange={(e) => setEditingFbText(e.target.value)}
                              className="flex-1 px-2 py-1 border border-blue-400 rounded bg-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveEditFeedback(fb.id)}
                              className="px-2 py-1 bg-blue-700 text-white rounded font-semibold"
                            >
                              儲存
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingFbId(null)}
                              className="px-2 py-1 text-slate-500"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="space-x-2 flex-1">
                              <span className="font-mono text-slate-400">{fb.date}</span>
                              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                                {fb.focus}
                              </span>
                              <span className="text-slate-700">{fb.content}</span>
                            </div>
                            <div className="flex items-center space-x-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingFbId(fb.id);
                                  setEditingFbText(fb.content);
                                }}
                                className="p-1 text-slate-400 hover:text-blue-700"
                                title="編輯回饋"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteFeedback(fb.id)}
                                className="p-1 text-slate-400 hover:text-rose-600"
                                title="刪除回饋"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-400 text-[11px] py-1">尚無匿名回饋紀錄</div>
                )}

                <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                  <input
                    type="date"
                    value={newFbDate}
                    onChange={(e) => setNewFbDate(e.target.value)}
                    className="px-2 py-1 border border-slate-300 rounded text-[11px]"
                  />
                  <select
                    value={newFbFocus}
                    onChange={(e) => setNewFbFocus(e.target.value as any)}
                    className="px-2 py-1 border border-slate-300 rounded text-[11px] bg-white"
                  >
                    <option value="價格">價格</option>
                    <option value="採光動線">採光動線</option>
                    <option value="車位">車位</option>
                    <option value="屋況">屋況</option>
                    <option value="其他">其他</option>
                  </select>
                  <input
                    type="text"
                    value={newFbContent}
                    onChange={(e) => setNewFbContent(e.target.value)}
                    placeholder="輸入匿名看屋回饋內容..."
                    className="flex-1 min-w-[180px] px-2.5 py-1 border border-slate-300 rounded text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={handleAddFeedback}
                    disabled={!newFbContent.trim()}
                    className="px-3 py-1 bg-slate-800 hover:bg-black text-white rounded text-[11px] font-semibold disabled:opacity-50"
                  >
                    + 新增回饋
                  </button>
                </div>
              </div>

              {/* Completed & Next Planned Actions CRUD */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-800">
                    本期已執行行銷行動 ({ownerProgress.completedActions.length})
                  </div>
                  {ownerProgress.completedActions.length > 0 ? (
                    <div className="space-y-1">
                      {ownerProgress.completedActions.map((act, idx) => (
                        <div
                          key={idx}
                          className="p-2 bg-slate-50 rounded border border-slate-200 text-[11px] flex items-center justify-between gap-2"
                        >
                          {editingCompletedIdx === idx ? (
                            <div className="flex-1 flex space-x-1">
                              <input
                                type="text"
                                value={editingCompletedText}
                                onChange={(e) => setEditingCompletedText(e.target.value)}
                                className="flex-1 px-2 py-0.5 border border-blue-400 rounded bg-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveCompletedAction(idx)}
                                className="px-2 py-0.5 bg-blue-700 text-white rounded"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-slate-700 flex-1">{act}</span>
                              <div className="flex space-x-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCompletedIdx(idx);
                                    setEditingCompletedText(act);
                                  }}
                                  className="text-slate-400 hover:text-blue-700"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCompletedAction(idx)}
                                  className="text-slate-400 hover:text-rose-600"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-400 text-[11px]">尚無已執行行動紀錄</div>
                  )}
                  <div className="flex space-x-1.5 pt-1">
                    <input
                      type="text"
                      value={newCompletedAction}
                      onChange={(e) => setNewCompletedAction(e.target.value)}
                      placeholder="新增已執行行銷動作..."
                      className="flex-1 px-2 py-1 border border-slate-300 rounded text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={handleAddCompletedAction}
                      disabled={!newCompletedAction.trim()}
                      className="px-2.5 py-1 bg-slate-800 text-white rounded text-[11px] font-semibold disabled:opacity-50"
                    >
                      新增
                    </button>
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2">
                  <div className="font-bold text-slate-800">
                    下期預計推進計畫 ({ownerProgress.nextPlannedActions.length})
                  </div>
                  {ownerProgress.nextPlannedActions.length > 0 ? (
                    <div className="space-y-1">
                      {ownerProgress.nextPlannedActions.map((act, idx) => (
                        <div
                          key={idx}
                          className="p-2 bg-slate-50 rounded border border-slate-200 text-[11px] flex items-center justify-between gap-2"
                        >
                          {editingNextIdx === idx ? (
                            <div className="flex-1 flex space-x-1">
                              <input
                                type="text"
                                value={editingNextText}
                                onChange={(e) => setEditingNextText(e.target.value)}
                                className="flex-1 px-2 py-0.5 border border-blue-400 rounded bg-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveNextAction(idx)}
                                className="px-2 py-0.5 bg-blue-700 text-white rounded"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-slate-700 flex-1">{act}</span>
                              <div className="flex space-x-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingNextIdx(idx);
                                    setEditingNextText(act);
                                  }}
                                  className="text-slate-400 hover:text-blue-700"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveNextAction(idx)}
                                  className="text-slate-400 hover:text-rose-600"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-400 text-[11px]">尚無下期行動紀錄</div>
                  )}
                  <div className="flex space-x-1.5 pt-1">
                    <input
                      type="text"
                      value={newNextAction}
                      onChange={(e) => setNewNextAction(e.target.value)}
                      placeholder="新增下期推進動作..."
                      className="flex-1 px-2 py-1 border border-slate-300 rounded text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={handleAddNextAction}
                      disabled={!newNextAction.trim()}
                      className="px-2.5 py-1 bg-slate-800 text-white rounded text-[11px] font-semibold disabled:opacity-50"
                    >
                      新增
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Buyer Report Inputs (Defaults to EMPTY; strictly loaded per buyerId/propertyId) */
        <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-200 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-800 text-sm">買方客製需求設定（預設空白）</span>
            <div className="flex items-center space-x-3">
              <label className="flex items-center space-x-1.5 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={hasBuyerRequirements}
                  onChange={(e) => setHasBuyerRequirements(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span className="font-semibold">啟用特定買方條件配對</span>
              </label>
            </div>
          </div>

          {/* Saved Buyers for this Property + Demo Templates */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">本案已儲存買方 ({savedBuyers.length})：</span>
              {savedBuyers.map((b) => (
                <div
                  key={b.buyerId}
                  className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-[11px] ${
                    hasBuyerRequirements && buyerInput.buyerId === b.buyerId
                      ? 'bg-purple-700 text-white border-purple-700 font-bold'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setBuyerInput(b);
                      setHasBuyerRequirements(true);
                      setBuyerError(null);
                      setBuyerStatusMsg(null);
                    }}
                    className="mr-1.5"
                  >
                    {b.buyerNickname || b.buyerId}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteBuyer(b.buyerId)}
                    className="opacity-70 hover:opacity-100"
                    title="移除買方"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={handleCreateNewBuyer}
                className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-lg text-[11px] font-bold flex items-center space-x-1"
              >
                <Plus className="w-3 h-3" />
                <span>新建空白買方條件</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-400">示範範本：</span>
              <button
                type="button"
                onClick={() => applyBuyerTemplate(DEMO_BUYER_A)}
                className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-slate-700 text-[11px]"
              >
                範本 1：陳副理 (示範)
              </button>
              <button
                type="button"
                onClick={() => applyBuyerTemplate(DEMO_BUYER_B)}
                className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-slate-700 text-[11px]"
              >
                範本 2：王醫師 (示範)
              </button>
            </div>
          </div>

          {buyerError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg font-semibold">
              {buyerError}
            </div>
          )}
          {buyerStatusMsg && !buyerError && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg font-semibold">
              {buyerStatusMsg}
            </div>
          )}

          {hasBuyerRequirements ? (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">買方稱呼／識別代號 *</label>
                  <input
                    type="text"
                    value={buyerInput.buyerNickname}
                    onChange={(e) =>
                      setBuyerInput({ ...buyerInput, isDemo: false, buyerNickname: e.target.value })
                    }
                    placeholder="例如：竹科陳工程師"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">預算區間 (萬元)</label>
                  <div className="flex items-center space-x-1">
                    <input
                      type="number"
                      value={buyerInput.budgetMin ?? ''}
                      onChange={(e) =>
                        setBuyerInput({
                          ...buyerInput,
                          isDemo: false,
                          budgetMin: e.target.value === '' ? null : parseInt(e.target.value, 10),
                        })
                      }
                      placeholder="下限"
                      className="w-20 px-2 py-1.5 border border-slate-300 rounded text-xs text-center"
                    />
                    <span>~</span>
                    <input
                      type="number"
                      value={buyerInput.budgetMax ?? ''}
                      onChange={(e) =>
                        setBuyerInput({
                          ...buyerInput,
                          isDemo: false,
                          budgetMax: e.target.value === '' ? null : parseInt(e.target.value, 10),
                        })
                      }
                      placeholder="上限"
                      className="w-20 px-2 py-1.5 border border-slate-300 rounded text-xs text-center"
                    />
                    <span className="text-slate-500">萬</span>
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-rose-800 mb-1">
                    買方私密聯絡 (絕不對外匯出)
                  </label>
                  <input
                    type="text"
                    value={buyerInput.buyerContact || ''}
                    onChange={(e) =>
                      setBuyerInput({ ...buyerInput, isDemo: false, buyerContact: e.target.value })
                    }
                    placeholder="內部聯絡電話/LINE"
                    className="w-full px-2.5 py-1.5 border border-rose-200 rounded text-xs bg-rose-50/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <label className="block font-bold text-emerald-800 mb-1">
                    必要條件 (Must-haves，優先核對)
                  </label>
                  <textarea
                    rows={3}
                    value={buyerInput.mustHaves.join('\n')}
                    onChange={(e) =>
                      setBuyerInput({
                        ...buyerInput,
                        isDemo: false,
                        mustHaves: e.target.value.split('\n').filter((l) => l.trim() !== ''),
                      })
                    }
                    placeholder="空白未填，每行一項條件..."
                    className="w-full p-2 border border-slate-200 rounded text-xs"
                  />
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <label className="block font-bold text-blue-800 mb-1">
                    偏好條件 (Preferences)
                  </label>
                  <textarea
                    rows={3}
                    value={buyerInput.preferences.join('\n')}
                    onChange={(e) =>
                      setBuyerInput({
                        ...buyerInput,
                        isDemo: false,
                        preferences: e.target.value.split('\n').filter((l) => l.trim() !== ''),
                      })
                    }
                    placeholder="空白未填，每行一項偏好..."
                    className="w-full p-2 border border-slate-200 rounded text-xs"
                  />
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <label className="block font-bold text-rose-800 mb-1">
                    不可接受條件 (Deal-breakers)
                  </label>
                  <textarea
                    rows={3}
                    value={buyerInput.dealBreakers.join('\n')}
                    onChange={(e) =>
                      setBuyerInput({
                        ...buyerInput,
                        isDemo: false,
                        dealBreakers: e.target.value.split('\n').filter((l) => l.trim() !== ''),
                      })
                    }
                    placeholder="空白未填，每行一項抗性..."
                    className="w-full p-2 border border-slate-200 rounded text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200">
                <input
                  type="text"
                  value={buyerInput.livingCircle}
                  onChange={(e) =>
                    setBuyerInput({ ...buyerInput, isDemo: false, livingCircle: e.target.value })
                  }
                  placeholder="目標生活圈（選填）"
                  className="flex-1 mr-3 px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                />
                <button
                  type="button"
                  onClick={handleSaveBuyerProfile}
                  className="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold flex items-center space-x-1"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>儲存此買方需求</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-white rounded-xl border border-slate-200 text-slate-600">
              目前為一般買方評估模式（無預填條件）。報告需求對照章節將標示「待填寫購屋條件」；若要針對特定買方配對，請勾選上方「啟用特定買方條件配對」或點選「新建空白買方條件」。
            </div>
          )}
        </div>
      )}

      {/* Error Message with Retry */}
      {genError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{genError}</span>
          </div>
          {!isGenerating && (
            <button
              type="button"
              onClick={() => handleGenerateReport(true)}
              className="px-3 py-1 bg-white border border-rose-300 text-rose-800 rounded-lg font-bold flex items-center space-x-1 shrink-0 hover:bg-rose-100"
            >
              <RotateCcw className="w-3 h-3" />
              <span>重試生成 (沿用請求 ID)</span>
            </button>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            返回校對表單
          </button>
        )}
        <div className="ml-auto flex items-center space-x-3">
          {isGenerating && (
            <button
              type="button"
              onClick={handleCancelGenerate}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5"
            >
              <XCircle className="w-4 h-4" />
              <span>取消生成 ({genElapsedSec}s)</span>
            </button>
          )}
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => handleGenerateReport(false)}
            className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center space-x-2 shadow-xs transition-all disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>
              {isGenerating
                ? `AI 正在撰寫專業報告草稿 (${genElapsedSec}s)...`
                : '開始生成專業報告書'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
