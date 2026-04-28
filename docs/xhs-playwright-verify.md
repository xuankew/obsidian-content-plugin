# 小红书 Playwright 发布：验证清单

插件内设置：「内置发布方式」= Playwright；可选开启 Dry-run 与半自动；首次使用建议开启「有头模式」与「发布前自动安装依赖」。

1. **Dry-run**  
   开启「Dry-run」后执行「发布小红书」：应仅打印/列出标题、正文片段与图片路径，不启动浏览器、不点发布。退出码 0 时不清理 Sandbox 中的 xhs 临时文件（与 API 模式一致，dry 不清理）。

2. **首次登录**  
   关闭 Dry-run，确保本机有 Google Chrome 或已完成 `python -m playwright install chromium`：首次可能打开登录/扫码，登录成功后再次发布应能复用 `.obsidian/mdtp/xhs_playwright/<profile>` 下持久化态。

3. **正常发布**（需谨慎使用真实笔记）  
   具备 `cover.png`、若干 `card_*.png` 与有效的 `publish_xhs.md`：应上传图片、填写标题/正文/话题（末行话题逻辑见脚本）、可设仅自己可见并尝试发布。成功时退出码 0 且**会**按现有逻辑清理 Sandbox xhs 临时 md（与 API 非 dry 一致）。

4. **失败不清理**  
   人为制造失败（如断网、或在小红书未登录时运行）：发布脚本应非 0 退出，**不得**清理 Sandbox 内 xhs 临时内容；若开启「失败时保留浏览器」且 `MDT_XHS_PLAYWRIGHT_KEEP_OPEN=1`，应不断开 Playwright/尽量保留窗口。错误截图路径：`{库}/.obsidian/mdtp/xhs_playwright_last_error.png`（无库根时落在脚本同目录旁）。

5. **回退**  
   将「内置发布方式」改回 **API** 可继续使用 `publish_xhs_redbook.py` 与 Cookie，无需卸载 Playwright。
