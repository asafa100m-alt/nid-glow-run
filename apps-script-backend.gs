// ⚠️ 這份是 Apps Script 後台的版本控制副本（供比對 / 還原用）。
//    SHEET_ID 與 PRINT_KEY 已抽換成佔位字串，正式值只存在 Apps Script 專案內。
//    專案：Google Drive →「9月螢光路跑」Apps Script

/**
 * NID 螢光路跑 GLOW RUN 12K — 報名後台 (v5)
 * 擁有 / 執行帳號：events@nidrc.com
 *
 * 前端 index.html 合約：
 *   GET  ?action=quota  -> { solo:{left,total,unit}, duo:{...}, quad:{...} }
 *   GET  ?action=print&key=PRINT_KEY -> 列印頁（手環編碼貼紙 + 教練計圈正字表）
 *   POST (JSON body)    -> { status:"ok", codes:[...] } 成功
 *                          { status:"full", category } 該組別額滿
 *                          { status:"error", message } 資料不合格、重複報名、太頻繁
 *
 * 賽制：
 *   一圈 = 成美長壽橋籃球場 → 南岸往東到成功橋 → 過橋走北岸往西 → 成美長壽橋過河回起點 ＝ 3K，跑滿 4 圈 ＝ 12K
 *   個人組   1 人跑 4 圈   · 22 個名額
 *   兩人接力 1 人跑 2 圈   · 15 隊名額
 *   四人接力 1 人跑 1 圈   · 12 隊名額
 *   三組各取前三名，獎品由合作廠商 Viimun 提供；每位參賽者另有派對侍者乙包（價值 100 元）
 *   報名截止：2026/9/9 24:00（REG_DEADLINE），截止後 POST 一律回 status:"closed" 
 *
 * 名單編碼：個人 A01…／兩人 B01-1、B01-2…／四人 C01-1…C01-4
 *          列印頁把編碼剪下貼在（黃色）螢光手環上，教練依名單畫正字記圈。
 *
 * 資料表：三個組別各一個分頁（個人組 / 兩人接力 / 四人接力），欄位完全相同。
 *         每一位參賽者一列（接力隊伍會有多列，用同一個「隊伍編號」串起來）。
 */

// ─────────────── 寄信設定 ───────────────
const ADMIN_EMAIL          = 'events@nidrc.com';
const SEND_ADMIN_NOTICE    = true;   // 主辦通知
const SEND_RUNNER_CONFIRM  = true;   // 每位參賽者確認信
const EVENT_NAME           = 'NID 螢光路跑 GLOW RUN 12K';
const SENDER_NAME          = 'NID RUN CLUB';
// 活動資訊（會出現在每封信裡）
const EVENT_DATETIME = '2026/9/12（六）17:30 報到領手環 · 18:00 一起開跑（活動至 19:30）';
const EVENT_LOCATION = '成美長壽橋籃球場（起點 / 終點 / 接力交接區都在這裡）';
const EVENT_ROUTE    = '成美長壽橋籃球場 → 沿南岸往東到成功橋 → 過橋沿北岸往西 → 從成美長壽橋過河回到起點 ＝ 一圈 3K，跑滿 4 圈 ＝ 12K';
// 合作廠商
const SPONSOR_NAME = 'Viimun';
const SPONSOR_URL  = 'https://www.viimun.com';
// 參加禮與各組前三名獎品（換獎品改這裡）
const GIFT_ALL   = '派對侍者 乙包（價值 NT$100）';
const PRIZES = [
  { rank: '第一名', item: '派對侍者 乙盒 ＋ 夜寧使者 乙盒', value: 'NT$1,398' },
  { rank: '第二名', item: '派對侍者 乙盒',                   value: 'NT$799'   },
  { rank: '第三名', item: '夜寧使者 乙盒',                   value: 'NT$599'   }
];
const LINE_GROUP_URL    = 'https://line.me/ti/g2/5BBOmVbrCiD6m8Uzy6xigwzM1qihEJ_U0JUcKA?utm_source=invitation&utm_medium=link_copy&utm_campaign=default'; // 活動 LINE 社群（當天公告用）
const LINE_OFFICIAL_URL = 'https://page.line.me/eei8717i'; // NID 官方 LINE（詢問／取消／改期）
// ───────────────────────────────────────

// 報名截止：2026/9/9 24:00（＝9/10 00:00 之前都可報名）
const REG_DEADLINE      = new Date('2026-09-09T23:59:59+08:00');
const REG_DEADLINE_TEXT = '2026/9/9（三）24:00';

const SHEET_ID   = '__SHEET_ID__';   // 實際值只設在 Apps Script 專案裡，不放進這個公開 repo
// 三個組別各自一個分頁，報名進來就寫到對應的那一頁
const SHEET_NAMES = {
  '個人組':   '個人組',
  '兩人接力': '兩人接力',
  '四人接力': '四人接力'
};

// 列印頁鑰匙：網址要帶 ?action=print&key=<這串>，避免名單被路過的人看到
const PRINT_KEY = '__PRINT_KEY__';   // 實際值只設在 Apps Script 專案裡，不放進這個公開 repo

const NON_MEMBER      = '非 NID 當期學員';
const FEE_PER_PERSON  = 350;
const LAP_KM          = 3;
const TOTAL_LAPS      = 4;

// size = 一隊幾個人；quota = 名額（個人組算人、接力組算隊）；laps = 每人負責幾圈
const CATEGORIES = {
  '個人組':   { size: 1, quota: 22, prefix: 'A', unit: '人', laps: 4, key: 'solo' },
  '兩人接力': { size: 2, quota: 15, prefix: 'B', unit: '隊', laps: 2, key: 'duo'  },
  '四人接力': { size: 4, quota: 12, prefix: 'C', unit: '隊', laps: 1, key: 'quad' }
};
const CATEGORY_ORDER = ['個人組', '兩人接力', '四人接力'];

const ALLOWED_CLUBS = [
  '凱為戰隊', '承勳戰隊', '姚姚戰隊', '佩珊戰隊', '明志戰隊',
  '竺均戰隊', '智遠戰隊', '阿飛戰隊', '柏鈞戰隊', '肯尼戰隊',
  NON_MEMBER
];
const ALLOWED_REASON = [
  '想認識更多 NID 的夥伴', '覺得螢光路跑主題很特別', '想挑戰 12K',
  '想跟隊友一起接力拚名次', '想穿發光造型跑一場', '教練/朋友揪我來'
];

// ───────────── 防呆設定 ─────────────
const MAX_LEN_NAME       = 40;
const MAX_LEN_EMAIL      = 100;
const MAX_LEN_TEAMNAME   = 40;
const MAX_LEN_PHONE      = 30;
const MAX_SUBMITS_PER_MIN = 60;

const HEADERS = [
  '報名時間', '組別', '隊伍編號', '隊伍名稱', '棒次', '手環編碼',
  '姓名', '隸屬戰隊', 'Email', '電話', '緊急聯絡人', '緊急聯絡電話',
  '需繳費', '金額', '已收款', '負責圈數', '完賽名次',
  '報名原因', '代表人Email'
];
const C = {};   // 欄位名 -> 1-based 欄號
HEADERS.forEach(function (h, i) { C[h] = i + 1; });

function getSheet_(cat) {
  const name = SHEET_NAMES[cat];
  if (!name) throw new Error('未知的組別：' + cat);
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const last = sheet.getLastRow();
  if (last === 0) {
    sheet.appendRow(HEADERS);
    formatSheet_(sheet);
  } else if (last === 1) {
    // 只有表頭、還沒有報名資料 —— 欄位定義若有調整就直接補上
    const cur = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0]
                     .slice(0, HEADERS.length).join('\u0001');
    if (cur !== HEADERS.join('\u0001')) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      formatSheet_(sheet);
    }
  }
  return sheet;
}

// 欄寬（對應 HEADERS 的順序）
const COL_WIDTHS = [150, 90, 80, 130, 55, 90, 100, 130, 200, 110, 100, 115, 70, 70, 70, 75, 80, 220, 200];

/**
 * 把名單整理成當天現場好用的樣子：
 * 凍結＋加粗標題、設欄寬、「已收款」變核取方塊、「完賽名次」變下拉、
 * 並把「要收錢但還沒收」的列標成淡紅色。
 * 只動格式與驗證，不會動到任何報名資料。
 */
function formatSheet_(sheet) {
  const n = HEADERS.length;
  sheet.setFrozenRows(1);

  sheet.getRange(1, 1, 1, n)
       .setFontWeight('bold')
       .setFontColor('#ffffff')
       .setBackground('#2b3157')
       .setVerticalAlignment('middle')
       .setWrap(false);
  sheet.setRowHeight(1, 32);

  COL_WIDTHS.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  const maxRows = sheet.getMaxRows();
  if (maxRows < 2) return;
  const bodyRows = maxRows - 1;

  // 已收款 -> 核取方塊（現場點一下就好）
  sheet.getRange(2, C['已收款'], bodyRows, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
       .setHorizontalAlignment('center');

  // 完賽名次 -> 下拉，但仍可自行輸入
  sheet.getRange(2, C['完賽名次'], bodyRows, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireValueInList(['1', '2', '3', '完賽', '未完賽', '棄賽'], true)
         .setAllowInvalid(true).build())
       .setHorizontalAlignment('center');

  // 電話欄位一律當文字，開頭的 0 才不會不見
  sheet.getRange(2, C['電話'], bodyRows, 1).setNumberFormat('@');
  sheet.getRange(2, C['緊急聯絡電話'], bodyRows, 1).setNumberFormat('@');

  // 「需繳費 = 是」但「已收款」還沒打勾 -> 整列淡紅，收錢時一眼就看到
  const body = sheet.getRange(2, 1, bodyRows, n);
  const col1 = colA1_(C['需繳費']);
  const col2 = colA1_(C['已收款']);
  const formula = '=AND(' + '$' + col1 + '2="是", ' + '$' + col2 + '2<>TRUE)';
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground('#fdeaea')
    .setRanges([body])
    .build();
  // 先移掉自己上次加的同一條規則，避免重複執行時越疊越多
  const kept = sheet.getConditionalFormatRules().filter(function (r) {
    const c = r.getBooleanCondition();
    if (!c) return true;
    return String(c.getCriteriaValues()[0] || '') !== formula;
  });
  kept.push(rule);
  sheet.setConditionalFormatRules(kept);
}

// 1 -> 'A', 2 -> 'B' …（欄號轉 A1 表示法）
function colA1_(idx) {
  let s = '';
  while (idx > 0) { const m = (idx - 1) % 26; s = String.fromCharCode(65 + m) + s; idx = (idx - m - 1) / 26; }
  return s;
}

/**
 * 一鍵整理全部分頁：三個報名分頁排版 ＋ 重建「手環編碼貼紙」「教練計圈表」。
 * 平常不用跑（資料是公式連動的）；報名截止後跑一次，列印用的空白列會收乾淨。
 */
function setupSheet() {
  const names = [];
  CATEGORY_ORDER.forEach(function (cat) {
    formatSheet_(getSheet_(cat));
    names.push(SHEET_NAMES[cat]);
  });
  const printed = buildRaceDaySheets();
  return '已整理：' + names.join('、') + ' ｜ ' + printed;
}

// 讀出單一分頁的報名資料列（不含表頭）
function sheetRows_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
}

// 讀出三個分頁的所有報名資料列
// 名額、Email 重複、隊伍編號都要看全部，所以一律用這個
function allRows_() {
  let out = [];
  CATEGORY_ORDER.forEach(function (cat) {
    out = out.concat(sheetRows_(getSheet_(cat)));
  });
  return out;
}

// 每個組別已經用掉幾個名額（個人組算人、接力組算不重複的隊伍編號）
function usedByCategory_(rows) {
  const seen = {};
  const used = {};
  CATEGORY_ORDER.forEach(function (c) { used[c] = 0; seen[c] = {}; });
  rows.forEach(function (r) {
    const cat = String(r[C['組別'] - 1] || '').trim();
    const no  = String(r[C['隊伍編號'] - 1] || '').trim();
    if (!CATEGORIES[cat] || !no) return;
    if (!seen[cat][no]) { seen[cat][no] = true; used[cat]++; }
  });
  return used;
}

function quotaSnapshot_(rows) {
  const used = usedByCategory_(rows);
  const out = {};
  CATEGORY_ORDER.forEach(function (cat) {
    const cfg = CATEGORIES[cat];
    out[cfg.key] = {
      category: cat,
      left: Math.max(cfg.quota - used[cat], 0),
      total: cfg.quota,
      unit: cfg.unit
    };
  });
  return out;
}

// 下一個隊伍編號，例如 A01 / B07 / C12
function nextTeamNo_(rows, cat) {
  const cfg = CATEGORIES[cat];
  // 取「現有最大號 + 1」，不能用數量+1：
  // 若中途刪掉某一隊（有人取消），數量會變少，下一號就會跟現有隊伍撞號。
  let max = 0;
  rows.forEach(function (r) {
    if (String(r[C['組別'] - 1] || '').trim() !== cat) return;
    const m = String(r[C['隊伍編號'] - 1] || '').trim().match(/^([A-Z])(\d+)$/);
    if (m && m[1] === cfg.prefix) max = Math.max(max, Number(m[2]));
  });
  const n = max + 1;
  return cfg.prefix + (n < 10 ? '0' + n : String(n));
}

// 報名是否已截止
function regClosed_() {
  return new Date().getTime() > REG_DEADLINE.getTime();
}

// 手環編碼：個人組就是隊伍編號；接力組是「隊伍編號-棒次」
function bibCode_(cat, teamNo, seat) {
  return CATEGORIES[cat].size === 1 ? teamNo : (teamNo + '-' + seat);
}

// ───────────── 防呆小工具 ─────────────

// 去掉控制字元、收斂空白、限制長度
function clean_(v, maxLen) {
  const s = (v === null || v === undefined) ? '' : String(v);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += (c < 32 || c === 127) ? ' ' : s.charAt(i);
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (maxLen && out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

// 阻擋試算表公式注入：開頭是 = + - @ 就補一個單引號
function safeCell_(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// HTML 轉義，避免內容在信件 / 列印頁裡變成可點擊的連結或標籤
function esc_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '')); }
function isPhone_(s) { return /^[0-9+\-\s()]{8,}$/.test(String(s || '')); }

// 全站每分鐘送出上限（跑瘋掉時的保險）
function rateLimited_() {
  try {
    const cache = CacheService.getScriptCache();
    const key = 'rl_' + Math.floor(new Date().getTime() / 60000);
    const n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), 180);
    return n > MAX_SUBMITS_PER_MIN;
  } catch (err) {
    return false;
  }
}

// 這個 Email 是不是已經報過名了（不分組別，全表比對）
function findDuplicateEmail_(rows, emails) {
  const set = {};
  rows.forEach(function (r) {
    const e = String(r[C['Email'] - 1] || '').trim().toLowerCase();
    if (e) set[e] = true;
  });
  for (let i = 0; i < emails.length; i++) {
    if (set[emails[i]]) return emails[i];
  }
  return '';
}

/**
 * 伺服器端驗證：回傳 { ok, message, d }
 * d = { category, teamName, reason, members:[{seat,name,club,email,fee}] }
 */
function validate_(raw) {
  const d = {};

  d.category = clean_(raw.category, 10);
  const cfg = CATEGORIES[d.category];
  if (!cfg) return { ok: false, message: '請選擇報名組別（個人組、兩人接力或四人接力）。' };

  if (cfg.size > 1) {
    d.teamName = clean_(raw.teamName, MAX_LEN_TEAMNAME);
    if (!d.teamName) return { ok: false, message: '接力組請填寫隊伍名稱。' };
  } else {
    d.teamName = '';
  }

  d.reason = clean_(raw.reason, 60);
  if (ALLOWED_REASON.indexOf(d.reason) === -1) return { ok: false, message: '請從清單選擇參加原因。' };

  if (clean_(raw.agree, 10) !== '是') {
    return { ok: false, message: '請先勾選「我已閱讀並同意活動注意事項」。' };
  }

  // 第 1 棒 = 報名代表人，用 name / club / email；第 2 棒之後用 memberNName / memberNClub / memberNEmail
  const members = [];
  const seenEmail = {};
  for (let seat = 1; seat <= cfg.size; seat++) {
    const nameKey  = seat === 1 ? 'name'  : 'member' + seat + 'Name';
    const clubKey  = seat === 1 ? 'club'  : 'member' + seat + 'Club';
    const emailKey = seat === 1 ? 'email' : 'member' + seat + 'Email';
    const phoneKey = seat === 1 ? 'phone'    : 'member' + seat + 'Phone';
    const emgNKey  = seat === 1 ? 'emgName'  : 'member' + seat + 'EmgName';
    const emgPKey  = seat === 1 ? 'emgPhone' : 'member' + seat + 'EmgPhone';
    const who = seat === 1 ? '報名代表人' : ('第 ' + seat + ' 棒');

    const name  = clean_(raw[nameKey], MAX_LEN_NAME);
    const club  = clean_(raw[clubKey], MAX_LEN_NAME);
    const email = clean_(raw[emailKey], MAX_LEN_EMAIL).toLowerCase();
    const phone = clean_(raw[phoneKey], MAX_LEN_PHONE);
    const emgName  = clean_(raw[emgNKey], MAX_LEN_NAME);
    const emgPhone = clean_(raw[emgPKey], MAX_LEN_PHONE);

    if (!name)  return { ok: false, message: '請填寫' + who + '的姓名。' };
    if (ALLOWED_CLUBS.indexOf(club) === -1) return { ok: false, message: '請從清單選擇' + who + '的隸屬戰隊。' };
    if (!isEmail_(email)) return { ok: false, message: who + '的 Email 格式不正確。' };
    if (!isPhone_(phone)) return { ok: false, message: '請填寫' + who + '的手機號碼（至少 8 位數字）。' };
    if (!emgName) return { ok: false, message: '請填寫' + who + '的緊急聯絡人姓名。' };
    if (!isPhone_(emgPhone)) return { ok: false, message: who + '的緊急聯絡人電話格式不正確。' };
    if (seenEmail[email]) return { ok: false, message: '同一隊裡的 Email 不能重複（' + email + '）。' };
    seenEmail[email] = true;

    members.push({
      seat: seat,
      name: name,
      club: club,
      email: email,
      phone: phone,
      emgName: emgName,
      emgPhone: emgPhone,
      fee: (club === NON_MEMBER) ? FEE_PER_PERSON : 0
    });
  }
  d.members = members;
  d.feeTotal = members.reduce(function (s, m) { return s + m.fee; }, 0);
  return { ok: true, d: d };
}

function rowsFromData_(d, teamNo, stamp) {
  const cfg = CATEGORIES[d.category];
  return d.members.map(function (m) {
    const row = [];
    row[C['報名時間'] - 1]   = stamp;
    row[C['組別'] - 1]       = d.category;
    row[C['隊伍編號'] - 1]   = teamNo;
    row[C['隊伍名稱'] - 1]   = safeCell_(d.teamName);
    row[C['棒次'] - 1]       = m.seat;
    row[C['手環編碼'] - 1]   = bibCode_(d.category, teamNo, m.seat);
    row[C['姓名'] - 1]       = safeCell_(m.name);
    row[C['隸屬戰隊'] - 1]   = m.club;
    row[C['Email'] - 1]      = safeCell_(m.email);
    // 前面加單引號強制存成文字，否則 09xxxxxxxx 會被試算表當數字、開頭的 0 會不見
    row[C['電話'] - 1]       = m.phone ? "'" + m.phone : '';
    row[C['緊急聯絡人'] - 1]   = safeCell_(m.emgName);
    row[C['緊急聯絡電話'] - 1] = m.emgPhone ? "'" + m.emgPhone : '';
    row[C['已收款'] - 1]      = '';
    row[C['完賽名次'] - 1]    = '';
    row[C['需繳費'] - 1]     = m.fee > 0 ? '是' : '否';
    row[C['金額'] - 1]       = m.fee;
    row[C['負責圈數'] - 1]   = cfg.laps;
    row[C['報名原因'] - 1]   = d.reason;
    row[C['代表人Email'] - 1] = safeCell_(d.members[0].email);
    return row;
  });
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ───────────── 信件內容（所有變數都經過 esc_ 轉義）─────────────

function eventInfoBlock_(cat) {
  const cfg = CATEGORIES[cat];
  return '<div style="margin:14px 0;padding:12px 14px;background:#f5f0ff;border:1px solid #e0d5ff;border-radius:10px;font-size:14px;line-height:1.8">'
    + '<b>🗓 時間：</b>' + esc_(EVENT_DATETIME) + '<br>'
    + '<b>📍 地點：</b>' + esc_(EVENT_LOCATION) + '<br>'
    + '<b>🛣 路線：</b>' + esc_(EVENT_ROUTE) + '<br>'
    + '<b>🏃 組別：</b>' + esc_(cat) + '（' + esc_(cfg.laps) + ' 圈 ＝ ' + esc_(cfg.laps * LAP_KM) + 'K，全隊共 ' + TOTAL_LAPS + ' 圈 12K）'
    + '</div>';
}

function bibBlock_(code) {
  return '<div style="margin:14px 0;padding:16px;background:#160a2e;border-radius:12px;text-align:center;color:#ecff3a">'
    + '<div style="font-size:12px;letter-spacing:.2em;opacity:.8">你的手環編碼</div>'
    + '<div style="font-size:38px;font-weight:900;letter-spacing:.06em">' + esc_(code) + '</div>'
    + '<div style="font-size:12px;opacity:.8">報到時工作人員會把它貼在你的黃色螢光手環上</div>'
    + '</div>';
}

function row_(k, v) {
  return '<tr><td style="border:1px solid #ddd;background:#f7f7f7;padding:6px"><b>' + esc_(k) + '</b></td>'
    + '<td style="border:1px solid #ddd;padding:6px">' + esc_(v == null ? '' : v) + '</td></tr>';
}

function teamTable_(d, teamNo) {
  let html = '<table style="border-collapse:collapse;font-size:14px">'
    + '<tr><td style="border:1px solid #ddd;background:#f7f7f7;padding:6px"><b>棒次</b></td>'
    + '<td style="border:1px solid #ddd;background:#f7f7f7;padding:6px"><b>手環編碼</b></td>'
    + '<td style="border:1px solid #ddd;background:#f7f7f7;padding:6px"><b>姓名</b></td>'
    + '<td style="border:1px solid #ddd;background:#f7f7f7;padding:6px"><b>戰隊</b></td>'
    + '<td style="border:1px solid #ddd;background:#f7f7f7;padding:6px"><b>電話</b></td>'
    + '<td style="border:1px solid #ddd;background:#f7f7f7;padding:6px"><b>緊急聯絡人</b></td>'
    + '<td style="border:1px solid #ddd;background:#f7f7f7;padding:6px"><b>材料費</b></td></tr>';
  d.members.forEach(function (m) {
    html += '<tr>'
      + '<td style="border:1px solid #ddd;padding:6px">' + esc_(m.seat) + '</td>'
      + '<td style="border:1px solid #ddd;padding:6px"><b>' + esc_(bibCode_(d.category, teamNo, m.seat)) + '</b></td>'
      + '<td style="border:1px solid #ddd;padding:6px">' + esc_(m.name) + '</td>'
      + '<td style="border:1px solid #ddd;padding:6px">' + esc_(m.club) + '</td>'
      + '<td style="border:1px solid #ddd;padding:6px">' + esc_(m.phone) + '</td>'
      + '<td style="border:1px solid #ddd;padding:6px">' + esc_(m.emgName) + ' ' + esc_(m.emgPhone) + '</td>'
      + '<td style="border:1px solid #ddd;padding:6px">' + (m.fee > 0 ? 'NT$' + m.fee : '免費') + '</td>'
      + '</tr>';
  });
  return html + '</table>';
}

function feeLine_(d) {
  if (d.feeTotal <= 0) {
    return '<p style="font-size:14px">💵 全隊都是 NID 當期學員，當天不用繳材料費 🎉</p>';
  }
  return '<p style="font-size:14px">💵 當天報到時需繳材料費 <b>NT$' + esc_(d.feeTotal) + '</b>'
    + '（非當期學員每人 NT$' + FEE_PER_PERSON + '），<b>現場現金繳款</b>即可，免轉帳。</p>';
}

function adminBody_(d, teamNo) {
  return ''
    + '<h3 style="margin:0 0 8px">🏃 新報名通知</h3>'
    + eventInfoBlock_(d.category)
    + '<table style="border-collapse:collapse;font-size:14px">'
    + row_('組別', d.category)
    + row_('隊伍編號', teamNo)
    + row_('隊伍名稱', d.teamName || '（個人組）')
    + row_('人數', d.members.length)
    + row_('報名原因', d.reason)
    + row_('應收材料費', d.feeTotal > 0 ? 'NT$' + d.feeTotal : '0（全員學員）')
    + row_('參加禮份數', d.members.length + ' 份（' + GIFT_ALL + '）')
    + '</table>'
    + '<p style="font-size:14px;margin-top:16px"><b>隊伍名單</b></p>'
    + teamTable_(d, teamNo);
}

function runnerBody_(d, teamNo, m) {
  const cfg = CATEGORIES[d.category];
  const isSolo = cfg.size === 1;
  return ''
    + '<div style="font-size:15px;line-height:1.7">'
    + '<p>' + esc_(m.name) + ' 你好，</p>'
    + '<p>你報名的「<b>' + esc_(EVENT_NAME) + '</b>」已成功收到 🎉<br>'
    + '組別：<b>' + esc_(d.category) + '</b>'
    + (isSolo ? '' : '　隊伍：<b>' + esc_(d.teamName) + '</b>（第 ' + esc_(m.seat) + ' 棒）')
    + '</p>'
    + bibBlock_(bibCode_(d.category, teamNo, m.seat))
    + eventInfoBlock_(d.category)
    + '<p style="font-size:14px">🏁 <b>怎麼記圈：</b>每跑回成美長壽橋籃球場算一圈，教練會依照名單上的手環編碼畫正字。'
    + '你負責 <b>' + esc_(cfg.laps) + ' 圈</b>（' + esc_(cfg.laps * LAP_KM) + 'K）'
    + (isSolo ? '' : '，接力交接就在籃球場終點線')
    + '。全隊跑滿 ' + TOTAL_LAPS + ' 圈 12K 即完賽。</p>'
    + '<p style="font-size:14px">🎁 <b>參加禮：</b>每位參賽者都會拿到合作廠商 '
    + '<a href="' + esc_(SPONSOR_URL) + '">' + esc_(SPONSOR_NAME) + '</a> 提供的 <b>' + esc_(GIFT_ALL) + '</b>。</p>'
    + '<p style="font-size:14px">🏆 個人組、兩人接力、四人接力<b>各取前三名</b>，獎品由 '
    + esc_(SPONSOR_NAME) + ' 提供：</p>'
    + prizeTable_()
    + '<p style="font-size:14px">跑完別急著走，一起等頒獎！</p>'
    + (isSolo ? feeLine_({ feeTotal: m.fee })
              : '<p style="font-size:14px">💵 你的材料費：' + (m.fee > 0 ? '<b>NT$' + esc_(m.fee) + '</b>（非當期學員），當天報到時現場現金繳款' : '免費（NID 當期學員）') + '。</p>')
    + (isSolo ? '' : teamTable_(d, teamNo))
    + '<p>當天集合地點、注意事項都會在活動 LINE 社群公告，請務必加入：<br>'
    + '<a href="' + esc_(LINE_GROUP_URL) + '">加入活動 LINE 社群</a></p>'
    + '<p style="font-size:14px">需要<b>取消或更換隊友</b>，請私訊 '
    + '<a href="' + esc_(LINE_OFFICIAL_URL) + '">NID 官方 LINE</a>。</p>'
    + '<p style="margin-top:20px">— ' + esc_(SENDER_NAME) + '</p></div>';
}

function prizeTable_() {
  let html = '<table style="border-collapse:collapse;font-size:14px;margin:6px 0 12px">';
  const medal = ['🥇', '🥈', '🥉'];
  PRIZES.forEach(function (p, i) {
    html += '<tr>'
      + '<td style="border:1px solid #ddd;background:#f7f7f7;padding:6px;white-space:nowrap"><b>' + medal[i] + ' ' + esc_(p.rank) + '</b></td>'
      + '<td style="border:1px solid #ddd;padding:6px">' + esc_(p.item) + '</td>'
      + '<td style="border:1px solid #ddd;padding:6px;white-space:nowrap">價值 ' + esc_(p.value) + '</td>'
      + '</tr>';
  });
  return html + '</table>';
}

function sendNotifications_(d, teamNo) {
  // 1) 主辦通知
  if (SEND_ADMIN_NOTICE) {
    try {
      MailApp.sendEmail({
        to: ADMIN_EMAIL,
        subject: '【' + EVENT_NAME + '｜新報名】' + d.category + ' ' + teamNo + '　' + d.members[0].name
                 + '（' + d.members.length + ' 人）',
        htmlBody: adminBody_(d, teamNo),
        name: SENDER_NAME
      });
    } catch (err) { Logger.log('主辦通知信寄送失敗：' + err); }
  }
  // 2) 每位參賽者各自的確認信（含自己的手環編碼）
  if (SEND_RUNNER_CONFIRM) {
    const sent = {};
    d.members.forEach(function (m) {
      if (!isEmail_(m.email) || sent[m.email]) return;
      sent[m.email] = true;
      try {
        MailApp.sendEmail({
          to: m.email,
          subject: '報名成功｜' + EVENT_NAME + '　編碼 ' + bibCode_(d.category, teamNo, m.seat),
          htmlBody: runnerBody_(d, teamNo, m),
          name: SENDER_NAME
        });
      } catch (err) { Logger.log('第 ' + m.seat + ' 棒確認信寄送失敗：' + err); }
    });
  }
}

// ───────────── 列印頁：手環編碼貼紙 + 教練計圈正字表 ─────────────

function printPage_(rows) {
  // 依「組別 → 隊伍編號 → 棒次」排好
  const list = rows.filter(function (r) { return CATEGORIES[String(r[C['組別'] - 1] || '').trim()]; })
    .map(function (r) {
      return {
        cat:   String(r[C['組別'] - 1] || '').trim(),
        no:    String(r[C['隊伍編號'] - 1] || '').trim(),
        team:  String(r[C['隊伍名稱'] - 1] || '').trim(),
        seat:  Number(r[C['棒次'] - 1]) || 1,
        code:  String(r[C['手環編碼'] - 1] || '').trim(),
        name:  String(r[C['姓名'] - 1] || '').trim(),
        club:  String(r[C['隸屬戰隊'] - 1] || '').trim(),
        pay:   String(r[C['需繳費'] - 1] || '').trim() === '是',
        fee:   Number(r[C['金額'] - 1]) || 0,
        laps:  Number(r[C['負責圈數'] - 1]) || TOTAL_LAPS
      };
    });
  list.sort(function (a, b) {
    const ca = CATEGORY_ORDER.indexOf(a.cat), cb = CATEGORY_ORDER.indexOf(b.cat);
    if (ca !== cb) return ca - cb;
    if (a.no !== b.no) return a.no < b.no ? -1 : 1;
    return a.seat - b.seat;
  });

  const used = usedByCategory_(rows);
  const feeTotal = list.reduce(function (s, p) { return s + p.fee; }, 0);
  const payCount = list.filter(function (p) { return p.pay; }).length;

  let html = ''
    + '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc_(EVENT_NAME) + '｜工作人員列印頁</title><style>'
    + 'body{font-family:"Noto Sans TC","PingFang TC",sans-serif;margin:0;padding:22px;color:#111;background:#fff;}'
    + 'h1{font-size:22px;margin:0 0 4px;} h2{font-size:18px;margin:28px 0 10px;padding-bottom:6px;border-bottom:3px solid #111;}'
    + 'h3{font-size:15px;margin:18px 0 8px;background:#111;color:#fff;display:inline-block;padding:4px 12px;border-radius:20px;}'
    + '.sub{font-size:13px;color:#555;line-height:1.8;margin:0 0 14px;}'
    + '.ops{background:#fffbe6;border:2px solid #f0c000;border-radius:10px;padding:12px 16px;font-size:13.5px;line-height:1.9;margin:14px 0 6px;}'
    + '.stat{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 4px;}'
    + '.stat div{border:2px solid #111;border-radius:10px;padding:8px 14px;font-size:13px;}'
    + '.stat b{font-size:20px;}'
    + '.labels{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}'
    + '.lab{border:1.5px dashed #111;border-radius:8px;padding:8px 6px;text-align:center;}'
    + '.lab .code{font-size:26px;font-weight:900;letter-spacing:.04em;line-height:1.1;}'
    + '.lab .nm{font-size:12px;margin-top:3px;} .lab .ct{font-size:10px;color:#555;}'
    + 'table{width:100%;border-collapse:collapse;font-size:13px;}'
    + 'th,td{border:1.5px solid #111;padding:7px 8px;text-align:left;}'
    + 'th{background:#efefef;font-size:12px;}'
    + '.code-td{font-size:19px;font-weight:900;white-space:nowrap;}'
    + '.tally{height:40px;min-width:170px;background:repeating-linear-gradient(90deg,#fff,#fff 33px,#ddd 33px,#ddd 34px);}'
    + '.lapbox{white-space:nowrap;} .lapbox span{display:inline-block;width:26px;height:26px;border:1.5px solid #111;margin-right:5px;border-radius:4px;}'
    + '.pay{font-weight:900;color:#c00;} .free{color:#777;}'
    + '@media print{body{padding:8px;} h2{page-break-before:always;} h2:first-of-type{page-break-before:auto;} tr,.lab{page-break-inside:avoid;} .noprint{display:none;}}'
    + '</style></head><body>';

  html += '<h1>' + esc_(EVENT_NAME) + '｜工作人員列印頁</h1>'
    + '<p class="sub">' + esc_(EVENT_DATETIME) + '<br>' + esc_(EVENT_ROUTE) + '</p>'
    + '<div class="stat">'
    + '<div>個人組 <b>' + used['個人組'] + '</b> / ' + CATEGORIES['個人組'].quota + ' 人</div>'
    + '<div>兩人接力 <b>' + used['兩人接力'] + '</b> / ' + CATEGORIES['兩人接力'].quota + ' 隊</div>'
    + '<div>四人接力 <b>' + used['四人接力'] + '</b> / ' + CATEGORIES['四人接力'].quota + ' 隊</div>'
    + '<div>總人數 <b>' + list.length + '</b> 人</div>'
    + '<div>應收現金 <b>NT$' + feeTotal + '</b>（' + payCount + ' 人）</div>'
    + '</div>'
    + '<div class="ops"><b>現場提醒</b><br>'
    + '· 螢光手環<b>全部都是黃色</b>，每人一支，報到時把下面的編碼剪下貼在手環上。<br>'
    + '· 工作人員共 <b>3 位</b>：建議 1 位負責報到 / 發手環 / 收現金，2 位在終點線負責計圈畫正字與接力交接。<br>'
    + '· 沿基隆河繞一圈（東端成功橋過河走北岸，西端成美長壽橋過河回來；中途從成美橋下通過），每跑回成美長壽橋籃球場算一圈，依編碼在計圈表畫正字；個人組 4 圈、兩人接力每人 2 圈、四人接力每人 1 圈。<br>'
    + '· 每人報到時發一份 <b>' + esc_(GIFT_ALL) + '</b>，跟手環一起給，發完在名單上打勾。<br>'
    + '· 收 <b>NT$350</b> 時同時<b>核對是否為 NID 當期學員</b>，收到後在「材料費／收款」欄打勾。<br>'
    + '· 名次欄當場寫，賽後回填到試算表的「完賽名次」欄。<br>'
    + '· 三組各取<b>前三名</b>，務必記錄每組的完賽順序。獎品（' + esc_(SPONSOR_NAME) + ' 提供）：'
    + PRIZES.map(function (p) { return p.rank + '＝' + p.item; }).join('；') + '。</div>';

  // ── 1) 手環編碼貼紙
  html += '<h2>① 手環編碼貼紙（剪下貼在黃色螢光手環上）</h2><div class="labels">';
  list.forEach(function (p) {
    html += '<div class="lab"><div class="code">' + esc_(p.code) + '</div>'
      + '<div class="nm">' + esc_(p.name) + '</div>'
      + '<div class="ct">' + esc_(p.cat) + (p.team ? '·' + esc_(p.team) : '') + '</div></div>';
  });
  if (!list.length) html += '<div class="lab"><div class="nm">目前還沒有報名資料</div></div>';
  html += '</div>';

  // ── 2) 教練計圈正字表（依組別分頁）
  CATEGORY_ORDER.forEach(function (cat) {
    const group = list.filter(function (p) { return p.cat === cat; });
    html += '<h2>② 教練計圈表｜' + esc_(cat) + '（每人 ' + CATEGORIES[cat].laps + ' 圈）</h2>';
    if (!group.length) { html += '<p class="sub">目前沒有這個組別的報名。</p>'; return; }
    html += '<table><tr><th style="width:92px">手環編碼</th><th style="width:96px">姓名</th>'
      + '<th style="width:96px">戰隊</th>' + (CATEGORIES[cat].size > 1 ? '<th style="width:110px">隊伍</th>' : '')
      + '<th style="width:120px">圈數 □</th><th>正字紀錄</th><th style="width:52px">參加禮</th><th style="width:96px">材料費／收款</th><th style="width:62px">名次</th></tr>';
    let lastNo = '';
    group.forEach(function (p) {
      let boxes = '';
      for (let i = 0; i < p.laps; i++) boxes += '<span></span>';
      const sep = (CATEGORIES[cat].size > 1 && lastNo && lastNo !== p.no) ? ' style="border-top:4px solid #111"' : '';
      lastNo = p.no;
      html += '<tr' + sep + '><td class="code-td">' + esc_(p.code) + '</td>'
        + '<td>' + esc_(p.name) + '</td><td>' + esc_(p.club) + '</td>'
        + (CATEGORIES[cat].size > 1 ? '<td>' + esc_(p.team) + '</td>' : '')
        + '<td class="lapbox">' + boxes + '</td>'
        + '<td class="tally"></td>'
        + '<td style="text-align:center">□</td>'
        + '<td class="' + (p.pay ? 'pay' : 'free') + '">' + (p.pay ? 'NT$' + p.fee + '　□收' : '免費') + '</td>'
        + '<td></td></tr>';
    });
    html += '</table>';
  });

  html += '<p class="sub noprint" style="margin-top:24px">產生時間：'
    + esc_(Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm')) + '　·　重新整理即可更新名單。</p>'
    + '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle(EVENT_NAME + '｜工作人員列印頁');
}

// ───────────────────────────────────────

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';

  if (action === 'quota') {
    const snap = quotaSnapshot_(allRows_());
    snap.closed = regClosed_();
    snap.deadline = REG_DEADLINE_TEXT;
    return jsonOut_(snap);
  }

  if (action === 'print') {
    if (p.key !== PRINT_KEY) {
      return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">網址不完整，請向工作人員索取正確的列印頁連結。</p>');
    }
    return printPage_(allRows_());
  }

  return jsonOut_({ status: 'ok', message: 'NID Glow Run 12K backend running' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ status: 'error', message: '沒有收到報名資料，請重新整理頁面再試一次。' });
    }

    let raw;
    try {
      raw = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonOut_({ status: 'error', message: '報名資料格式不正確，請重新整理頁面再試一次。' });
    }
    if (!raw || typeof raw !== 'object') {
      return jsonOut_({ status: 'error', message: '報名資料格式不正確，請重新整理頁面再試一次。' });
    }

    if (regClosed_()) {
      return jsonOut_({ status: 'closed',
        message: '報名已於 ' + REG_DEADLINE_TEXT + ' 截止了。如仍想參加，請到 NID 官方 LINE 私訊小編詢問。' });
    }

    if (rateLimited_()) {
      return jsonOut_({ status: 'error', message: '目前報名人數眾多，請稍等一分鐘後再送出。' });
    }

    const check = validate_(raw);
    if (!check.ok) {
      return jsonOut_({ status: 'error', message: check.message });
    }
    const d = check.d;

    // 鎖「只」保護讀名額 + 寫入這一小段；寄信搬到鎖外面
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      return jsonOut_({ status: 'error', message: '系統忙碌中，請再按一次「SEND IT!」送出。' });
    }

    let teamNo = '';
    let quota;
    try {
      const rows = allRows_();

      const dup = findDuplicateEmail_(rows, d.members.map(function (m) { return m.email; }));
      if (dup) {
        // 有人可能是「送出成功但網路斷了」才重送，訊息要講清楚他其實已經報成功了
        return jsonOut_({ status: 'error', message: '這個 Email（' + dup + '）已經報名過了。'
          + '如果你剛剛送出過，代表已經報名成功，確認信會寄到這個信箱（也請看一下垃圾郵件匣）。'
          + '如需修改資料或換組別，請私訊 NID 官方 LINE。' });
      }

      const cfg = CATEGORIES[d.category];
      const used = usedByCategory_(rows);
      if (used[d.category] + 1 > cfg.quota) {
        return jsonOut_({ status: 'full', category: d.category, left: 0, total: cfg.quota, unit: cfg.unit });
      }

      teamNo = nextTeamNo_(rows, d.category);
      const stamp = new Date();
      const newRows = rowsFromData_(d, teamNo, stamp);
      const sheet = getSheet_(d.category);   // 依組別寫進對應的分頁
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, HEADERS.length).setValues(newRows);
      SpreadsheetApp.flush();

      quota = quotaSnapshot_(rows.concat(newRows));
    } finally {
      lock.releaseLock();
    }

    // 名額已寫入，寄信失敗不影響報名成功
    try { sendNotifications_(d, teamNo); } catch (mailErr) { Logger.log('寄信流程錯誤：' + mailErr); }

    return jsonOut_({
      status: 'ok',
      teamNo: teamNo,
      codes: d.members.map(function (m) { return bibCode_(d.category, teamNo, m.seat); }),
      quota: quota
    });

  } catch (err) {
    Logger.log('doPost 未預期錯誤：' + err + (err && err.stack ? '\n' + err.stack : ''));
    return jsonOut_({ status: 'error', message: '系統忙碌中，請稍後再試，或聯絡 NID 教練協助報名。' });
  }
}


// ── 現場用分頁：手環編碼貼紙 / 教練計圈表 ──────────────────────────
// 兩張表都用公式連動三個報名分頁，開起來永遠是最新的。
// 只有「框線要包到第幾列」是產生當下決定的，報名截止後再跑一次 buildRaceDaySheets 就會重排。
const STICKER_SHEET = '手環編碼貼紙';
const TALLY_SHEET   = '教練計圈表';

// 三個報名分頁疊起來：個人組 → 兩人接力 → 四人接力（組內就是報名順序）
function stackRef_() {
  return CATEGORY_ORDER.map(function (c) {
    return "'" + SHEET_NAMES[c] + "'!A2:S";
  }).join('; ');
}

function stackQuery_(cols) {
  return '=IFERROR(QUERY({' + stackRef_() + '}, "select ' + cols +
         ' where Col6 is not null", 0), "")';
}

/**
 * 產生／更新「手環編碼貼紙」與「教練計圈表」兩個分頁。
 * 用法：上方函式下拉選 buildRaceDaySheets → 執行。
 * 資料是公式連動的，平常不用重跑；報名截止後跑一次，框線會依實際人數收乾淨。
 */
function buildRaceDaySheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  CATEGORY_ORDER.forEach(function (c) { getSheet_(c); });   // 確保三個報名分頁都在
  const n = allRows_().length;
  buildSticker_(ss);
  buildTally_(ss, regClosed_() ? n + 2 : maxSeats_());
  return '已更新：' + STICKER_SHEET + '（三組分開）、' + TALLY_SHEET +
         '（目前 ' + n + ' 人' + (regClosed_() ? '，已收成實際人數' : '，還在報名，先留滿額空間') + '）';
}

// 某一組滿額時的總人數（個人組 22、兩人接力 15×2、四人接力 12×4）
function seatsOf_(cat) {
  const cfg = CATEGORIES[cat];
  return cfg.quota * cfg.size;
}

function maxSeats_() {
  let t = 0;
  CATEGORY_ORDER.forEach(function (c) { t += seatsOf_(c); });
  return t;
}

// 某一組目前實際報名幾個人
function seatsUsed_(cat) {
  return sheetRows_(getSheet_(cat)).filter(function (r) {
    return String(r[C['手環編碼'] - 1] || '').trim() !== '';
  }).length;
}

function titleRow_(sh, cols, text) {
  sh.getRange(1, 1, 1, cols).merge()
    .setValue(text)
    .setFontWeight('bold').setFontSize(13)
    .setBackground('#2b3157').setFontColor('#ffffff')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 30);
}

function noteRow_(sh, cols, text) {
  sh.getRange(2, 1, 1, cols).merge()
    .setValue(text).setFontSize(9).setFontColor('#666666')
    .setVerticalAlignment('middle');
  sh.setRowHeight(2, 22);
}

function headerRow_(sh, headers) {
  sh.getRange(3, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#e8eaf3')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(3, 26);
  sh.setFrozenRows(3);
}

/**
 * 手環編碼貼紙：個人組 / 兩人接力 / 四人接力 三段分開，各自從 1 開始編號，
 * 中間空一列方便裁開分袋。報名中會先留到滿額的列數（不會爆版），
 * 報名截止後再跑一次就會收成實際人數。
 */
function buildSticker_(ss) {
  const sh = ss.getSheetByName(STICKER_SHEET) || ss.insertSheet(STICKER_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();

  const COLS = 5;
  const HDR = ['序', '手環編碼', '姓名', '隸屬戰隊', '隊伍名稱'];
  const closed = regClosed_();

  titleRow_(sh, COLS, 'NID 螢光路跑 GLOW RUN 12K｜手環編碼貼紙（沿框裁開，貼在黃色手環上）');
  noteRow_(sh, COLS, '三組分開、各自從 1 開始編，中間空一列可直接裁開分袋。自動連動報名分頁，組內是報名順序。' +
    (closed ? '' : '　報名截止後再跑一次 buildRaceDaySheets，空白列就會收乾淨。'));
  sh.setFrozenRows(2);

  [46, 130, 110, 130, 150].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  let r = 4;
  CATEGORY_ORDER.forEach(function (cat) {
    const cfg  = CATEGORIES[cat];
    const used = seatsUsed_(cat);
    const rows = closed ? Math.max(used, 1) : seatsOf_(cat);
    const sample = cfg.size === 1 ? cfg.prefix + '01、' + cfg.prefix + '02…'
                                  : cfg.prefix + '01-1…' + cfg.prefix + '01-' + cfg.size + '、' + cfg.prefix + '02-1…';

    const label = cat + '　·　' + (cfg.size === 1 ? '1 人跑 ' + cfg.laps + ' 圈'
                                                   : cfg.size + ' 人接力 · 每人 ' + cfg.laps + ' 圈') +
                  '　·　' + sample + '　·　';
    // 人數用公式即時算，不然報名進來標題還停在舊數字
    sh.getRange(r, 1, 1, COLS).merge()
      .setFormula('="' + label + '"&COUNTA(' + "'" + SHEET_NAMES[cat] + "'" + '!F2:F)&" / ' + seatsOf_(cat) + ' 人"')
      .setWrap(true)
      .setFontWeight('bold').setFontSize(12)
      .setBackground('#4a5288').setFontColor('#ffffff')
      .setVerticalAlignment('middle');
    sh.setRowHeight(r, 34);
    r++;

    sh.getRange(r, 1, 1, COLS).setValues([HDR])
      .setFontWeight('bold').setBackground('#e8eaf3')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setRowHeight(r, 24);
    r++;

    const first = r;
    const last  = first + rows - 1;
    sh.getRange(first, 1).setFormula(
      '=ARRAYFORMULA(IF(B' + first + ':B' + last + '="","",ROW(B' + first + ':B' + last + ')-' + (first - 1) + '))');
    sh.getRange(first, 2).setFormula(
      '=IFERROR(QUERY(' + "'" + SHEET_NAMES[cat] + "'" + '!A2:S, "select Col6, Col7, Col8, Col4 where Col6 is not null", 0), "")');

    const body = sh.getRange(first, 1, rows, COLS);
    body.setBorder(true, true, true, true, true, true, '#333333', SpreadsheetApp.BorderStyle.SOLID)
        .setVerticalAlignment('middle');
    sh.setRowHeights(first, rows, 34);
    sh.getRange(first, 1, rows, 1).setHorizontalAlignment('center');
    sh.getRange(first, 2, rows, 1).setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center');

    r = last + 2;   // 空一列再接下一組
  });
}

function buildTally_(ss, rows) {
  const sh = ss.getSheetByName(TALLY_SHEET) || ss.insertSheet(TALLY_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();

  const HDR = ['序', '手環編碼', '姓名', '組別', '隊伍名稱', '負責圈數',
               '第1圈', '第2圈', '第3圈', '第4圈', '備註'];
  titleRow_(sh, HDR.length, 'NID 螢光路跑 GLOW RUN 12K｜教練計圈表（每跑回籃球場一圈，就在該圈格畫一劃「正」）');
  noteRow_(sh, HDR.length, '自動連動三個報名分頁。灰色格＝這個人沒有那一圈（兩人接力各 2 圈、四人接力各 1 圈）。');
  headerRow_(sh, HDR);

  sh.getRange('A4').setFormula('=ARRAYFORMULA(IF(B4:B="","",ROW(B4:B)-3))');
  sh.getRange('B4').setFormula(stackQuery_('Col6, Col7, Col2, Col4, Col16'));

  [46, 110, 100, 100, 140, 70, 62, 62, 62, 62, 140].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  const body = sh.getRange(4, 1, rows, HDR.length);
  body.setBorder(true, true, true, true, true, true, '#333333', SpreadsheetApp.BorderStyle.SOLID)
      .setVerticalAlignment('middle');
  sh.setRowHeights(4, rows, 30);
  sh.getRange(4, 1, rows, 1).setHorizontalAlignment('center');
  sh.getRange(4, 2, rows, 1).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(4, 4, rows, 2).setHorizontalAlignment('center');
  sh.getRange(4, 6, rows, 1).setHorizontalAlignment('center');

  // 用不到的圈數格塗灰，教練才不會畫錯格
  const rules = [];
  [[7, 1], [8, 2], [9, 3], [10, 4]].forEach(function (p) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($B4<>"", $F4<' + p[1] + ')')
      .setBackground('#d0d0d0')
      .setRanges([sh.getRange(4, p[0], rows, 1)])
      .build());
  });
  sh.setConditionalFormatRules(rules);
}

/**
 * 在編輯器上方選 printUrl → 執行，執行記錄會印出「工作人員列印頁」的網址。
 * （現在改用試算表裡的「手環編碼貼紙」「教練計圈表」兩個分頁列印，這個網頁版留著備用。）
 */
function printUrl() {
  const url = ScriptApp.getService().getUrl() + '?action=print&key=' + PRINT_KEY;
  Logger.log(url);
  return url;
}

/**
 * 【上線前一次性使用】清除三個報名分頁的所有資料列（保留第 1 列表頭）。
 * 用法：上方函式下拉選 resetSheet → 執行。正式開放後勿再執行。
 */
function resetSheet() {
  CATEGORY_ORDER.forEach(function (cat) {
    const sheet = getSheet_(cat);
    const last = sheet.getLastRow();
    if (last > 1) {
      sheet.getRange(2, 1, last - 1, sheet.getMaxColumns()).clearContent();
    }
  });
}
