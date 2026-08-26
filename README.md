# NID 螢光路跑 GLOW RUN 12K — 報名網站

2026/9/12（六）NID Family Day Vol.3 的活動報名頁。

**線上網址**：https://asafa100m-alt.github.io/nid-glow-run/

## 這個 repo 有什麼

| 檔案 | 說明 |
|---|---|
| `index.html` | 報名頁全部內容（HTML / CSS / JS、圖片以 data URI 內嵌，單檔即可運作）。GitHub Pages 直接發佈這一支。 |
| `apps-script-backend.gs` | 報名後台的**版本控制副本**，供比對與還原用。**不會被執行**。 |

## 系統架構

```
index.html (GitHub Pages)
        │  fetch
        ▼
Google Apps Script Web App  ──►  Google 試算表「12K報名名單」
        │
        └──►  報名確認信（參賽者 / 隊友 / 主辦）
```

後台是 Google Drive 裡的 Apps Script 專案「**9月螢光路跑**」，提供三個端點：

- `?action=quota` — 三組別的剩餘名額（前端報名區即時顯示）
- `?action=print&key=…` — 工作人員列印頁（手環編碼貼紙 + 教練計圈正字表）
- `POST` — 送出報名，寫入試算表並寄出確認信

## 修改流程

**改網頁**：編輯 `index.html` → commit → GitHub Pages 自動重新發佈。

**改後台**：
1. 編輯 `apps-script-backend.gs` 並 commit（保持版本紀錄）
2. 打開 Apps Script 專案，貼上同一份程式碼
3. 把 `__SHEET_ID__` 與 `__PRINT_KEY__` 換成正式值
4. 儲存 → 部署 → 管理部署作業 → 版本選「**建立新版本**」→ 部署

> ⚠️ **兩個容易踩的雷**
> - `apps-script-backend.gs` 裡的 `SHEET_ID` 與 `PRINT_KEY` 是**佔位字串**。這個 repo 是公開的，正式值只存在 Apps Script 專案內，請不要 commit 進來。
> - Apps Script 專案的擁有者是 `events@nidrc.com`。用其他 Google 帳號登入只能編輯、**不能部署**（會出現「您沒有執行這項操作的權限」）。部署前請先切換帳號。

## 賽制

一圈 = 成美長壽橋籃球場 → 沿基隆河跑到成功橋 → 過橋沿對岸河濱跑回籃球場 ＝ **3K**，跑滿 **4 圈 = 12K**。

| 組別 | 跑法 | 名額 |
|---|---|---|
| 個人組 | 1 人跑 4 圈 | 22 人 |
| 兩人接力 | 每人 2 圈 | 15 隊 |
| 四人接力 | 每人 1 圈 | 12 隊 |

三組各取**前三名**，獎品與全員試用包由合作廠商 [Viimun](https://www.viimun.com) 提供。

費用：NID 當期學員免費，非當期學員每人 NT$350（當天現場現金繳）。
