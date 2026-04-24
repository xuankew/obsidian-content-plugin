# MD to Platform (Obsidian plugin)

In Obsidian **desktop**, use the **current note** to: **expand** drafts, create **WeChat Official Account drafts** (Zhipu or Volcengine illustrations + **Huasheng-style** HTML body), **Xiaohongshu (XHS) card PNGs** (optional local publish script), **long article → XHS cards**, **Baoyu-style multi-image prompts**, **Volcengine Ark Seedance video jobs**, and **WeChat Channels in-vault `.mp4` chunked upload** (init + chunk; same credentials as the OA).

**中文说明：** [README.md](./README.md)

---

## Environment

- Obsidian **desktop** (desktop-only; uses Node FS, child processes, and network).
- Network access to your **LLM / image APIs** (DeepSeek, Zhipu, OpenAI-compatible) and, when used, **WeChat Official Account**, **Volcengine Ark**.

---

## Installation

### Option A: From this repo (development)

1. Clone or copy this folder.
2. From the project root:
   ```bash
   npm install
   npm run build
   ```
   This generates `main.js` in the repo root.
3. Copy the whole plugin folder to your vault:  
   `<vault>/.obsidian/plugins/md-to-platform/`  
   It must contain at least:
   - `manifest.json`
   - `main.js`
   - `rules/` (see below; **must sit next to `main.js`**)

4. Restart Obsidian, disable safe mode under **Settings → Community plugins**, and enable **MD to Platform**.

### Option B: Prebuilt package

Unzip into `.obsidian/plugins/md-to-platform/` and ensure `rules/` and `main.js` exist.

---

## The `rules` folder (required)

By default, rules are read from **`vault/.obsidian/plugins/md-to-platform/rules/`** (next to `main.js`):

| File | Role |
|------|------|
| `公众号扩写规则.md` | System prompt for expanding the WeChat article (**required**) |
| `gzh_to_xhs.md` | System prompt for converting the article to XHS card copy (**required**) |
| `baoyu_xhs_images.md` | Baoyu-style: page split + image prompt tone (**optional**; built-in default if missing) |

If either of the first two is missing, expand / article→cards will error. Illustrations follow **Image channel** in settings (Zhipu `glm-image` or Volcengine Seedream, etc.), not a single hard-coded model.

**Rules directory override** (in settings):

- **Empty**: use the plugin’s `rules/` (via `manifest.dir`, fallback to `vault/.obsidian/plugins/<id>/`).
- **Absolute path**: e.g. `/Users/you/rules`.
- **Path relative to vault root**: e.g. `rules` → `vault/rules/`.

---

## Writing workflow & path resolution

By default, **Sandbox / Published** layout is **on** (toggle under **Settings → MD to Platform → Writing workflow**). When **off**, behavior matches the legacy layout: artifacts live **next to the current note**.

### Suggested vault layout (example)

```
06-写作/                          ← workflow root (setting)
  01-Inbox/                       ← suggested drafts (not enforced)
  02-Sanbox/                      ← sandbox folder name (configurable)
    <session>/                    ← one folder per note; see “Session folder name”
      publish_gzh.md …            ← tmp; cleaned after WeChat success
      publish_xhs.md …
      xhs_content.md …
      wechat_images/ …            ← WeChat pipeline cache
  03-Published/                   ← published root (configurable)
    gzh/<session>/publish_gzh.md
    xhs/<session>/publish_xhs.md
    xhs/<session>/xhs_content.md
    xhs/<session>/card_*.png      ← card PNGs (workflow on)
    xhs/<session>/baoyu_cogview/  ← Baoyu multi-image output (separate from HTML cards)
```

### Session folder name

For the **active note**, the plugin builds a session folder name from a **sanitized note basename** plus an **8-character hash of the note path**, so different notes do not collide.

### How paths are resolved

All workflow paths are **vault-relative**. When parsing settings:

- Leading/trailing spaces are trimmed; segments split on `/` and `\`.
- If **any segment is `..`**, that setting **falls back to the built-in default**.
- Notices after **Expand** / **Article → cards** show the **effective** path.

Configurable: **workflow root**, **sandbox folder name**, **published root** (multi-segment OK; no `..`).

### Read order when workflow is **on**

| File | Order |
|------|-------|
| `publish_gzh.md` | `Published/gzh/<session>/` → `Sandbox/<session>/` → next to note → plugin `.cache` |
| `xhs_content.md`, `publish_xhs.md` | `Published/xhs/<session>/` → `Sandbox/<session>/` → next to note → `.cache` |

When workflow is **off**: **next to note** → `.cache`.

### When tmp is deleted

- After **WeChat draft succeeds**: remove WeChat tmp in Sandbox for that session (`wechat_images`, Sandbox `publish_gzh.md`, intermediate `publish_gzh_with_images.md` / `wechat_article.html`). `Published/gzh` stays.
- After **all XHS card images succeed**: remove Sandbox `publish_xhs.md` and `xhs_content.md`. `Published/xhs` stays.

### Where card PNGs go

- **Workflow on**: PNGs always go to `<workflow root>/<published>/xhs/<session>/`.
- **Workflow off**: **Save card images next to note** and `.cache`.

---

## Settings overview

### LLM & text

- **Provider**: DeepSeek / Zhipu / OpenAI-compatible (fill Base URL for compatible mode).
- **API Key**: required for text expansion.
- **Text model**: e.g. `deepseek-chat`, `glm-4-flash`.

### Expand

- **Target length (Chinese characters) for WeChat expand**: default **2000**, injected into the expand **user** prompt together with `公众号扩写规则.md`; models may still drift—tune the number or edit the rule file.
- **Editor MDTP tip**: **Off** by default; when on, shown at **bottom-left**. The status bar uses a single **“MDTP ▾”** control (menu) so a long row of links does not crowd out the word count on the right.

### Illustrations (WeChat / Baoyu share)

- **Image-only key (optional)**: e.g. DeepSeek for text + separate Zhipu key for images.
- **Image channel**:
  - **Zhipu**: `https://open.bigmodel.cn/api/paas/v4/images/generations`. Default model **`glm-image`**, default size **`1280x1280`** (configurable). Prefers `response_format: b64_json`; falls back to downloading a temporary URL if needed.
  - **Volcengine Ark**: Seedream etc.; separate Ark key, endpoint, model id, size, watermark.
- **Zhipu image model**: default `glm-image`; other documented models (e.g. `cogview-3-flash`) follow Zhipu docs.

### Seedance (Volcengine Ark)

- **Seedance model id**: for command **MDTP: Submit Seedance video task**; requires Ark API key.

### Cache

- TTL and cleanup interval for `.cache` under the plugin data directory.

### Writing workflow

- **Enable Sandbox / Published layout**: see above.
- **Workflow vault root** (default `06-写作`).
- **Sandbox / Published folder names** (defaults `02-Sanbox`, `03-Published`), relative to workflow root.

### WeChat Official Account

- **AppID / AppSecret** for `access_token`, media upload, drafts.
- **Layout themes**: same lineage as open-source [**huasheng_editor**](https://github.com/alchaincyf/huasheng_editor) (inline CSS; multi-image blocks may use tables for the OA editor). The WeChat backend may render fonts/gradients/shadows slightly differently than a browser preview.
- **Draft cover thumbnail**: solid-color title card (from note title) or **first body image**.
- **Solid cover**: **background presets**, **title font size** (`0` = auto by title length).
- **Channels · chunked upload**: init/chunk paths (relative to `api.weixin.qq.com`), chunk size, `media_type`; **same AppID/Secret** as OA. Plugin implements documented chunked upload only.

IP allowlisting is often required; home broadband IP changes can cause intermittent failures. No HTTP proxy built in.

### Xiaohongshu (XHS)

- **Card delimiter (regex)**, **theme / width / height / DPR / dynamic height**.
- **Save next to note**: only when **writing workflow is off**; when **on**, PNG dir is fixed under `Published/xhs/<session>/`.
- **External publish command**, **dry-run**: env vars `MDT_PUBLISH_XHS`, `MDT_XHS_IMAGES_DIR`, `MDT_VAULT_ROOT`, `MDT_DRY_RUN` (same as `scripts/publish_xhs_stub.js`).

### Other

- **Rules directory override**: see above.
- **Debug log**: optional verbose console logging.

---

## Suggested usage order

1. Draft in a Markdown note.
2. **Expand** (`MDTP: Expand`): two LLM calls; writes `publish_gzh.md`, `xhs_content.md`, `publish_xhs.md`; **does not change the note body**.
3. **WeChat**: placeholders → Zhipu or Ark images → **Huasheng-style** HTML → draft. If the **first line is `# Title` and matches the draft title**, that line is **stripped** so the title is not duplicated.
4. **XHS**: need `xhs_content.md`; **XHS** or render-only command.
5. **Channels upload**: command **MDTP: WeChat Channels chunked upload** or ribbon **Channels**; vault-relative `.mp4` path.
6. **Seedance**: **MDTP: Submit Seedance video task** (Ark key + model).

Standalone: **Article → XHS cards**, **Baoyu-style images**, **Seedance**, **Channels** — see commands.

---

## UI entry points

1. **Status bar (left)**: **“MDTP ▾”** opens the same pipeline menu (compact; no Channels or Seedance here—use command or ribbon).
2. **Ribbon**: same pipelines plus **Channels** (opens upload dialog). If the ribbon is hidden, enable it under **Settings → Appearance**.
3. **Editor / file menu** context: pipelines above (no Channels; use command or ribbon).
4. **Command palette**: search **`MDTP:`**, including **Seedance** and **Channels chunked upload**.

---

## FAQ (short)

- **Rules not found**: check filenames; set override if rules live elsewhere.
- **Multiple notes in one folder**: with workflow **on**, session folders avoid overwriting; with workflow **off**, fixed filenames can still overwrite.
- **WeChat / image errors**: keys, model, quota; Zhipu default `glm-image` + size.
- **Draft fails**: AppID/Secret, IP whitelist, `access_token`.
- **Layout looks wrong**: try another **theme**; WeChat editor CSS support is limited.
- **XHS cards blank or cropped**: try disabling dynamic height or adjust height cap; check `xhs_content.md` segments.

---

## Debugging

Use **Developer Tools → Console**; filter `md-to-platform`. Optional verbose logging in plugin settings. Obsidian does not write plugin logs to a separate file.

---

## Development

```bash
npm install
npm run build
# copy main.js into the vault plugin folder after changes
```

For the full Chinese text and extra detail, see [README.md](./README.md).
