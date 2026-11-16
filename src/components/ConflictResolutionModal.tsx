import React, { useState } from 'react';
import { AlertTriangle, Check, HelpCircle } from 'lucide-react';
import { FieldConflict } from '../types/property';

interface ConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: FieldConflict[];
  onResolveConflict: (field: string, resolvedValue: any, decisionNote: string) => void;
  onKeepUnresolved: (field: string) => void;
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  isOpen,
  onClose,
  conflicts,
  onResolveConflict,
  onKeepUnresolved,
}) => {
  const [selectedField, setSelectedField] = useState<string>(conflicts[0]?.field || '');
  const [customValue, setCustomValue] = useState<string>('');

  if (!isOpen || conflicts.length === 0) return null;

  const currentConflict = conflicts.find((c) => c.field === selectedField) || conflicts[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 no-print">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-rose-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-base">來源資訊衝突人工核對比對</h3>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs">
          <p className="text-slate-600">
            偵測到不同資料來源（如資料庫契約 vs 公開售屋網頁）對「<strong>{currentConflict.fieldLabel}</strong>」之記載有出入。請比對雙方原始證據，並選擇採用或標示為「待查」。未釐清的衝突不得自動代填任一值。
          </p>

          {/* Side-by-Side Sources */}
          <div className="grid grid-cols-2 gap-4">
            {/* Source A */}
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-800 text-sm">來源 A：{currentConflict.sourceA.sourceName}</span>
                  <span className="text-[10px] text-slate-400 font-mono">{currentConflict.sourceA.timestamp}</span>
                </div>
                <div className="text-xl font-extrabold text-blue-700 my-2">
                  {currentConflict.sourceA.value}
                </div>
                <div className="text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200 text-[11px] leading-relaxed">
                  <strong className="text-slate-800 block mb-0.5">原始依據摘要：</strong>
                  {currentConflict.sourceA.excerpt}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onResolveConflict(
                    currentConflict.field,
                    currentConflict.sourceA.value,
                    `人工採用來源 A (${currentConflict.sourceA.sourceName})`
                  );
                }}
                className="mt-4 w-full py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-bold flex items-center justify-center space-x-1.5 shadow-xs"
              >
                <Check className="w-4 h-4" />
                <span>採用來源 A ({currentConflict.sourceA.value})</span>
              </button>
            </div>

            {/* Source B */}
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-800 text-sm">來源 B：{currentConflict.sourceB.sourceName}</span>
                  <span className="text-[10px] text-slate-400 font-mono">{currentConflict.sourceB.timestamp}</span>
                </div>
                <div className="text-xl font-extrabold text-purple-700 my-2">
                  {currentConflict.sourceB.value}
                </div>
                <div className="text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200 text-[11px] leading-relaxed">
                  <strong className="text-slate-800 block mb-0.5">原始依據摘要：</strong>
                  {currentConflict.sourceB.excerpt}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onResolveConflict(
                    currentConflict.field,
                    currentConflict.sourceB.value,
                    `人工採用來源 B (${currentConflict.sourceB.sourceName})`
                  );
                }}
                className="mt-4 w-full py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg font-bold flex items-center justify-center space-x-1.5 shadow-xs"
              >
                <Check className="w-4 h-4" />
                <span>採用來源 B ({currentConflict.sourceB.value})</span>
              </button>
            </div>
          </div>

          {/* Action 3: Mark as unresolved 待查 */}
          <div className="border-t border-slate-200 pt-3 flex items-center justify-between">
            <span className="text-slate-500">
              若現場尚未向屋主或地政機關查核：
            </span>
            <button
              type="button"
              onClick={() => {
                onKeepUnresolved(currentConflict.field);
                onClose();
              }}
              className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg font-semibold flex items-center space-x-1.5"
            >
              <HelpCircle className="w-4 h-4 text-amber-600" />
              <span>保留為「待查／衝突中」（不代填任一值）</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
