# life_is_hard_line_bot

這是一個基於 Google Apps Script (GAS) 與 LINE Bot Messaging API 所打造的自動化訊息推播。

#### 核心功能

1. **自動化網路爬蟲 (Web Scraping)**
   - 內建排程爬蟲機制 (`scrapeAndSaveToSheet`)，可自動從 The Fact Site 多個熱門分類頁面抓取最新的冷知識內容與圖片。
   - 自動過濾重複內容，確保寫入 Google 試算表的資料皆為獨一無二的新知。

2. **智慧化指定發送日期**
   - **指定日期優先**：系統執行時會先比對當前日期，若試算表中存在當天專屬的 PENDING 資料，將優先隨機抽出一筆進行發送。
   - **無指定日期時備用隨機**：若當天沒有特定日期的排程內容，則自動轉為搜尋 Target Date 為空白的通用資料，並從中隨機抽樣一筆。

3. **狀態同步與例外防護**
   - 當訊息成功推播至 LINE 後，系統會自動將該筆資料的狀態由 PENDING 更新為 SENT，並同步記錄發送的時間戳記（Asia/Taipei）。
   - 若試算表中已無任何 PENDING 資料，會自動透過 LINE Push 主動推送警報訊息提醒開發者。

#### 試算表欄位結構 (Sheet Schema)

* **Column A (Text)**：冷知識內文
* **Column B (Image URL)**：圖片連結（可空白）
* **Column C (Status)**：發送狀態 (`PENDING` / `SENT`)
* **Column D (Sent Timestamp)**：發送時間戳記
* **Column E (Line Alert)**：自訂 LINE 通知預覽文字 (altText)
* **Column F (Target Date)**：指定發送日期（格式：`MM/DD`，如 `10/28`；空白代表通用隨機）

#### 核心函式說明

* `dailyBroadcastFromSheet()` - 每日自動廣播的主要執行函式。
* `scrapeAndSaveToSheet()` - 批次爬取網站冷知識並寫入試算表的主要執行函式。
* `testPushToMe()` - 開發者手動測試推播函式。
* `getRandomPendingFact(sheet)` - 智慧型資料抽選核心（優先比對當天日期，其次隨機抽選）。
* `buildFlexMessagePayload(altText, text, imageUrl)` - LINE Flex Message 訊息結構建構器。
* `sendTextPushNotification(messageText)` - 發送文字警告通知給開發者的例外處理函式。
* `cleanHtml(html)` - HTML 標籤淨化與特殊字元還原工具。
* `withRetry(fn, maxAttempts, delayMs)` - 確保網路與 API 穩定執行的自動重試包裝器。