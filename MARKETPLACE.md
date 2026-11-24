# AI 研究所 App 市集整合

## 身分與資料
Express 在所有路由之前執行 createAcademy().express()，SDK 自動處理 /__academy/selfcheck。
/api/me 回傳平台驗證後的 user、entitlement 和 env，前端顯示會員名稱。
會員資料的 userUuid 一律由 req.academy.user.uuid 寫入，查詢、更新與刪除由同一層強制加上此條件。
會員資料使用 member_ 前綴的七個集合。原有未標會員的集合保留給舊流程，平台會員不會自動取得原有資料。
本專案原本沒有獨立登入驗證或帳密登入畫面。req.academy 為 null 時保留原有單一資料區流程。
啟用市集時所有會員頁面與 /api 都必須保留平台登入關卡，請勿登記成公開路徑。
目前資料沒有店別共用機制，各會員的經紀人設定、物件與報告各自獨立。
既有資料若要移轉，須先確認實際擁有人，再以管理作業搬移到指定會員資料區。

## 依會員刪除
src/server/db.ts 的 deleteUserData(userUuid) 刪除七個會員集合中指定會員的全部文件，可重試。
這是可信任後端管理流程呼叫的函式。沒有提供可帶任意會員編號的公開刪除 API。
原有未歸屬資料不會自動移轉，也不會因會員刪除而被清除。

## 公開路徑登記
只登記 GET /api/health，回傳服務狀態與設定存在與否，不含會員資料。
/__academy/selfcheck 由平台 SDK 自動處理，供平台上架自檢，沿用平台自檢驗證。
/、/assets/*、/api/me 和其餘 /api/* 保留平台入口驗證。
目前沒有 webhook，沒有需要登記的 webhook 公開路徑。

## 程式用戶端與服務登記
目前沒有瀏覽器擴充功能、桌面程式、手機程式或外部服務整合。
用戶端名稱、用途、轉址網址清單為空。
服務名稱、用途、資料目的地清單為空。
平台驗證的會員用戶端若日後登記，可使用現有會員 API，身分仍從 req.academy 取得。
目前所有 req.academyService 請求以 403 拒絕。日後新增服務介面時須指定 service.key，並先呼叫 academy.members.entitlement(userUuid) 確認 active 後才操作會員資料。

## 平台錯誤
前端對自己的 /api 回應統一處理 LOGIN_REQUIRED、SUBSCRIPTION_REQUIRED、INSUFFICIENT_POINTS。
401 或 403 會依平台提供的 login_url 或 subscribe_url 整頁轉址。
402 會顯示點數不足及 upgrade_url 連結。
平台 SDK 自己驗證身分失敗時會回 null，因此依 SDK 過渡規則保留舊流程。平台啟用後的入口驗證必須在代管平台保持啟用。

## 設定與 AI
Node.js 20 以上。安裝 @agentgo-tw/app-sdk。
程式與專案檔案沒有設定 ACADEMY_ 變數，使用 SDK 的 createAcademy() 預設讀取平台注入值。
保留 Gemini 供應商，GEMINI_API_KEY 與 MONGODB_URI 僅後端讀取。
本次沒有改用平台 AI，因此現有 Gemini 呼叫仍使用應用程式設定的 Gemini 額度。
Chromium 的容器相容性仍需由部署環境提供。

## 依賴檢查
本次 npm install 額外調整 esbuild 至與 Vite 8.3 相容的版本。npm audit 回報既有 Puppeteer／chromium-bidi／zod 相依鏈有三項 high，需另行評估與相容的 Chromium 版本一起升級。
