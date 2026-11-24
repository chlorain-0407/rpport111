# 房仲報告書

本專案從 GitHub 儲存庫根目錄部署。正式服務以 Node.js 啟動 Express，提供前端靜態檔案與 API。

| 用途 | 指令 |
| --- | --- |
| 測試環境 | `npm run dev -- --host 0.0.0.0 --port 3000` |
| 建置 | `npm run build` |
| 預覽建置產物 | `npm run preview -- --host 0.0.0.0 --port 3000` |
| 正式環境 | `npm start` |

伺服器一律綁定 `0.0.0.0`，先使用平台注入的 `PORT`，其次使用 `--port`，兩者都未提供時使用 `3000`。預覽與正式啟動前需先建置。

## 平台環境變數

| 鍵名 | 何時設定 |
| --- | --- |
| `GEMINI_API_KEY` | 使用 AI 擷取、補齊或生成報告時設定。 |
| `MONGODB_URI` | 正式儲存物件、報告與設定時需要。平台已連結資料庫時沿用平台注入的設定。 |
| `PORT` | 平台注入時沿用。 |
| `PACIFIC_CHROMIUM_PATH` | 選填。平台已提供相容的 Chromium 時，填入容器內可執行檔的絕對路徑。 |
| `DISABLE_HMR` | 選填。`true` 會在開發環境關閉 Vite 的熱更新及檔案監看。 |

機密由伺服器從環境變數讀取。物件與報告資料使用 MongoDB 持久化。截圖僅在當次文字或圖片擷取請求中處理。太平洋房屋網址擷取依賴能在代管容器執行的 Chromium。瀏覽器資料夾用途為暫存。如果瀏覽器無法執行，仍可使用原頁文字或截圖校對。

目前沒有 webhook 或需要持久化排程的背景工作。

## App 市集

平台 SDK 已接入，會員資料以平台 user.uuid 分隔。上架登記、公開路徑與刪除資料方式見 [MARKETPLACE.md](MARKETPLACE.md)。

使用 Node.js 20 以上及 npm。以 npm ci 安裝 package-lock.json 鎖定的依賴，再執行 npm run build 及 npm start。會員資料不會自動接收舊的未歸屬資料。
