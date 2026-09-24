# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/).
本專案的重要變更都記錄在這裡，版本號遵循[語意化版本](https://semver.org/lang/zh-TW/)。

## [1.0.0] - 2026-09-25

First public release. 第一個公開版本。

### Added / 新增
- `inspect`: text outline of a page (headings, menus, buttons, fields, tables, pagination); `--click` walks menus by visible text — 用文字列出頁面結構，`--click` 依文字逐步點選單
- `shot`: desktop / laptop / tablet / mobile / custom sizes, full page or element, `--mask` for dynamic regions — 多尺寸、整頁或元素截圖，可遮蔽會變動的區塊
- `audit`: console errors, failed requests, broken images and links, horizontal overflow with offending elements, axe accessibility, LCP / CLS, visual diff against a baseline — 前端健檢：錯誤、失敗請求、破圖、壞連結、跑版元素、無障礙、效能、視覺比對
- `run`: scripted flows with injected `page` / `expect` / `shot`, automatic failure screenshot, optional trace — 自訂操作流程，失敗自動截圖，可錄製 trace
- `login` / `sessions`: the user logs in once in a visible window; refreshed tokens are written back after each run — 使用者自行登入一次，之後每次執行自動回存新 token
- Warnings for login walls and loading spinners so they're never reported as the real page — 偵測登入牆與載入中畫面
- Cross-platform setup (`node scripts/setup.mjs`), Node.js 18+, tested on macOS and Windows — 跨平台安裝，macOS 與 Windows 實測通過
- Git Bash path-conversion handling on Windows — 處理 Windows Git Bash 的路徑轉換

[1.0.0]: https://github.com/AndyShiu/claude-skill-playwright-browser/releases/tag/v1.0.0
