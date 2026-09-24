# claude-skill-playwright-browser

> A [Claude Code](https://claude.com/claude-code) skill that gives Claude a background browser (Playwright): screenshots on desktop / tablet / mobile, frontend health checks, scripted UI flows, and logged-in pages — in any project. Just ask in plain language; Claude decides when to use it.

讓 Claude Code 擁有一個**在背景執行的瀏覽器**。你用一般對話交代，例如「截首頁手機版」、「這頁為什麼按送出沒反應」、「幫我健檢結帳頁」，Claude 會自己開瀏覽器、操作、截圖、檢查，再把結果和檔案交給你。不會動到你正在用的瀏覽器，適用於任何專案（前端、後端、非 Node 專案都可以）。

---

## 能做什麼

| 功能 | 說明 |
|---|---|
| 📸 **截圖** | 桌機 / 平板 / 手機、整頁或單一元素、一次截很多頁 |
| 🩺 **前端健檢** | Console 錯誤、API 失敗（4xx/5xx）、破圖、壞連結、手機跑版（並指出是哪個元素撐寬的）、無障礙問題（axe）、效能指標（LCP / CLS） |
| 🔍 **視覺比對** | 改 CSS 前先存基準圖，改完比對，產生紅色標示的差異圖 |
| 🧭 **操作流程** | 登入、點選單、填表單、換頁、驗證結果，每一步都能截圖；失敗時自動截下當時的畫面 |
| 🔐 **需要登入的網站** | 你自己登入一次，之後 Claude 就能用這個登入狀態在背景操作（帳密不會被存下來） |
| 🧪 **轉成正式測試** | 需要時，把操作流程轉成專案裡的 Playwright Test，放進 CI |

## 使用範例

直接跟 Claude 說就好，不用提到「Playwright」：

```
幫我把 localhost:5173 的首頁截手機版跟桌機版
客戶說官網在 iPhone 上要左右滑，幫我查是哪個元素撐寬的
新版結帳頁上線前幫我健檢一下
我改了 header 的 CSS，幫我比對改之前跟改之後
後台「訂單管理」那頁切到第 2 頁，資料有正確換嗎？
這個 issue 說按「送出」沒反應，幫我在 dev 環境重現並截圖
後台每個選單頁都截一張，存到桌面
```

**Claude 會照你問的範圍做事**：只要截圖就只交截圖，查一個問題就只處理那個問題；只有你要求「健檢」、「找問題」時，才會做完整檢查並列出改善建議。

### 跟 Claude in Chrome 怎麼分工？

| 適合 Claude in Chrome | 適合這個 skill |
|---|---|
| 要用你**正在開著**的分頁、你已登入的瀏覽器 | 在**背景**執行，不影響你正在用的瀏覽器 |
| 你想**看著它操作** | 需要**可以重複執行**、結果一致 |
| 只是快速看一眼 | 多種尺寸、多個頁面**批次**處理 |
| | 健檢、報告、前後比對、測試 |

兩者都適合時，Claude 會先問你要用哪一個，並給建議。

---

## 安裝

**需求**：Claude Code、Node.js 18 以上（`node -v` 確認）、macOS / Linux / Windows，Chromium 約需 150 MB 空間。

**1. 下載到 skills 目錄**（資料夾名稱要是 `playwright-browser`）

```bash
# 個人使用，所有專案都能用
git clone https://github.com/AndyShiu/claude-skill-playwright-browser.git ~/.claude/skills/playwright-browser

# 或只給某個專案用（可以跟專案一起 commit，團隊共用）
git clone https://github.com/AndyShiu/claude-skill-playwright-browser.git <專案>/.claude/skills/playwright-browser
```

Windows 的個人目錄是 `%USERPROFILE%\.claude\skills\playwright-browser`。

**2. 就這樣。** 第一次使用時，Claude 會偵測到還沒安裝執行環境，告訴你之後自動安裝。想先裝好也可以：

```bash
node ~/.claude/skills/playwright-browser/scripts/setup.mjs                  # 只裝 Chromium
node ~/.claude/skills/playwright-browser/scripts/setup.mjs firefox webkit   # 另外加裝 Firefox、WebKit（Safari 核心）
```

npm 套件會裝在 skill 資料夾裡的 `node_modules/`（已被 `.gitignore` 排除）；瀏覽器裝在 Playwright 的共用快取，多個專案、多份 skill 共用同一份，**不會動到你的專案**。

---

## 登入需要帳號的網站

1. 跟 Claude 說要看某個需要登入的網站，它會幫你開一個瀏覽器視窗
2. **你自己在視窗裡登入**（帳密只有你輸入，不會被存下來）
3. 登入完成後關掉視窗；或者 Claude 設定成「進到某個頁面就自動存檔並關閉」

之後 Claude 就能用這個登入狀態在背景操作。每次操作完，網站自動換發的新 token 也會存回去，所以**經常使用就不容易過期**。如果閒置太久，超過網站的登入效期，Claude 會偵測到被導回登入頁，請你重新登入一次，不會把登入頁當成結果交給你。

---

## 檔案存在哪裡

skill 資料夾裡**沒有任何個人資料**，可以放心分享或 commit。

| 內容 | 位置 | 說明 |
|---|---|---|
| 登入狀態 | `~/.claude/playwright/sessions/<專案>/` | 含 cookie / token，權限只有你能讀。**不要 commit 或分享** |
| 視覺比對基準圖 | `~/.claude/playwright/baselines/<專案>/` | 前後比對用的參考截圖 |
| 截圖與報告 | 系統暫存目錄 `claude-playwright/` | **7 天後自動刪除**；要保留的話，Claude 會問你要存到哪裡 |

---

## Token 用量參考

在已經開著的對話中使用一次的大約額外用量：

| 情境 | 約略 tokens |
|---|---|
| 截一張圖 | 5k～7k |
| 截三種尺寸 | 8k～10k |
| 完整健檢一頁 | 12k～18k |
| 查一個問題 / 走一段操作流程 | 20k～40k |
| 批次截很多頁 | 25k～40k（大量截圖時會改成抽查，不會每張都打開） |

最主要的花費是「看截圖」（每張約 1.5k～2k）。只截需要的尺寸、直接給網址而不是要它自己找，都能省不少。

---

## 疑難排解

| 狀況 | 處理 |
|---|---|
| 截到的是登入頁 | 登入狀態過期了，請 Claude 帶你重新登入 |
| 截到還在轉圈圈的畫面 | 請 Claude 等特定內容出現再截（它會用 `--wait-for`） |
| 內網網站出現憑證錯誤 | 自簽憑證，確認是可信任的內網主機後，請 Claude 加上 `--insecure` |
| `localhost` 連不上 | 開發伺服器沒開，Claude 會提醒並可以幫你啟動 |
| 按鈕按了「沒反應」但實際有跳確認框 | 瀏覽器的確認框預設會被取消，Claude 知道要先設定「按確定」 |
| 要測 Safari 的相容性 | 執行 `setup.mjs webkit` 安裝 WebKit |

---

## 手動使用（進階）

平常不需要，Claude 會自己呼叫。要手動用的話：

```bash
PW="$HOME/.claude/skills/playwright-browser/scripts/pw.mjs"

node "$PW" inspect --url https://example.com --click "Pricing"        # 用文字列出頁面結構
node "$PW" shot    --url https://example.com --viewport desktop,mobile --full
node "$PW" audit   --url https://example.com                           # 完整健檢，產出 report.md
node "$PW" run     --script flow.mjs --url https://example.com         # 自訂操作流程
node "$PW" login   --session admin --url https://example.com/login     # 開視窗讓你登入
node "$PW" sessions                                                    # 列出已存的登入狀態
node "$PW" clean   --days 0                                            # 清掉所有暫存截圖
```

每個指令都輸出一行 JSON。完整選項見 [`SKILL.md`](SKILL.md)。

---

## 更新與移除

- **更新**：在 skill 資料夾執行 `git pull`，若 `package.json` 有變動，再跑一次 `node scripts/setup.mjs`
- **移除**：刪除 skill 資料夾和 `~/.claude/playwright/`。瀏覽器快取可以在刪除前於 skill 資料夾執行 `npx playwright uninstall --all`，或手動刪除 `~/Library/Caches/ms-playwright`（macOS）、`~/.cache/ms-playwright`（Linux）、`%LOCALAPPDATA%\ms-playwright`（Windows）

## 專案結構

```
SKILL.md                 Claude 讀的使用說明（何時用、怎麼用）
scripts/pw.mjs           執行工具：inspect / shot / audit / run / login / diff / sessions / clean
scripts/setup.mjs        跨平台的一次性安裝
references/analysis.md   健檢結果的解讀方式、門檻值、如何追到原始碼
references/project-tests.md  把流程轉成專案正式測試（Playwright Test + CI）
```
