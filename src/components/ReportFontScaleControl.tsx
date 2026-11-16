import React from 'react';
import { RotateCcw, AlertCircle } from 'lucide-react';
import { REPORT_FONT_SCALES, ReportFontScale, normalizeReportFontScale } from '../types/report';

interface ReportFontScaleControlProps {
  fontScale: ReportFontScale;
  onChange: (nextScale: ReportFontScale) => void;
  isSaving?: boolean;
  saveError?: string | null;
  onRetrySave?: () => void;
}

const SCALE_LABELS: Record<ReportFontScale, string> = {
  90: '精簡',
  100: '標準',
  110: '加大',
  125: '特大',
};

export const ReportFontScaleControl: React.FC<ReportFontScaleControlProps> = ({
  fontScale,
  onChange,
  isSaving = false,
  saveError = null,
  onRetrySave,
}) => {
  const current = normalizeReportFontScale(fontScale);
  const currentIdx = REPORT_FONT_SCALES.indexOf(current);
  const canDecrease = currentIdx > 0;
  const canIncrease = currentIdx < REPORT_FONT_SCALES.length - 1;

  const handleDecrease = () => {
    if (!canDecrease) return;
    onChange(REPORT_FONT_SCALES[currentIdx - 1]);
  };

  const handleIncrease = () => {
    if (!canIncrease) return;
    onChange(REPORT_FONT_SCALES[currentIdx + 1]);
  };

  const handleReset = () => {
    onChange(100);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 no-print" role="group" aria-label="報告字級調整">
      <div className="inline-flex items-center rounded-xl border border-slate-300 bg-slate-50 px-2 py-1 gap-1 shadow-2xs">
        <span className="text-[11px] font-bold text-slate-600 px-1 select-none">字級</span>

        <button
          type="button"
          onClick={handleDecrease}
          disabled={!canDecrease}
          aria-label="縮小報告字級"
          title={canDecrease ? '縮小報告字級' : '已達最小字級 (90%)'}
          className="px-2 py-1 rounded-lg text-xs font-extrabold text-slate-800 hover:bg-white hover:shadow-2xs disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        >
          A−
        </button>

        <button
          type="button"
          onClick={handleReset}
          aria-label="恢復預設字級"
          title={current === 100 ? '目前為標準 100% 字級' : '點擊恢復預設 100% 字級'}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            current === 100
              ? 'bg-white text-slate-800 border border-slate-200'
              : 'bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100'
          }`}
        >
          {SCALE_LABELS[current]} {current}%
        </button>

        <button
          type="button"
          onClick={handleIncrease}
          disabled={!canIncrease}
          aria-label="放大報告字級"
          title={canIncrease ? '放大報告字級' : '已達最大字級 (125%)'}
          className="px-2 py-1 rounded-lg text-xs font-extrabold text-slate-800 hover:bg-white hover:shadow-2xs disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        >
          A+
        </button>
      </div>

      {current !== 100 && (
        <button
          type="button"
          onClick={handleReset}
          className="text-[11px] font-semibold text-slate-600 hover:text-blue-700 underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
        >
          恢復預設
        </button>
      )}

      {isSaving && (
        <span className="text-[11px] text-slate-500 font-medium">字級保存中...</span>
      )}

      {saveError && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold">
          <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          <span>{saveError}</span>
          {onRetrySave && (
            <button
              type="button"
              onClick={onRetrySave}
              className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 bg-rose-700 hover:bg-rose-800 text-white rounded text-[10px] font-bold"
            >
              <RotateCcw className="w-3 h-3" />
              <span>重試</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
