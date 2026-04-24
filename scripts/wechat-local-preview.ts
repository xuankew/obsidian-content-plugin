#!/usr/bin/env node
/**
 * 本地生成与公众号草稿 `content` 一致的 HTML（不调微信 API、不上传图片）。
 *
 *   npm run wechat:preview -- <笔记.md> [输出.html] [主题id]
 *
 * 示例：
 *   npm run wechat:preview -- ./fixtures/sample-wechat.md ./wechat_preview.html wechat-elegant
 *
 * 主题 id 见 WECHAT_THEME_OPTIONS（如 wechat-default、wechat-elegant、warm-docs）。
 * 省略输出路径时，默认在与 .md 同目录生成 `同文件名_preview.html`；仅省略主题时用默认 wechat-elegant。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseHTML } from "linkedom";
import { wechatArticleHtmlForLocalPreview } from "../src/wechatHtml";

if (typeof globalThis.DOMParser === "undefined") {
	(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = class {
		parseFromString(html: string, _mime?: string) {
			const src = html.includes("<!DOCTYPE")
				? html
				: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
			return parseHTML(src).document;
		}
	} as unknown as typeof DOMParser;
}

const args = process.argv.slice(2);
const defaultTheme = "wechat-elegant";

function usage(): void {
	console.error(`用法: npm run wechat:preview -- <文章.md> [输出.html] [主题id]

  主题默认: ${defaultTheme}
  输出默认: 与 .md 同目录下 <basename>_preview.html`);
	process.exit(1);
}

if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
	usage();
}

const inPath = path.resolve(args[0]!);
if (!fs.existsSync(inPath)) {
	console.error(`找不到文件: ${inPath}`);
	process.exit(1);
}

let outPath: string;
let theme = defaultTheme;

if (args.length >= 3) {
	outPath = path.resolve(args[1]!);
	theme = args[2]!;
} else if (args.length === 2) {
	const second = args[1]!;
	if (/\.html?$/i.test(second) || second.includes(path.sep) || second === "." || second === "..") {
		outPath = path.resolve(second);
	} else {
		theme = second;
		const base = path.basename(inPath, path.extname(inPath));
		outPath = path.join(path.dirname(inPath), `${base}_preview.html`);
	}
} else {
	const base = path.basename(inPath, path.extname(inPath));
	outPath = path.join(path.dirname(inPath), `${base}_preview.html`);
}

const markdown = fs.readFileSync(inPath, "utf8");
const fragment = wechatArticleHtmlForLocalPreview(markdown, theme);
const title = path.basename(inPath);

const fullPage = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title.replace(/</g, "")} · 公众号本地预览</title>
  <style>
    body { margin: 0; background: #e8e8e8; min-height: 100vh; }
    .mdtp-preview-toolbar {
      font: 13px/1.4 system-ui, sans-serif;
      padding: 10px 16px;
      background: #2d2d2d;
      color: #eee;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .mdtp-preview-toolbar code { background: #444; padding: 2px 6px; border-radius: 4px; }
    .mdtp-preview-sheet {
      max-width: 900px;
      margin: 16px auto 40px;
      background: #fff;
      box-shadow: 0 2px 12px rgba(0,0,0,.08);
      border-radius: 4px;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="mdtp-preview-toolbar">
    本地预览 · 主题 <code>${theme.replace(/</g, "")}</code> · 与插件推送前 HTML（sanitize 后）一致；图片仍为本地/占位链接，未走微信素材库。
  </div>
  <div class="mdtp-preview-sheet">
${fragment}
  </div>
</body>
</html>
`;

fs.writeFileSync(outPath, fullPage, "utf8");
console.log(`已写入: ${outPath}`);
console.log(`用浏览器打开该文件即可查看排版。`);
