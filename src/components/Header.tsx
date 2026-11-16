import React, { useState } from 'react';
import { Home, Database, UserCheck, ShieldCheck, Settings, CheckCircle2, AlertTriangle, FileText, Phone } from 'lucide-react';
import { BrokerProfile } from '../types/report';

interface HeaderProps {
  broker: BrokerProfile;
  onUpdateBroker: (updated: BrokerProfile) => void;
  dbConfigured: boolean;
  dbStatusText: string;
  onOpenDbSettings: () => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  reportsCount: number;
  propertiesCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  broker,
  onUpdateBroker,
  dbConfigured,
  dbStatusText,
  onOpenDbSettings,
  activeTab,
  onSelectTab,
  reportsCount,
  propertiesCount,
}) => {
  const [showBrokerModal, setShowBrokerModal] = useState(false);
  const [editingBroker, setEditingBroker] = useState<BrokerProfile>(broker);

  const handleSaveBroker = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateBroker(editingBroker);
    setShowBrokerModal(false);
  };

  return (
    <>
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & Brand */}
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => onSelectTab('dashboard')}>
              <div className="w-10 h-10 rounded-xl bg-blue-700 text-white flex items-center justify-center font-bold shadow-sm">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-extrabold text-slate-900 text-lg tracking-tight">房仲報告書</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                    成屋住宅專用
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">台灣房仲雙版評估報告系統（屋主銷售／買方購屋）</p>
              </div>
            </div>

            {/* Quick Navigation Pills */}
            <div className="hidden md:flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-sm font-medium">
              <button
                onClick={() => onSelectTab('dashboard')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'dashboard'
                    ? 'bg-white text-blue-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                報告總覽 ({reportsCount})
              </button>
              <button
                onClick={() => onSelectTab('properties')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'properties'
                    ? 'bg-white text-blue-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                物件管理 ({propertiesCount})
              </button>
              <button
                onClick={() => onSelectTab('creator')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'creator'
                    ? 'bg-white text-blue-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                新增報告
              </button>
              <button
                onClick={() => onSelectTab('editor')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'editor'
                    ? 'bg-white text-blue-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                審閱與微調
              </button>
              <button
                onClick={() => onSelectTab('preview')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'preview'
                    ? 'bg-white text-blue-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                客戶版 A4 預覽
              </button>
            </div>

            {/* Right side status & broker profile */}
            <div className="flex items-center space-x-3">
              {/* Database status button */}
              <button
                onClick={onOpenDbSettings}
                className={`flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                  dbConfigured
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                }`}
                title="點擊配置 MongoDB 或外部資料庫連線"
              >
                <Database className="w-3.5 h-3.5" />
                <span className="font-medium hidden sm:inline">
                  {dbConfigured ? '正式庫連線 (唯讀)' : '正式庫未設定'}
                </span>
                {dbConfigured ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                )}
              </button>

              {/* Broker Profile Pill */}
              <button
                onClick={() => {
                  setEditingBroker(broker);
                  setShowBrokerModal(true);
                }}
                className="flex items-center space-x-2 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition-all group"
              >
                <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                  {(broker.name || '經').slice(0, 1)}
                </div>
                <div className="hidden lg:block text-xs">
                  <div className="font-semibold text-slate-800 leading-tight group-hover:text-blue-600">
                    {broker.name || '未設定經紀人'}
                  </div>
                  <div className="text-slate-500 text-[10px] truncate max-w-[120px]">
                    {broker.storeName || broker.brandName || '點擊設定'}
                  </div>
                </div>
                <Settings className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Broker Profile Configuration Modal */}
      {showBrokerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 no-print">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <UserCheck className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base">經紀人與門市品牌設定</h3>
              </div>
              <button
                onClick={() => setShowBrokerModal(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveBroker} className="p-6 space-y-4 text-sm">
              <p className="text-xs text-slate-500">
                此處資訊將套用於客戶版報告書之封底、頁首品牌與簽章聯絡資訊。
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">經紀人姓名 *</label>
                  <input
                    type="text"
                    required
                    value={editingBroker.name}
                    onChange={(e) => setEditingBroker({ ...editingBroker, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">職稱</label>
                  <input
                    type="text"
                    value={editingBroker.title}
                    onChange={(e) => setEditingBroker({ ...editingBroker, title: e.target.value })}
                    placeholder="空白時於報告中自動隱藏"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">聯絡電話</label>
                  <input
                    type="text"
                    value={editingBroker.phone}
                    onChange={(e) => setEditingBroker({ ...editingBroker, phone: e.target.value })}
                    placeholder="空白時於報告中自動隱藏"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">證照字號</label>
                  <input
                    type="text"
                    value={editingBroker.licenseNumber}
                    onChange={(e) => setEditingBroker({ ...editingBroker, licenseNumber: e.target.value })}
                    placeholder="空白時於報告中自動隱藏"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">加盟店/門市名稱</label>
                  <input
                    type="text"
                    value={editingBroker.storeName}
                    onChange={(e) => setEditingBroker({ ...editingBroker, storeName: e.target.value })}
                    placeholder="空白時於報告中自動隱藏"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">品牌/體系名稱</label>
                  <input
                    type="text"
                    value={editingBroker.brandName}
                    onChange={(e) => setEditingBroker({ ...editingBroker, brandName: e.target.value })}
                    placeholder="空白時於報告中自動隱藏"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">電子郵件</label>
                <input
                  type="email"
                  value={editingBroker.email}
                  onChange={(e) => setEditingBroker({ ...editingBroker, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">品牌 LOGO 圖片網址 (選填，未提供時顯示文字品牌)</label>
                <input
                  type="url"
                  placeholder="https://example.com/logo.png"
                  value={editingBroker.brandLogoUrl || ''}
                  onChange={(e) => setEditingBroker({ ...editingBroker, brandLogoUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBrokerModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-medium shadow-xs"
                >
                  儲存經紀人資料
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
