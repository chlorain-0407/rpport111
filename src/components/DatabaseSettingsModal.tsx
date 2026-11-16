import React, { useState, useEffect } from 'react';
import { Database, CheckCircle2, AlertCircle, RefreshCw, Server, ShieldCheck, DatabaseZap } from 'lucide-react';

interface DatabaseSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  configured: boolean;
  statusText: string;
  onSaveConfig: (config: any) => Promise<void>;
  onResetToDemo: () => void;
}

export const DatabaseSettingsModal: React.FC<DatabaseSettingsModalProps> = ({
  isOpen,
  onClose,
  configured,
  statusText,
  onResetToDemo,
}) => {
  const [testing, setTesting] = useState(false);
  const [dbInfo, setDbInfo] = useState<any>(null);
  const [seedLoading, setSeedLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      handleCheckStatus();
    }
  }, [isOpen]);

  const handleCheckStatus = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/database/status');
      const data = await res.json();
      setDbInfo(data);
    } catch (err: any) {
      setDbInfo({ connected: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleReSeed = async () => {
    if (!confirm('確定要重新初始化 MongoDB 資料庫中的成屋住宅示範資料嗎？')) return;
    setSeedLoading(true);
    try {
      await onResetToDemo();
      await handleCheckStatus();
    } finally {
      setSeedLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 no-print">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-base">專屬 MongoDB 資料庫資訊與狀態</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Status Badge */}
          <div
            className={`p-4 rounded-xl border flex items-start space-x-3 ${
              dbInfo?.connected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {dbInfo?.connected ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            )}
            <div>
              <div className="font-bold text-sm">
                {dbInfo?.connected ? '已成功連線至專屬 MongoDB 資料庫' : '資料庫連線中或未就緒'}
              </div>
              <p className="text-xs mt-1 text-slate-600 leading-relaxed">
                全端 Node.js 後端使用官方 <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">mongodb</code> 驅動程式，透過全局 <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">globalThis.__mongoClient</code> 保持單一連線池，前端不直連。
              </p>
            </div>
          </div>

          {/* Database Specs Card */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="font-bold text-slate-800 text-sm flex items-center justify-between">
              <span>資料庫執行規格</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                {dbInfo?.latencyMs ? `延遲 ${dbInfo.latencyMs}ms` : '連線良好'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-slate-700">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">資料庫名稱 (DB Name)</span>
                <span className="font-mono font-bold text-slate-900">e8346c_report</span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">密鑰安全機制</span>
                <span className="font-bold text-emerald-700 flex items-center space-x-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>process.env.MONGODB_URI</span>
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">成屋物件數量 (properties)</span>
                <span className="font-extrabold text-blue-800 text-sm">
                  {dbInfo?.collections?.properties ?? '-'} 筆
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">已儲存報告書 (reports)</span>
                <span className="font-extrabold text-purple-800 text-sm">
                  {dbInfo?.collections?.reports ?? '-'} 份
                </span>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 bg-white p-2.5 rounded-lg border border-slate-200 space-y-1">
              <div className="font-semibold text-slate-700">四項關鍵連線參數守則：</div>
              <ul className="list-disc list-inside space-y-0.5 text-slate-600">
                <li><code className="font-mono">tls=true</code>：強制 TLS 加密傳輸保護房仲個資</li>
                <li><code className="font-mono">directConnection=true</code>：直連單節點 replica set</li>
                <li><code className="font-mono">authSource=e8346c_report</code>：鎖定專屬資料庫認證</li>
                <li><code className="font-mono">maxIdleTimeMS=60000</code>：自動提前回收閒置連線，防止逾時</li>
              </ul>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleCheckStatus}
              disabled={testing}
              className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700 font-semibold hover:bg-slate-50 flex items-center space-x-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
              <span>{testing ? '檢查中...' : '重新檢查 Ping 延遲'}</span>
            </button>

            <button
              type="button"
              onClick={handleReSeed}
              disabled={seedLoading}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-bold flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
            >
              <DatabaseZap className="w-3.5 h-3.5" />
              <span>{seedLoading ? '寫入中...' : '重置示範成屋資料至 MongoDB'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
