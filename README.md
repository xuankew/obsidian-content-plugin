# MD to Platform（Obsidian 插件）

在 Obsidian **桌面端**里，用当前笔记完成：**扩写**、**公众号草稿**（智谱生图插图 + 花生风格 HTML 正文）、**小红书卡片图**（可选本机发布脚本）、**公众号长文→小红书图文**、**Baoyu 风多图配图**、**火山方舟 Seedance 视频任务**，以及 **微信视频号库内视频分片上传**（init + chunk，与公众号共用凭证）。

**English:** [README_EN.md](./README_EN.md)

---

## 适用环境

- Obsidian **桌面版**（插件为仅桌面；依赖 Node 文件系统、子进程与网络请求）。
- 需要能访问你选用的 **LLM / 生图 API**（DeepSeek、智谱、OpenAI 兼容）及（若使用）**微信公众平台**、**火山方舟**。

---

## 安装

### 方式 A：从本仓库安装（开发/更新）

1. 克隆或复制本目录到本地。
2. 在项目根目录执行：
   ```bash
   npm install
   npm run build
   ```
   生成根目录下的 `main.js`。
3. 将整个插件目录复制到你的库的：  
   `<库>/.obsidian/plugins/md-to-platform/`  
   目录内**至少**包含：
   - `manifest.json`
   - `main.js`
   - `rules/`（见下，**必须与 `main.js` 同级**）

4. 重启 Obsidian，在 **设置 → 第三方插件** 中关闭安全模式，启用 **MD to Platform**。

### 方式 B：只拷贝发布包

若你从别处拿到 zip，解压后同样放到 `.obsidian/plugins/md-to-platform/`，确认存在 `rules/` 与 `main.js` 即可。

---

## `rules` 目录（必看）

默认从 **`库/.obsidian/plugins/md-to-platform/rules/`**（与 `main.js` 同级）读取规则（文件名固定）：

| 文件 | 用途 |
|------|------|
| `公众号扩写规则.md` | 扩写公众号正文时的 system 规则（**必填**） |
| `gzh_to_xhs.md` | 公众号稿转小红书卡片时的 system 规则（**必填**） |
| `baoyu_xhs_images.md` | 「Baoyu 风配图」：长文拆页 + 生图提示词风格（**可选**；缺失时用插件内置默认） |

前两者若缺失，扩写/文→卡 会报错。你可按需编辑；「Baoyu 风」思路可参考社区 [baoyu-xhs-images](https://github.com/JimLiu/baoyu-skills/tree/main/skills/baoyu-xhs-images) 类工作流。插图由设置中的 **插图渠道** 决定（智谱 `glm-image` 或火山方舟 Seedream 等），不再写死单一模型名。

**规则目录覆盖（设置里）** 支持三种写法：

- **留空**：使用插件目录下的 `rules/`（插件会尽量用 `manifest.dir`；若异常则回退到 `库/.obsidian/plugins/<插件 id>/`）。
- **绝对路径**：例如 `/Users/xxx/rules`。
- **相对库根的路径**：例如 `rules` 表示「当前 Obsidian 库根目录下的 `rules` 文件夹」，适合把规则放在笔记仓库里统一备份。

---

## 写作目录工作流（路径解析）

默认**开启**「Sandbox / Published」布局（可在 **设置 → MD to Platform → 写作目录工作流** 中关闭；关闭后行为与旧版一致：扩写产物写在**当前笔记同目录**）。

### 推荐库内结构（示例）

```
06-写作/                          ← 工作流根（设置「工作流根目录」，可改）
  01-Inbox/                       ← 你在此写框架稿（插件不强制，仅建议）
  02-Sanbox/                      ← Sandbox 目录名（设置可改，按你实际文件夹名）
    <会话目录>/                   ← 每篇笔记一个目录，见下文「会话目录名」
      publish_gzh.md …            ← 扩写产生的 tmp，成功推送公众号后可被清理
      publish_xhs.md …
      xhs_content.md …
      wechat_images/ …            ← 公众号流程中的插图缓存（成功后清理）
  03-Published/                   ← 发布根（设置可改）
    gzh/<会话>/publish_gzh.md     ← 公众号终稿
    xhs/<会话>/publish_xhs.md     ← 小红书相关终稿
    xhs/<会话>/xhs_content.md
    xhs/<会话>/card_*.png         ← 卡片 PNG（工作流开启时固定在该会话目录）
    xhs/<会话>/baoyu_cogview/     ← Baoyu 风多图输出目录（与 html 卡片图不同管线）
```

### 会话目录名

对当前操作的笔记，插件使用「安全化后的**文件名** + **笔记路径**的 8 位哈希」生成会话目录名（例如 `我的文章-a1b2c3d`），避免同文件夹内多篇笔记互相覆盖扩写文件名。

### 路径如何解析（统一规则）

工作流相关路径全部是 **库内相对路径**，解析时：

- 去掉首尾空白，按 `/`、`\` 分段，用正斜杠规范化（与 Obsidian `normalizePath` 一致）；
- **若任一段为 `..`**，该项设置视为非法，**回退到内置默认值**（避免路径歧义与误写）；
- 扩写、文→卡 完成后的 Notice 中展示的是**解析后的生效路径**，可能与设置框里随手输入的字符串略有差异。

可配置项：**工作流根目录**、**Sandbox 文件夹名**、**Published 根文件夹名**（均可多段，如 `areas/06-写作`，但不能含 `..`）。

### 读文件优先级（开启工作流时）

| 文件 | 顺序 |
|------|------|
| `publish_gzh.md` | `Published/gzh/<会话>/` → `Sandbox/<会话>/` → 笔记同目录 → 插件 `.cache` |
| `xhs_content.md`、`publish_xhs.md` | `Published/xhs/<会话>/` → `Sandbox/<会话>/` → 笔记同目录 → `.cache` |

关闭工作流时：仍为 **笔记同目录** → `.cache`。

### 临时文件何时删除

- **公众号草稿创建成功**后：删除 Sandbox 该会话下公众号相关 tmp（含 `wechat_images`、Sandbox 内的 `publish_gzh.md` 以及中间生成的 `publish_gzh_with_images.md`、`wechat_article.html`）。`Published/gzh` 中的终稿保留。
- **小红书卡片图全部生成成功**后：删除 Sandbox 该会话下的 `publish_xhs.md`、`xhs_content.md`。`Published/xhs` 中的终稿与 PNG 保留。

### 小红书卡片 PNG 存放位置

- **工作流开启**：PNG **始终**落在 `<工作流根>/<Published>/xhs/<会话>/`，**不再**使用「笔记同目录 / 子文件夹」选项。
- **工作流关闭**：仍由设置项「卡片图保存到笔记同目录」与 `.cache` 控制。

---

## 设置里要填什么（功能总览）

### LLM 与文本

- **提供商**：DeepSeek / 智谱 / OpenAI 兼容（兼容模式需填 Base URL）。
- **API Key**：文本扩写必填。
- **文本模型**：按账号可用填写（如 `deepseek-chat`、`glm-4-flash`）。

### 扩写

- **公众号扩写目标字数（汉字）**：默认 **2000**，会写入扩写请求的 **user** 提示，与 `公众号扩写规则.md` 中的 system 规则一起约束篇幅；大模型仍可能偏差，可微调该数字或改规则文件。
- **编辑区 MDTP 提示条**：默认**关闭**；开启后在笔记编辑区**左下角**显示，避免挡字数。状态栏仅保留 **「MDTP ▾」** 一词宽，点击展开菜单（避免以往多链接撑满状态栏导致右侧字数被裁切）。

### 插图（公众号 / Baoyu 等共用）

- **插图专用 Key（可选）**：文本用 DeepSeek、插图用智谱时单独填智谱 Key；若全程智谱可与主 Key 相同。
- **插图生成渠道**：
  - **智谱**：使用 `https://open.bigmodel.cn/api/paas/v4/images/generations`。默认图片模型 **`glm-image`**，默认尺寸 **`1280x1280`**（可在设置中改「智谱生图尺寸」）。请求会优先争取 **`response_format: b64_json`** 直接拿 base64；若接口仍只返回临时 URL，插件会再下载图片。
  - **火山方舟**：使用 Seedream 等模型，需填 **火山方舟 API Key**、接入域名、模型 ID、尺寸、水印等（与智谱独立）。
- **图片模型（智谱）**：默认 `glm-image`；仍可选用文档中的其它模型（如 `cogview-3-flash`），参数行为以智谱文档为准。

### Seedance 视频（火山方舟）

- **Seedance 模型 ID**：用于命令「**MDTP：提交 Seedance 视频任务**」；需已配置方舟 API Key。

### 缓存

- **缓存过期（小时）**：插件数据目录下 `.cache` 里按笔记哈希存放的中间文件，超过时间会清理。
- **自动清理间隔（分钟）**：定时清理触发频率。

### 写作目录工作流

- **启用 Sandbox / Published 目录布局**：见上文《写作目录工作流（路径解析）》。
- **工作流根目录**：库内路径，默认 `06-写作`。
- **Sandbox / Published 文件夹名**：默认分别为 `02-Sanbox`、`03-Published`；均为相对「工作流根」的片段。

### 公众号

- **AppID / AppSecret**：微信公众平台「开发 → 基本配置」；用于 `access_token`、上传素材、创建草稿。
- **排版主题**：内置与开源 [**花生编辑器 huasheng_editor**](https://github.com/alchaincyf/huasheng_editor) **同源**的多套样式（全内联 CSS，多图连续排版会转为 table 以适配公众号编辑器）。微信后台对部分字体、渐变、阴影支持有限，若与浏览器预览略有差异属正常。
- **草稿封面缩略图**：
  - **纯色背景 + 居中标题**：用笔记标题生成封面 PNG（不依赖正文插图）。
  - **使用首张正文插图**：用第一张插图当封面。
- **纯色封面**：可设 **背景色预设**（多种常用色）、**标题字号**（填 `0` 表示按标题长度自动）。
- **视频号 · 视频分片上传**：`init` / `chunk` 的 URL 路径（相对 `api.weixin.qq.com`）、分片大小、`media_type` 等；与公众号 **共用同一组 AppID / AppSecret** 获取 `access_token`。插件仅实现文档中的分片上传；若另有「完结」类接口需自行按官方文档对接。

注意：公众号接口常要求服务器 **IP 白名单**。家庭宽带 IP 变化可能导致偶发失败，需在公众平台把当前出口 IP 加入白名单；本插件未内置 HTTP 代理。

### 小红书

- **仅导出卡片 PNG**：只要能读到 **`xhs_content.md`**（工作流 `Published/xhs/<会话>/` → `Sandbox/…` → 笔记同目录 → `.cache` 回退）即可，**不要求**事先存在 `publish_xhs.md`。
- **`publish_xhs.md`**：在**发小红书**（见下）时若使用内置/外部发布脚本，会按路径注入 `MDT_PUBLISH_XHS`；纯「仅渲染」不读此文件。扩写/文→卡 通常会生成带「标题1」「`## 发布正文`」等段落的 `publish_xhs.md`，与 [Auto-Redbook-Skills](https://github.com/comeonzhj/Auto-Redbook-Skills) 的约定一致；内置脚本会据此解析 **标题** 与 **描述**（最多约 20 字标题、描述支持一段正文）。
- **卡片分隔（正则）**：默认匹配单独一行的 `---`，用于拆分 `xhs_content.md` 多张卡片（与常见「单独一行 `---` 分页」习惯一致）。
- **卡片图保存到笔记同目录**：仅在**未开启**写作目录工作流时生效；开启工作流时 PNG 固定写入 `Published/xhs/<会话>/`。
- **卡片主题 / 宽高 / DPR / 动态高度**：控制导出 PNG 的尺寸与版式。正文区字号与内外边距已按 [Auto-Redbook-Skills](https://github.com/comeonzhj/Auto-Redbook-Skills) 的 1080 宽设计稿（约 42px 正文、72px 一级标题、外层 50px + 内层 60px 留白）对齐；本插件在 Obsidian 内用 html-to-image 出图，不经 Playwright，若需 `auto-fit` / `auto-split` 等模式可自行用该项目脚本处理同一份 `xhs_content`。
- **卡片字体（霞鹜文楷 GB）**：设置默认开启 **「卡片使用霞鹜文楷 GB」**，导出时在 Shadow 内以 `@font-face`（data URL）嵌入 [LxgwWenkaiGB](https://github.com/lxgw/LxgwWenkaiGB)（SIL OFL 1.1）。请将 `LXGWWenKaiGB-Regular.ttf` 放在插件目录 `fonts/` 下，或在设置里填写 TTF 绝对路径；仓库内可执行 `npm run vendor:wenkai` 下载。无文件时自动回退系统黑体栈。
- **封面 `cover.png`**（设置项默认开启）：版式参考该项目 `assets/cover.html`（大 emoji + 主标题 + 副标题）。标题优先取 `publish_xhs.md` 里「标题1：」「标题2：」，否则用首张卡片首行兜底。上传小红书时建议 **先选封面再选正文卡**（目录中同时有 `cover.png` 与 `card_*.png`）。
- **文末话题不上图**：最后一张卡片末尾若仅有 `#标签` 行，导出时会自动剥掉（标签请放在笔记文案或 `publish_xhs` 里，见 `rules/gzh_to_xhs.md`）。
- **发小红书到平台（xhs 库 + Cookie）**  
  - 推荐：开启 **「无自定义命令时使用内置发布脚本」**（默认开），在设置里填 **Cookie**，并在 **「Python 解释器」** 中填写**已安装 `xhs` 的** `python3` 绝对路径。  
  - **macOS + Homebrew Python** 常出现 `error: externally-managed-environment`（[PEP 668](https://peps.python.org/pep-0668/)），**不要**对系统/ brew 的 Python 强行 `pip install`（见官方提示）。**推荐**：在插件根目录执行一次：  
    `bash scripts/bootstrap_xhs_venv.sh`  
    可另传本机解释器，例如：  
    `bash scripts/bootstrap_xhs_venv.sh /opt/homebrew/opt/python@3.13/bin/python3.13`  
    成功后会生成 `scripts/xhs_venv/`，在 Obsidian 的「Python 解释器」里填：  
    `<你的插件目录>/scripts/xhs_venv/bin/python3`  
    （`scripts/xhs_venv` 已写入 `.gitignore`，仅本机使用。）  
  - 若你自建了别的 venv，用该 venv 里的 `bin/python3` 或 `bin/python` 做「Python 解释器」即可。非 Homebrew 环境可尝试 `python3 -m pip install xhs` 装到**当前**解释器，须与设置里为同一路径。  
  - Cookie 由插件经环境变量传入，**不必**再装 `python-dotenv`；`requests` 仅在你用命令行 `--api-mode` 时需要。见 `scripts/requirements-xhs-publish.txt`。  
  - 内置脚本为仓库内 **`scripts/publish_xhs_redbook.py`**（MDT 环境变量模式由插件启动）。从图形界面启动的 Obsidian 的 `PATH` 可能与终端不同，**「Python 解释器」** 建议始终填**绝对路径**。留空时 macOS 会尝试 `/opt/homebrew/bin/python3` 等。  
  - **不能把一份 Python 包目录覆盖所有平台**：`xhs` 依赖的 **lxml 等为原生扩展**（.so / .pyd），与系统 + CPU 绑定；Obsidian 又是「一份插件 zip 通吃 Win/macOS」。  
  - **可选：在本机把依赖打进 `scripts/xhs_bundles/<平台名>/`（用 PYTHONPATH 加载）**  
    在插件根执行 `npm run bundle:xhs-embed`（或 `node scripts/bundle_xhs_pip_target.mjs`；若遇 PEP 668，先建 venv 再设 `MDT_BUNDLE_PYTHON=…/xhs_venv/bin/python3` 执行）。成功后会生成本机目录，插件在发布时会**自动**设置 `PYTHONPATH`；**换电脑/换系统需重跑**；**仓库一般不提交**该目录。详见 `scripts/xhs_bundles/README.md`。  
  - 若你希望完全自定义流程，在 **发布命令** 中填写自己的可执行行，**优先于**内置脚本。  
  - 开启 **「启用外部发布脚本」** 后才会真正执行（dry-run 时脚本仍跑但会收到 `MDT_DRY_RUN=1`；内置 Python 在 dry-run 下只做校验不发布）。
- **仅渲染、不同步到小红书 app**：可关闭 **启用外部发布脚本**，只生成 `card_*.png`；若同时开了 **同步公众号图片草稿** 等，仍会走对应步骤。

子进程会收到与 `scripts/publish_xhs_stub.js` / 内置 Python 一致的环境变量，例如：

| 变量 | 含义 |
|------|------|
| `MDT_PUBLISH_XHS` | `publish_xhs.md` 绝对路径 |
| `MDT_XHS_IMAGES_DIR` | 卡片 PNG 所在目录 |
| `MDT_VAULT_ROOT` | 当前库根目录（若可取得） |
| `MDT_DRY_RUN` | `1` 表示 dry-run |
| `MDT_XHS_COOKIE` | 设置中填写 Cookie 时由插件注入（内置脚本亦识别 `XHS_COOKIE` 与项目 `.env`） |
| `MDT_XHS_AS_PRIVATE` | `1` 为仅自己可见；`0` 为公开（以脚本/库实际支持为准） |

### 其它

- **规则目录覆盖**：见上文 `rules`。
- **控制台调试日志**：排查工具栏、路径等问题时可开启。

---

## 使用流程（建议顺序）

1. **写文章或提纲**（当前 Markdown 笔记）。
2. 点击 **扩写**（或命令 `MDTP：扩写`）。  
   - 两次 LLM 调用，生成/更新 `publish_gzh.md`、`xhs_content.md`、`publish_xhs.md`；**不修改**当前笔记正文。  
   - 工作流开启时终稿在 `Published/gzh`、`Published/xhs`；关闭时在笔记同目录。
3. **发布公众号**：**公众号** 按钮或 `MDTP：发布公众号草稿`。  
   - 读取 `publish_gzh`，解析 `[配图…]`，按设置用 **智谱或方舟**生图，插图上传微信素材；正文由 **花生样式** 渲染为 HTML。  
   - **正文若首行是 `# 标题` 且与草稿标题一致，会自动去掉该行**，避免与草稿标题栏重复。  
   - 需至少一处配图占位；封面可选纯色标题卡或首张插图（见设置）。
4. **小红书**：准备 `xhs_content.md` 后，点 **小红书** 或 `MDTP：发布小红书`（默认会尝试内置 `publish_xhs_redbook.py`，需 Python 依赖 + 设置中 Cookie + 开启「启用外部发布脚本」）；只出图可用 `MDTP：仅渲染小红书卡片图` 或关闭「启用外部发布脚本」。
5. **视频号上传**：命令 `MDTP：视频号视频分片上传` 或左侧 **视频号** 图标，填写库内 `.mp4` 路径（与公众号同 AppID/Secret）。
6. **Seedance**：`MDTP：提交 Seedance 视频任务`，需方舟 Key 与模型配置。

### 独立流程

- **文→卡**：长文 → 小红书两份 md + 卡片 PNG（`MDTP：公众号文→小红书图文`）。  
- **Baoyu 风配图**：长文拆段 → 多提示词 → 逐张生图（与「小红书」HTML 卡片管线不同）。  
- **Seedance / 视频号**：见上。

---

## 界面入口（任选其一）

1. **窗口最底部状态栏左侧**：**「MDTP ▾」**（点击展开与左侧功能区相同的管线菜单；仅占少量宽度，避免挤没右侧字数）。  
2. **左侧 Ribbon**：**扩写、公众号、小红书、文→卡、葆玉图、视频号**（视频号打开上传对话框）。若关闭功能区，可在 **设置 → 外观** 中开启。  
3. **编辑器右键** / **文件列表中对 .md 右键**：上述流程（右键菜单不含视频号，请用命令或 Ribbon）。  
4. **命令面板**（`Cmd/Ctrl + P`）：搜索 **`MDTP：`**，包含扩写、公众号、小红书、文→卡、葆玉图、**Seedance 视频任务**、**视频号分片上传**。

---

## 常见问题

- **扩写报「找不到规则文件」**：确认 `rules/` 下两个必填 md 存在；或在 **规则目录覆盖** 中填写库内路径或绝对路径。  
- **同目录多篇笔记**：关闭工作流时扩写文件名固定可能**覆盖**；开启工作流时按会话分目录，一般**不**互相覆盖。  
- **公众号插图失败**：检查智谱/方舟 Key、模型名与额度；智谱默认 `glm-image` + 尺寸。  
- **公众号草稿失败**：核对 AppID/Secret、IP 白名单、`access_token`。  
- **正文排版与预期不符**：换 **排版主题**；微信编辑器对复杂 CSS 支持有限。  
- **小红书图全白或裁切怪**：试关「动态高度」或调高度上限；检查 `xhs_content.md` 分段。

---

## 调试（日志在哪、按钮在哪）

Obsidian **不会把插件日志写到单独磁盘文件**，只能看**开发者工具 Console**。

### 打开控制台

| 系统 | 快捷键 | 或菜单 |
|------|--------|--------|
| macOS | `Cmd + Option + I` | **帮助 → 切换开发者工具** |
| Windows / Linux | `Ctrl + Shift + I` | **Help → Toggle developer tools** |

过滤 **`md-to-platform`**。至少应看到：`[md-to-platform] 已加载 v0.1.0`。  
更细日志：设置中开启 **控制台调试日志**。

---

## 开发

```bash
npm install
npm run build
# 修改代码后重复 build，再复制 main.js 到库的插件目录
```
