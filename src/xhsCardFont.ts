import * as fs from "node:fs";
import * as path from "node:path";
import type { Plugin } from "obsidian";
import { getPluginFolderPath } from "./rulesLoader";

/** 与 [LxgwWenkaiGB](https://github.com/lxgw/LxgwWenkaiGB) 的 font-family 一致，便于 @font-face 命中 */
export const XHS_LXGW_WENKAI_FAMILY = '"LXGW WenKai GB", "LXGW WenKai", "霞鹜文楷 GB"';

const BUNDLED_FONT_REL = path.join("fonts", "LXGWWenKaiGB-Regular.ttf");

/** 常见发布文件名（用户可能未严格重命名） */
const FONT_NAME_CANDIDATES = [
	"LXGWWenKaiGB-Regular.ttf",
	"LXGWWenKaiGB-Medium.ttf",
	"LXGWWenKaiGB-Bold.ttf",
	"LXGWWenKaiGB-Light.ttf",
];

let fontFaceCache: { key: string; css: string } | null = null;

function systemSansFallback(): string {
	return '"Source Han Sans CN","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
}

/** 卡片与封面根节点用的 font-family 串（文楷优先或纯系统） */
export function getXhsCardFontStack(useWenKai: boolean): string {
	if (useWenKai) {
		return `${XHS_LXGW_WENKAI_FAMILY}, ${systemSansFallback()}`;
	}
	return systemSansFallback();
}

function pickTtfInFontsDir(fontsDir: string): string | null {
	if (!fs.existsSync(fontsDir) || !fs.statSync(fontsDir).isDirectory()) {
		return null;
	}
	for (const name of FONT_NAME_CANDIDATES) {
		const p = path.join(fontsDir, name);
		if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.normalize(p);
	}
	let entries: string[];
	try {
		entries = fs.readdirSync(fontsDir);
	} catch {
		return null;
	}
	const ttfs = entries.filter(
		(f) => f.toLowerCase().endsWith(".ttf") && !f.startsWith("."),
	);
	if (ttfs.length === 0) return null;
	const scored = ttfs.map((f) => {
		const lower = f.toLowerCase();
		let score = 0;
		if (/lxgw|wenkai|文楷/.test(f)) score += 10;
		if (lower.includes("regular")) score += 5;
		if (lower.includes("medium")) score += 3;
		return { f, score };
	});
	scored.sort((a, b) => b.score - a.score);
	return path.join(fontsDir, scored[0].f);
}

function resolveWenKaiTtfPath(plugin: Plugin, customPath: string): string | null {
	const c = customPath.trim();
	if (c) {
		if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.normalize(c);
		return null;
	}
	try {
		const root = getPluginFolderPath(plugin);
		const exact = path.join(root, BUNDLED_FONT_REL);
		if (fs.existsSync(exact) && fs.statSync(exact).isFile()) return exact;
		const picked = pickTtfInFontsDir(path.join(root, "fonts"));
		if (picked) return picked;
	} catch {
		/* 无插件目录 */
	}
	return null;
}

/**
 * 生成注入 Shadow 的 @font-face（data URL，便于 html-to-image 内嵌）。
 * `sigPart` 纳入渲染缓存签名，字体变更会重渲。
 */
export function buildLXGWWenKaiFontFaceCss(
	plugin: Plugin,
	opts: { enabled: boolean; customPath: string },
): { fontFaceCss: string; sigPart: string } {
	if (!opts.enabled) {
		return { fontFaceCss: "", sigPart: "lxgw:off" };
	}
	const ttf = resolveWenKaiTtfPath(plugin, opts.customPath);
	if (!ttf) {
		return { fontFaceCss: "", sigPart: "lxgw:missing" };
	}
	let st: fs.Stats;
	try {
		st = fs.statSync(ttf);
	} catch {
		return { fontFaceCss: "", sigPart: "lxgw:err" };
	}
	const key = `${ttf}\0${st.mtimeMs}\0${st.size}`;
	if (fontFaceCache?.key === key) {
		return { fontFaceCss: fontFaceCache.css, sigPart: `lxgw:${st.mtimeMs}:${st.size}` };
	}
	let b64: string;
	try {
		b64 = fs.readFileSync(ttf).toString("base64");
	} catch {
		return { fontFaceCss: "", sigPart: "lxgw:readerr" };
	}
	const css = `@font-face{font-family:"LXGW WenKai GB";src:url(data:font/ttf;base64,${b64}) format("truetype");font-weight:100 900;font-style:normal;font-display:swap;}`;
	fontFaceCache = { key, css };
	return { fontFaceCss: css, sigPart: `lxgw:${st.mtimeMs}:${st.size}` };
}

/**
 * 文楷必须压在 `.mdtp-xhs-card-content` 上（部分主题对正文有继承/覆盖），用 !important；
 * 代码块再单独恢复等宽（见 xhsPreserveMonospaceInContentCss）。
 */
export function xhsWenKaiScopeCss(fontStack: string): string {
	return `
.mdtp-xhs-card-inner,
.mdtp-xhs-card-content,
.mdtp-xhs-cover-root {
	font-family: ${fontStack} !important;
}
`;
}

/** 在文楷全局覆盖之后，强制正文内 code/pre 仍用等宽 */
export function xhsPreserveMonospaceInContentCss(): string {
	return `
.mdtp-xhs-card-content code,
.mdtp-xhs-card-content pre,
.mdtp-xhs-card-content pre code {
	font-family: 'SF Mono', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', monospace !important;
}
`;
}
