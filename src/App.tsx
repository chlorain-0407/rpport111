import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  Home,
  Database,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Eye,
  Trash2,
  ExternalLink,
  Edit3,
  Copy,
  FolderOpen,
  Sparkles,
  ShieldCheck,
  Building2,
  HelpCircle,
  RefreshCw,
  AlertCircle,
  Check,
  Server,
} from 'lucide-react';
import { PropertyData } from './types/property';
import { ReportDocument, BrokerProfile } from './types/report';
import { DEFAULT_BROKER } from './utils/mockData';
import { Header } from './components/Header';
import { PropertySourceModal, ImportMergeAction } from './components/PropertySourceModal';
import { PropertyProofreadForm } from './components/PropertyProofreadForm';
import { ReportCreatorModal } from './components/ReportCreatorModal';
import { ReportEditor } from './components/ReportEditor';
import { ClientReportA4 } from './components/ClientReportA4';
import { DatabaseSettingsModal } from './components/DatabaseSettingsModal';
import { formatLayout, normalizeLayoutInput, formatWan, formatPing } from './utils/calculator';

export default function App() {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'properties' | 'creator' | 'editor' | 'preview'>('dashboard');

  // Loading & Error States (as required: 載入中、錯誤、空資料三種狀態)
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Broker profile state (persisted in MongoDB via /api/profile)
  const [broker, setBroker] = useState<BrokerProfile>(DEFAULT_BROKER);

  // Properties state (persisted in MongoDB via /api/properties)
  const [properties, setProperties] = useState<PropertyData[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');

  // Reports state (persisted in MongoDB via /api/reports)
  const [reports, setReports] = useState<ReportDocument[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>('');

  // Modals state
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showDbModal, setShowDbModal] = useState(false);

  // Database connection status state
  const [dbConfigured, setDbConfigured] = useState(true);
  const [dbStatusText, setDbStatusText] = useState('連線至專屬 MongoDB 資料庫 (e8346c_report)');
  const [dbLatency, setDbLatency] = useState<number | null>(null);

  // Filter state in dashboard
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'owner' | 'buyer'>('all');
  const [toastError, setToastError] = useState<string | null>(null);

  // Fetch initial data from backend Node.js MongoDB APIs
  const fetchAllData = async () => {
    setIsLoading(true);
    setFetchError(null);

    try {
      // 1. Check DB Status
      const statusRes = await fetch('/api/database/status');
      const statusData = await statusRes.json();
      setDbConfigured(statusData.connected);
      setDbStatusText(statusData.statusText || '已連線至 MongoDB (e8346c_report)');
      if (statusData.latencyMs) setDbLatency(statusData.latencyMs);

      // 2. Fetch Properties from backend
      const propRes = await fetch('/api/properties');
      if (!propRes.ok) throw new Error('無法讀取物件資料');
      let propData: PropertyData[] = await propRes.json();

      // If empty, auto-seed the demo properties into MongoDB!
      if (propData.length === 0) {
        const seedRes = await fetch('/api/database/seed', { method: 'POST' });
        if (seedRes.ok) {
          const rePropRes = await fetch('/api/properties');
          propData = await rePropRes.json();
        }
      }

      const cleanProps = propData.map((p) => ({ ...p, layout: normalizeLayoutInput(p.layout) }));
      setProperties(cleanProps);
      if (cleanProps.length > 0) {
        setSelectedPropertyId(cleanProps[0].id);
      }

      // 3. Fetch Reports from backend
      const repRes = await fetch('/api/reports');
      if (repRes.ok) {
        const repData: ReportDocument[] = await repRes.json();
        setReports(repData);
        if (repData.length > 0) {
          setSelectedReportId(repData[0].id);
        }
      }

      // 4. Fetch Broker Profile from backend
      const profileRes = await fetch('/api/profile');
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        if (profileData && profileData.name) {
          setBroker(profileData);
        }
      }
    } catch (err: any) {
      console.error('Data fetch error:', err);
      setFetchError(err.message || '資料讀取異常，請確認後端服務與 MongoDB 連線狀態');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Active property & report getters
  const activeProperty = properties.find((p) => p.id === selectedPropertyId) || properties[0];
  const activeReport = reports.find((r) => r.id === selectedReportId) || reports[0];

  // Import or Add property handler (persists to MongoDB)
  const handleImportProperty = async (
    imported: PropertyData,
    action: ImportMergeAction,
    matchedExistingId?: string
  ) => {
    const findMatchedExisting = () => {
      if (matchedExistingId) {
        const byId = properties.find((p) => p.id === matchedExistingId);
        if (byId) return byId;
      }
      if (imported.sourcePlatform && imported.sourceListingId) {
        const byExt = properties.find(
          (p) =>
            p.sourcePlatform === imported.sourcePlatform &&
            p.sourceListingId === imported.sourceListingId
        );
        if (byExt) return byExt;
      }
      return properties.find(
        (p) => p.caseId === imported.caseId || p.caseName === imported.caseName
      );
    };

    if (action === 'reuse') {
      const existing = findMatchedExisting();
      if (existing) {
        setSelectedPropertyId(existing.id);
        setActiveTab('properties');
        return;
      }
    }

    if (action === 'merge_unverified') {
      const existing = findMatchedExisting();
      if (existing) {
        const verifiedKeys = existing.fieldStatus || {};
        const mergedFieldStatus = { ...(existing.fieldStatus || {}) };
        const mergedEvidence = { ...(existing.evidenceSummaries || {}) };
        const merged: any = { ...existing };

        const mergeableKeys: Array<keyof PropertyData> = [
          'caseName',
          'cityDistrict',
          'address',
          'propertyType',
          'askingPrice',
          'previousAskingPrice',
          'totalArea',
          'mainArea',
          'auxArea',
          'commonArea',
          'hasParking',
          'parkingIncluded',
          'parkingType',
          'parkingOwnership',
          'parkingArea',
          'parkingAreaIncludedInCommon',
          'parkingPrice',
          'layout',
          'floor',
          'totalFloors',
          'floorRaw',
          'age',
          'managementFee',
          'managementFeeAmount',
          'managementFeePeriod',
          'managementFeeRaw',
          'currentUsage',
        ];

        const hasMeaningfulValue = (val: any) =>
          val !== null && val !== undefined && val !== '';

        for (const k of mergeableKeys) {
          const statusKey = k as string;
          const isMgmtCoupled =
            k === 'managementFeeAmount' ||
            k === 'managementFeePeriod' ||
            k === 'managementFeeRaw';
          const effectiveStatus = isMgmtCoupled
            ? verifiedKeys['managementFee']
            : verifiedKeys[statusKey];

          if (effectiveStatus === 'verified') {
            continue; // 嚴格保護已手動核對欄位
          }

          const incomingVal = (imported as any)[k];
          if (hasMeaningfulValue(incomingVal)) {
            merged[k] = incomingVal;
            if (imported.fieldStatus?.[statusKey]) {
              mergedFieldStatus[statusKey] = imported.fieldStatus[statusKey];
            }
            if (imported.evidenceSummaries?.[statusKey]) {
              mergedEvidence[statusKey] = imported.evidenceSummaries[statusKey];
            }
          }
        }

        // 保留管理費月均值對應狀態
        if (verifiedKeys['managementFee'] !== 'verified') {
          if (imported.fieldStatus?.managementFee) {
            mergedFieldStatus.managementFee = imported.fieldStatus.managementFee;
          }
          if (imported.evidenceSummaries?.managementFee) {
            mergedEvidence.managementFee = imported.evidenceSummaries.managementFee;
          }
        }

        const mergedPayload: PropertyData = {
          ...merged,
          id: existing.id,
          caseId: existing.caseId,
          fieldStatus: mergedFieldStatus,
          evidenceSummaries: mergedEvidence,
          sourcePlatform: imported.sourcePlatform || existing.sourcePlatform,
          sourceListingId: imported.sourceListingId || existing.sourceListingId,
          sourceUrl: imported.sourceUrl || existing.sourceUrl,
          fetchedAt: imported.fetchedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        try {
          const res = await fetch(`/api/properties/${existing.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mergedPayload),
          });
          const data = await res.json();
          const savedMerged = data.property || mergedPayload;
          setProperties((prev) =>
            prev.map((p) => (p.id === existing.id ? savedMerged : p))
          );
          setSelectedPropertyId(existing.id);
          setActiveTab('properties');
        } catch (err: any) {
          setToastError(`更新既有物件失敗: ${err.message}`);
        }
        return;
      }
    }

    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imported),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '儲存物件失敗');

      const savedProp = {
        ...(data.property || imported),
        layout: normalizeLayoutInput((data.property || imported).layout),
      };
      setProperties((prev) => [savedProp, ...prev.filter((p) => p.id !== savedProp.id)]);
      setSelectedPropertyId(savedProp.id);
      setActiveTab('properties');
    } catch (err: any) {
      setToastError(`儲存物件至資料庫失敗: ${err.message}`);
    }
  };

  // Save updated property to MongoDB
  const handleSaveProperty = async (updated: PropertyData) => {
    const cleanUpdated = {
      ...updated,
      layout: updated.layout === '待確認' ? '' : updated.layout,
    };
    setProperties((prev) => prev.map((p) => (p.id === cleanUpdated.id ? cleanUpdated : p)));
    try {
      await fetch(`/api/properties/${cleanUpdated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanUpdated),
      });
    } catch (err) {
      console.error('Failed to update property in MongoDB:', err);
    }
  };

  // Report creation callback (idempotent save to MongoDB)
  const handleReportCreated = async (newReport: ReportDocument) => {
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReport),
      });
      const data = await res.json();
      const savedDoc = data.report || newReport;
      setReports((prev) => [savedDoc, ...prev.filter((r) => r.id !== savedDoc.id)]);
      setSelectedReportId(savedDoc.id);
      setActiveTab('editor');
    } catch (err: any) {
      setToastError(`儲存報告至資料庫失敗: ${err.message}`);
      setReports((prev) => [newReport, ...prev.filter((r) => r.id !== newReport.id)]);
      setSelectedReportId(newReport.id);
      setActiveTab('editor');
    }
  };

  // Update existing report in MongoDB (returns true/false so layout setting retry UI is truthful)
  const handleSaveReport = async (updated: ReportDocument): Promise<boolean> => {
    setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    try {
      const res = await fetch(`/api/reports/${updated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        return false;
      }
      const data = await res.json();
      if (data?.report) {
        setReports((prev) => prev.map((r) => (r.id === updated.id ? data.report : r)));
      }
      return true;
    } catch (err) {
      console.error('Failed to update report in MongoDB:', err);
      return false;
    }
  };

  // Delete report from MongoDB
  const handleDeleteReport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/reports/${id}`, { method: 'DELETE' });
      const next = reports.filter((r) => r.id !== id);
      setReports(next);
      if (selectedReportId === id) {
        setSelectedReportId(next[0]?.id || '');
      }
    } catch (err) {
      console.error('Failed to delete report:', err);
    }
  };

  // Update broker profile in MongoDB
  const handleUpdateBroker = async (updated: BrokerProfile) => {
    setBroker(updated);
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch (err) {
      console.error('Failed to update profile in MongoDB:', err);
    }
  };

  // Filtered reports for dashboard
  const filteredReports = reports.filter((r) => {
    const matchesSearch =
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.propertySnapshot.caseName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.propertySnapshot.cityDistrict.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType =
      filterType === 'all' ? true : r.reportType === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 flex flex-col font-sans">
      {/* Universal Header */}
      <Header
        broker={broker}
        onUpdateBroker={handleUpdateBroker}
        dbConfigured={dbConfigured}
        dbStatusText={
          dbConfigured
            ? `MongoDB (e8346c_report) ${dbLatency ? `${dbLatency}ms` : ''}`
            : 'MongoDB 連線中'
        }
        onOpenDbSettings={() => setShowDbModal(true)}
        activeTab={activeTab}
        onSelectTab={(t: any) => setActiveTab(t)}
        reportsCount={reports.length}
        propertiesCount={properties.length}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {toastError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl text-xs flex items-center justify-between no-print">
            <span>{toastError}</span>
            <button type="button" onClick={() => setToastError(null)} className="font-bold px-2">
              &times;
            </button>
          </div>
        )}
        {/* ========================================================================= */}
        {/* STATE 1: LOADING STATE (載入中狀態)                                         */}
        {/* ========================================================================= */}
        {isLoading && (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-4 shadow-sm">
            <RefreshCw className="w-8 h-8 text-blue-700 animate-spin mx-auto" />
            <div className="text-base font-bold text-slate-800">
              正在自 MongoDB 資料庫載入物件與報告紀錄...
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              連線至專屬 MongoDB 資料庫 (e8346c_report)，同步成屋住宅物件庫與快照資料。
            </p>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STATE 2: ERROR STATE (錯誤狀態)                                            */}
        {/* ========================================================================= */}
        {!isLoading && fetchError && (
          <div className="bg-rose-50 border border-rose-200 rounded-3xl p-8 text-center space-y-4">
            <AlertCircle className="w-10 h-10 text-rose-600 mx-auto" />
            <div className="text-base font-bold text-rose-900">資料庫讀取異常</div>
            <p className="text-xs text-rose-700 max-w-md mx-auto">
              {fetchError}。請檢查伺服器連線或重試。
            </p>
            <button
              type="button"
              onClick={fetchAllData}
              className="px-5 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-xl text-xs font-bold inline-flex items-center space-x-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>重新載入資料</span>
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: DASHBOARD & REPORT OVERVIEW                                        */}
        {/* ========================================================================= */}
        {!isLoading && !fetchError && activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Quick Action & Stats Hero */}
            <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2 max-w-xl">
                <div className="flex items-center space-x-2">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/30 text-blue-300 font-bold border border-blue-400/30">
                    成屋住宅報告系統
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-400/20 flex items-center space-x-1">
                    <Database className="w-3 h-3" />
                    <span>MongoDB (e8346c_report)</span>
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-snug">
                  專業房仲報告書製作平台
                </h1>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  資料一律安全存放於專屬 MongoDB 資料庫。支援「委託前銷售評估」與「買方購屋需求對照」雙版本，支援多來源匯入與 A4 客戶版列印。
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSourceModal(true)}
                  className="px-5 py-3 bg-white hover:bg-slate-100 text-slate-900 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 shadow-md transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-blue-700" />
                  <span>新增物件 / 匯入資料</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (activeProperty) {
                      setActiveTab('creator');
                    } else {
                      setShowSourceModal(true);
                    }
                  }}
                  className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 shadow-md transition-all cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>製作新報告書</span>
                </button>
              </div>
            </div>

            {/* Mode Banner & Fast Property Switcher */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {properties.slice(0, 3).map((p, idx) => (
                <div
                  key={p.id}
                  onClick={() => {
                    setSelectedPropertyId(p.id);
                    setActiveTab('properties');
                  }}
                  className="bg-white p-4 rounded-2xl border border-slate-200 hover:border-blue-500 hover:shadow-xs cursor-pointer transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                      {idx === 0 ? '標準示範標的' : idx === 1 ? '價格衝突案例' : '待補案例'}
                    </span>
                    <span className="text-xs font-mono text-slate-400">{p.caseId}</span>
                  </div>
                  <div className="font-bold text-slate-900 text-sm truncate">{p.caseName}</div>
                  <div className="text-xs text-slate-500">
                    開價 {formatWan(p.askingPrice)} ｜ 權狀 {formatPing(p.totalArea)} ｜ {formatLayout(p.layout)}
                  </div>
                </div>
              ))}
            </div>

            {/* Reports List Section */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">
                    已建立之報告紀錄 ({filteredReports.length})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    每份報告保留自己的輸入快照與版本，持久化儲存於 MongoDB。
                  </p>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜尋案名、報告標題或行政區..."
                      className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-xl text-xs w-48 sm:w-64"
                    />
                  </div>

                  <div className="flex border border-slate-200 rounded-xl p-0.5 bg-slate-50 text-xs">
                    <button
                      type="button"
                      onClick={() => setFilterType('all')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                        filterType === 'all' ? 'bg-white shadow-2xs text-slate-900' : 'text-slate-500'
                      }`}
                    >
                      全部
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterType('owner')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                        filterType === 'owner' ? 'bg-white shadow-2xs text-blue-700' : 'text-slate-500'
                      }`}
                    >
                      屋主版
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterType('buyer')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                        filterType === 'buyer' ? 'bg-white shadow-2xs text-purple-700' : 'text-slate-500'
                      }`}
                    >
                      買方版
                    </button>
                  </div>
                </div>
              </div>

              {/* Reports list or Empty State */}
              {filteredReports.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {filteredReports.map((rep) => (
                    <div
                      key={rep.id}
                      onClick={() => {
                        setSelectedReportId(rep.id);
                        setActiveTab('editor');
                      }}
                      className="py-4 hover:bg-slate-50/70 transition-all rounded-xl px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              rep.reportType === 'owner'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {rep.reportType === 'owner' ? '屋主銷售評估' : '買方購屋評估'}
                          </span>

                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              rep.status === 'approved'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : rep.status === 'pending_review'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {rep.status === 'approved'
                              ? '已審閱核准'
                              : rep.status === 'pending_review'
                              ? '待審閱'
                              : '草稿'}
                          </span>

                          {rep.needsReReview && (
                            <span
                              title={(rep.reReviewReasons || []).join('；')}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300"
                            >
                              需重新審閱
                            </span>
                          )}

                          <h3 className="font-bold text-slate-900 text-sm group-hover:text-blue-700 transition-colors">
                            {rep.title}
                          </h3>
                        </div>

                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                          <span>標的：<strong>{rep.propertySnapshot.caseName}</strong></span>
                          <span>•</span>
                          <span>開價 {formatWan(rep.propertySnapshot.askingPrice)}</span>
                          <span>•</span>
                          <span>快照日期：{new Date(rep.createdAt).toLocaleDateString('zh-TW')}</span>
                          {rep.buyerRequirements && (
                            <>
                              <span>•</span>
                              <span className="text-purple-700 font-medium">
                                對象：{rep.buyerRequirements.buyerNickname || '買方客戶'}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedReportId(rep.id);
                            setActiveTab('preview');
                          }}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center space-x-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>預覽A4</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => handleDeleteReport(rep.id, e)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors"
                          title="自資料庫刪除此報告"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* STATE 3: EMPTY STATE (空資料狀態) */
                <div className="text-center py-12 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="text-sm font-bold text-slate-800">尚無報告書紀錄</div>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    MongoDB 資料庫目前無此篩選條件之報告。您可以點擊下方按鈕為物件生成屋主銷售評估或買方購屋評估報告。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeProperty) {
                        setActiveTab('creator');
                      } else {
                        setShowSourceModal(true);
                      }
                    }}
                    className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold inline-flex items-center space-x-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>立即製作第一份報告</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: PROPERTY INVENTORY & PROOFREAD FORM                                */}
        {/* ========================================================================= */}
        {!isLoading && !fetchError && activeTab === 'properties' && (
          <div className="space-y-4">
            {properties.length > 0 ? (
              <>
                {/* Property Selector Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-slate-700">切換校對物件：</span>
                    <select
                      value={selectedPropertyId}
                      onChange={(e) => setSelectedPropertyId(e.target.value)}
                      className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white font-bold text-slate-900"
                    >
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.caseName} ({p.caseId}) - {formatWan(p.askingPrice)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setShowSourceModal(true)}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新增 / 匯入新物件</span>
                    </button>
                  </div>
                </div>

                {/* Proofread Form Component */}
                {activeProperty && (
                  <PropertyProofreadForm
                    property={activeProperty}
                    onSaveProperty={handleSaveProperty}
                    onProceedToReport={(prop) => {
                      setSelectedPropertyId(prop.id);
                      setActiveTab('creator');
                    }}
                  />
                )}
              </>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
                <Building2 className="w-10 h-10 text-slate-400 mx-auto" />
                <div className="text-base font-bold text-slate-800">物件庫目前無資料</div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  可從外部網址擷取、貼上文字、或點擊初始化示範成屋資料。
                </p>
                <button
                  type="button"
                  onClick={() => setShowSourceModal(true)}
                  className="px-4 py-2 bg-blue-700 text-white rounded-xl text-xs font-bold"
                >
                  匯入物件資料
                </button>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: REPORT CREATOR CENTER                                              */}
        {/* ========================================================================= */}
        {!isLoading && !fetchError && activeTab === 'creator' && activeProperty && (
          <ReportCreatorModal
            property={activeProperty}
            onReportCreated={handleReportCreated}
            onCancel={() => setActiveTab('properties')}
          />
        )}

        {/* ========================================================================= */}
        {/* TAB 4: REPORT EDITOR & REVIEW                                             */}
        {/* ========================================================================= */}
        {!isLoading && !fetchError && activeTab === 'editor' && activeReport && (
          <ReportEditor
            report={activeReport}
            onSaveReport={handleSaveReport}
            onProceedToPreview={() => setActiveTab('preview')}
          />
        )}

        {/* ========================================================================= */}
        {/* TAB 5: CLIENT A4 PRESENTATION & PRINT                                     */}
        {/* ========================================================================= */}
        {!isLoading && !fetchError && activeTab === 'preview' && activeReport && (
          <ClientReportA4
            report={activeReport}
            broker={broker}
            onSaveReport={handleSaveReport}
            onBackToEdit={() => setActiveTab('editor')}
          />
        )}
      </main>

      {/* Modals */}
      <PropertySourceModal
        isOpen={showSourceModal}
        onClose={() => setShowSourceModal(false)}
        onImportProperty={handleImportProperty}
        existingProperties={properties}
        dbConfigured={dbConfigured}
      />

      <DatabaseSettingsModal
        isOpen={showDbModal}
        onClose={() => setShowDbModal(false)}
        configured={dbConfigured}
        statusText={dbStatusText}
        onSaveConfig={async () => {
          fetchAllData();
        }}
        onResetToDemo={async () => {
          await fetch('/api/database/seed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true }),
          });
          fetchAllData();
        }}
      />
    </div>
  );
}
