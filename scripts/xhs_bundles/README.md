# 随插件携带 xhs 依赖（按平台、可选）

`pip install xhs` 会安装 **lxml 等带 C 扩展** 的轮子，**与「操作系统 + CPU 架构 + Python 主版本」绑定**，不能用一个文件夹覆盖 Windows / macOS / Linux 全平台。

本目录用于存放**当前机器**上执行

```bash
# 在插件根目录（与 scripts 同级）推荐用 venv 里的 Python，避免 Homebrew 的 PEP 668：
# node scripts/bundle_xhs_pip_target.mjs
```

后生成的 `pip --target` 结果，目录名为 **`darwin-arm64` / `win32-x64` 等**（与 Obsidian/Node 的 `process.platform` + `process.arch` 一致）。

插件在「发布小红书」时若发现存在 `xhs_bundles/<本机平台名>/xhs/`，会自动把该路径加入子进程的 `PYTHONPATH`，**一般无需再配 venv**（仍要本机有任意 Python3 运行 `publish_xhs_redbook.py`）。

- 换电脑或换系统后需在本机**重新**生成子目录。  
- 不要提交 `xhs_bundles` 下各平台目录到 Git（已 `.gitignore`）。
