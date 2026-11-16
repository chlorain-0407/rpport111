import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle,
  Sparkles,
  Eye,
  ChevronRight,
  GitCompare,
  AlertCircle,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import {
  ReportDocument,
  ReportFontScale,
  SectionDiffProposal,
  normalizeReportFontScale,
} from '../types/report';
import { SafeMarkdown } from './SafeMarkdown';
import { ReportFontScaleControl } from './ReportFontScaleControl';

interface ReportEditorProps {
  report: ReportDocument;
  onSaveReport: (updated: ReportDocument) => Promise<boolean> | boolean | void;
  onProceedToPreview: () => void;
}

export const ReportEditor: React.FC<ReportEditorProps> = ({
  report,
  onSaveReport,
  onProceedToPreview,
}) => {
  const [activeSectionId, setActiveSectionId] = useState<string>(
    report.sections[0]?.id || ''
  );
  const [editingContent, setEditingContent] = useState<string>(
    report.sections[0]?.contentMarkdown || ''
  );

  // Single-section re-generation state
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenElapsedSec, setRegenElapsedSec] = useState(0);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [diffProposal, setDiffProposal] = useState<SectionDiffProposal | null>(null);
  const regenAbortRef = useRef<AbortController | null>(null);

  // Per-report font scale persistence feedback
  const currentFontScale = normalizeReportFontScale(report.layoutSettings?.fontScale);
  const [isSavingFontScale, setIsSavingFontScale] = useState(false);
  const [fontScaleSaveError, setFontScaleSaveError] = useState<string | null>(null);
  const [pendingRetryScale, setPendingRetryScale] = useState<ReportFontScale | null>(null);

  const activeSection =
    report.sections.find((s) => s.id === activeSectionId) || report.sections[0];

  // Reset active section when switching to another report
  useEffect(() => {
    const firstId = report.sections[0]?.id || '';
    setActiveSectionId(firstId);
    setEditingContent(report.sections[0]?.contentMarkdown || '');
    setDiffProposal(null);
    setRegenError(null);
    setFontScaleSaveError(null);
    setPendingRetryScale(null);
  }, [report.id]);

  // Sync editing text when switching active section within the same report
  useEffect(() => {
    const found = report.sections.find((s) => s.id === activeSectionId) || report.sections[0];
    if (found) {
      setEditingContent(found.contentMarkdown);
    }
  }, [activeSectionId, report.id]);

  useEffect(() => {
    if (!isRegenerating) {
      setRegenElapsedSec(0);
      return;
    }
    const t = setInterval(() => setRegenElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isRegenerating]);

  const handleContentChange = (newText: string) => {
    setEditingContent(newText);
    if (!activeSection) return;

    const updatedSections = report.sections.map((s) =>
      s.id === activeSection.id
        ? {
            ...s,
            contentMarkdown: newText,
            isEditedManually: true,
          }
        : s
    );

    // If report was approved, any modification resets status to pending_review!
    const newStatus = report.status === 'approved' ? 'pending_review' : report.status;

    const updatedReport: ReportDocument = {
      ...report,
      sections: updatedSections,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };
    onSaveReport(updatedReport);
  };

  const handleToggleApproval = () => {
    const nextStatus = report.status === 'approved' ? 'draft' : 'approved';
    const updated: ReportDocument = {
      ...report,
      status: nextStatus,
      reviewedAt: nextStatus === 'approved' ? new Date().toISOString() : undefined,
      reviewedBy: nextStatus === 'approved' ? '承辦經紀人' : undefined,
      updatedAt: new Date().toISOString(),
    };
    onSaveReport(updated);
  };

  // Layout fontScale update: NEVER modifies content, version, or approval status!
  const handleFontScaleChange = async (nextScale: ReportFontScale) => {
    const normalized = normalizeReportFontScale(nextScale);
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

  const handleRegenerateCurrentSection = async () => {
    if (!activeSection) return;
    regenAbortRef.current?.abort();
    const controller = new AbortController();
    regenAbortRef.current = controller;

    setIsRegenerating(true);
    setRegenError(null);

    try {
      const res = await fetch('/api/reports/regenerate-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property: report.propertySnapshot,
          reportType: report.reportType,
          sectionTitle: activeSection.title,
          currentContent: activeSection.contentMarkdown,
          feedback: regenFeedback,
        }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '章節重寫失敗，原有內容已保留。');
      }

      setDiffProposal({
        sectionId: activeSection.id,
        sectionTitle: activeSection.title,
        originalContent: activeSection.contentMarkdown,
        proposedContent: data.proposedContent,
        summaryOfChanges: data.summaryOfChanges,
        facts: data.facts || [],
        analysis: data.analysis || [],
      });
      setShowRegenModal(false);
      setRegenFeedback('');
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setRegenError('已取消本次章節重寫，原章節內容完整保留。');
      } else {
        setRegenError(err.message || '單段重寫失敗，原章節內容已安全保留。');
      }
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCancelRegen = () => {
    regenAbortRef.current?.abort();
    setIsRegenerating(false);
    setRegenError('已手動取消微調請求。');
  };

  const handleApplyDiff = () => {
    if (!diffProposal) return;
    handleContentChange(diffProposal.proposedContent);
    setDiffProposal(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Status & Review Action Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                report.status === 'approved'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : report.status === 'pending_review'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              {report.status === 'approved'
                ? '已審閱核准 (可匯出 PDF)'
                : report.status === 'pending_review'
                ? '核准後已修改 (待重新審閱，鎖定匯出)'
                : '未審閱草稿 (鎖定 PDF 匯出)'}
            </span>
            <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 font-semibold rounded">
              {report.reportType === 'owner' ? '屋主版報告' : '買方版報告'}
            </span>
            {report.isDemo && (
              <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded">
                示範資料
              </span>
            )}
            <span className="text-xs font-mono text-slate-400">v{report.version}</span>
          </div>

          <h2 className="text-lg font-black text-slate-900 mt-1">
            {report.title}
          </h2>
          <p className="text-xs text-slate-500">
            標的物：{report.propertySnapshot.caseName} ｜ 快照時間：
            {new Date(report.createdAt).toLocaleString('zh-TW')}
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            onClick={handleToggleApproval}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs ${
              report.status === 'approved'
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'
                : 'bg-emerald-700 hover:bg-emerald-800 text-white'
            }`}
          >
            <CheckCircle className="w-4 h-4" />
            <span>
              {report.status === 'approved' ? '解除審閱核准' : '確認審閱無誤 (核准報告)'}
            </span>
          </button>

          <button
            type="button"
            onClick={onProceedToPreview}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-xs transition-all"
          >
            <Eye className="w-4 h-4" />
            <span>預覽客戶版 A4</span>
          </button>
        </div>
      </div>

      {/* Re-Review Alert for legacy or zero-comparable reports */}
      {report.needsReReview && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-950 space-y-1">
            <div className="font-extrabold">【需重新審閱提示】</div>
            <ul className="list-disc list-inside text-amber-800 space-y-0.5">
              {(report.reReviewReasons && report.reReviewReasons.length > 0
                ? report.reReviewReasons
                : ['系統偵測到此歷史報告含缺可比卻推估區間或待補正欄位，建議先檢查修訂後再核准。']
              ).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Editor Body */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1 space-y-2">
          <div className="text-xs font-bold text-slate-500 uppercase px-2 mb-1">
            報告書章節列表 ({report.sections.length})
          </div>

          {report.sections.map((sec, idx) => (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveSectionId(sec.id)}
              className={`w-full text-left p-3 rounded-xl border text-xs transition-all flex items-start justify-between ${
                activeSection?.id === sec.id
                  ? 'bg-blue-700 text-white border-blue-700 shadow-sm font-semibold'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              <div className="space-y-0.5">
                <div className="font-bold">
                  {idx + 1}. {sec.title}
                </div>
                {sec.isEditedManually && (
                  <span
                    className={`text-[10px] inline-block ${
                      activeSection?.id === sec.id ? 'text-blue-200' : 'text-amber-600'
                    }`}
                  >
                    已手動修訂
                  </span>
                )}
              </div>
              <ChevronRight
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  activeSection?.id === sec.id ? 'text-white' : 'text-slate-400'
                }`}
              />
            </button>
          ))}
        </div>

        <div className="md:col-span-3 space-y-4">
          {activeSection && (
            <div
              className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4 report-scalable"
              style={{ '--report-font-scale': currentFontScale / 100 } as React.CSSProperties}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
                <div>
                  <div className="text-xs font-bold text-blue-700">正在編輯章節</div>
                  <h3 className="rf-h2 text-base font-extrabold text-slate-900">
                    {activeSection.title}
                  </h3>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRegenError(null);
                      setShowRegenModal(true);
                    }}
                    className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all shadow-2xs"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                    <span>單段 AI 重寫微調 (附比對)</span>
                  </button>
                </div>
              </div>

              {/* Facts & Analysis Proofing Tags */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {activeSection.facts && activeSection.facts.length > 0 && (
                  <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200">
                    <span className="font-bold text-blue-900 block mb-1">
                      客觀事實數據與來源：
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-blue-800 text-[11px]">
                      {activeSection.facts.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {activeSection.pendingChecklist && activeSection.pendingChecklist.length > 0 && (
                  <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200">
                    <span className="font-bold text-amber-900 block mb-1">
                      待查證／應補事項：
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-amber-800 text-[11px]">
                      {activeSection.pendingChecklist.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Editable Markdown Area */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    章節內容 Markdown (修改後自動保存；若已核准將退回待審閱)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    支援繁中標題、清單、粗體與表格格式（文字字級同步套用 {currentFontScale}%）
                  </span>
                </div>
                <textarea
                  rows={12}
                  value={editingContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  className="w-full p-4 border border-slate-300 rounded-xl rf-editor text-xs font-mono text-slate-900 focus:ring-2 focus:ring-blue-500 bg-slate-50/30"
                />
              </div>

              {/* Safe Formatted Markdown Live Preview with Synchronized Font Scale Toolbar */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
                  <span className="font-bold text-slate-600 uppercase text-[11px]">
                    即時安全排版呈現預覽（與 A4 同步套用）
                  </span>
                  <ReportFontScaleControl
                    fontScale={currentFontScale}
                    onChange={handleFontScaleChange}
                    isSaving={isSavingFontScale}
                    saveError={fontScaleSaveError}
                    onRetrySave={
                      pendingRetryScale ? () => handleFontScaleChange(pendingRetryScale) : undefined
                    }
                  />
                </div>
                <SafeMarkdown content={editingContent} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Single Section Re-generation Modal */}
      {showRegenModal && activeSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 no-print">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-2 text-purple-700 font-bold text-base">
              <Sparkles className="w-5 h-5" />
              <h4>重新微調章節：「{activeSection.title}」</h4>
            </div>
            <p className="text-xs text-slate-600">
              輸入調整要求。AI 將以此產生新版建議並在下一步顯示「新舊差異比對」，絕不自動覆蓋您的手動編輯或其他章節。
            </p>

            <textarea
              rows={3}
              value={regenFeedback}
              onChange={(e) => setRegenFeedback(e.target.value)}
              placeholder="例如：請將未記載的學區與通勤項目全數改列為待確認..."
              className="w-full p-3 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-purple-500"
            />

            {regenError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>{regenError}</span>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2">
              {isRegenerating ? (
                <button
                  type="button"
                  onClick={handleCancelRegen}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1"
                >
                  <XCircle className="w-4 h-4" />
                  <span>取消生成 ({regenElapsedSec}s)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowRegenModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  關閉
                </button>
              )}
              <button
                type="button"
                disabled={isRegenerating}
                onClick={handleRegenerateCurrentSection}
                className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {isRegenerating
                    ? `AI 正在重寫 (${regenElapsedSec}s)...`
                    : '生成新版並檢視差異'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diff Proposal Modal */}
      {diffProposal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 no-print">
          <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <GitCompare className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-base">新版差異比對與套用審閱</h3>
              </div>
              <button
                type="button"
                onClick={() => setDiffProposal(null)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="bg-purple-50 p-3.5 rounded-xl border border-purple-200 text-purple-900">
                <div className="font-bold text-sm">變更重點摘要：</div>
                <p className="mt-1 text-purple-800">{diffProposal.summaryOfChanges}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                  <div className="font-bold text-slate-700 pb-1 border-b border-slate-200">
                    目前內容 (包含人工編輯)
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <SafeMarkdown content={diffProposal.originalContent} />
                  </div>
                </div>

                <div className="border border-purple-200 rounded-xl p-4 bg-purple-50/40 space-y-2">
                  <div className="font-bold text-purple-900 pb-1 border-b border-purple-200">
                    AI 建議新版內容
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <SafeMarkdown content={diffProposal.proposedContent} />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                套用新版後，若報告原為已審閱狀態，將切換為待審閱以供經紀人再次確認。
              </span>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setDiffProposal(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-white"
                >
                  保留目前內容
                </button>
                <button
                  type="button"
                  onClick={handleApplyDiff}
                  className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold shadow-xs"
                >
                  確認套用新版內容
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
