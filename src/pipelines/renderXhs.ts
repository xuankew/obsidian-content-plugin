import * as path from "node:path";
import * as fs from "node:fs";
import type { TFile } from "obsidian";
import { Notice } from "obsidian";
import * as htmlToImage from "html-to-image";
import MarkdownIt from "markdown-it";
import type { MdToPlatformPlugin } from "../pluginTypes";
import {
	readXhsContentWithFallback,
	resolveXhsCardImagesFsDir,
	tryReadPublishXhsWithFallback,
} from "../noteArtifacts";
import {
	extractXhsCoverFields,
	sanitizeLastCardForImage,
} from "../xhsCardPostprocess";
import { hashString } from "../cache";
import { AUTO_REDBOOK_THEME_RAW } from "../xhsAutoRedbookThemeRaw.generated";
import {
	normalizeXhsTheme,
	XHS_AUTO_REDBOOK_OUTER_GRADIENT,
	XHS_CARD_CAPTURE_BG,
} from "../xhsThemes";
import {
	createPipelineProgressOverlay,
	type PipelineProgressHandle,
} from "../ui/pipelineProgress";
import { fetchViaRequestUrl } from "../lib/fetchViaRequestUrl";
import {
	buildLXGWWenKaiFontFaceCss,
	getXhsCardFontStack,
	xhsPreserveMonospaceInContentCss,
	xhsWenKaiScopeCss,
} from "../xhsCardFont";

const md = new MarkdownIt({ breaks: true, linkify: true });

/**
 * 与 Auto-Redbook-Skills `scripts/render_xhs.js` 一致：外层渐变 + 内层毛玻璃，正文样式来自 `assets/themes/<theme>.css`（合并为 AUTO_REDBOOK_THEME_RAW）。
 * 外层 / 内层 padding：略收紧以多装正文；段落间距主要靠 TYPO_BOOST 控制。
 */
const XHS_OUTER_PAD_PX = 46;
const XHS_INNER_PAD_PX = 54;
const XHS_INNER_RADIUS_PX = 20;

/** 对齐 `render_xhs.js` 中 `.card-inner` 的基础层（各主题 CSS 可覆盖 background 等） */
const XHS_AUTO_REDBOOK_INNER_CSS = `
.mdtp-xhs-card-inner{
	box-sizing:border-box;
	flex:1;
	display:flex;
	flex-direction:column;
	min-height:0;
	width:100%;
	background:rgba(255,255,255,0.95);
	border-radius:${XHS_INNER_RADIUS_PX}px;
	padding:${XHS_INNER_PAD_PX}px;
	box-shadow:0 8px 32px rgba(0,0,0,0.1);
	backdrop-filter:blur(10px);
	overflow:hidden;
}
.mdtp-xhs-card-content{box-sizing:border-box;margin:0;padding:0}
`;

/**
 * 强化层级 + **压紧垂直间距**。主题里 p/h 多为固定 px 且无 !important，此处统一覆盖，减少段落间空档、避免固定高度卡片底部被裁切。
 */
const XHS_MARKDOWN_TYPO_BOOST = `
.mdtp-xhs-card-content strong,
.mdtp-xhs-card-content b {
	font-weight: 800 !important;
	letter-spacing: 0.01em;
}
.mdtp-xhs-card-content h1,
.mdtp-xhs-card-content h2,
.mdtp-xhs-card-content h3 {
	font-weight: 800 !important;
	letter-spacing: 0.02em;
}
.mdtp-xhs-card-content p {
	font-weight: 400;
	margin-top: 0 !important;
	margin-bottom: 0.5em !important;
	line-height: 1.62 !important;
}
.mdtp-xhs-card-content h1 {
	margin-top: 0 !important;
	margin-bottom: 0.38em !important;
}
.mdtp-xhs-card-content h2 {
	margin-top: 0.22em !important;
	margin-bottom: 0.26em !important;
}
.mdtp-xhs-card-content h3 {
	margin-top: 0.18em !important;
	margin-bottom: 0.22em !important;
}
.mdtp-xhs-card-content li {
	line-height: 1.55 !important;
	margin-bottom: 0.22em !important;
}
.mdtp-xhs-card-content ol,
.mdtp-xhs-card-content ul {
	margin-top: 0.24em !important;
	margin-bottom: 0.34em !important;
}
.mdtp-xhs-card-content blockquote {
	margin: 0.4em 0 !important;
	padding: 0.5em 0.75em 0.5em 0.9em !important;
}
.mdtp-xhs-card-content blockquote p {
	margin-bottom: 0.35em !important;
}
.mdtp-xhs-card-content blockquote p:last-child {
	margin-bottom: 0 !important;
}
.mdtp-xhs-card-content hr {
	margin: 0.4em 0 !important;
}
.mdtp-xhs-card-content pre {
	margin: 0.4em 0 !important;
}
.mdtp-xhs-card-content img {
	margin: 0.4em auto !important;
}
.mdtp-xhs-card-content .tags-container {
	margin-top: 0.6em !important;
	padding-top: 0.4em !important;
}
.mdtp-xhs-card-content li strong,
.mdtp-xhs-card-content li b {
	font-weight: 800 !important;
}
`;

/** 与 xhs_content、分隔符、主题与尺寸绑定；一致且 PNG 齐全时可跳过 html-to-image */
const XHS_CARDS_SIG = ".mdtp-xhs-cards.sig";

/** 版式/CSS 升级时递增，避免误用旧缓存 PNG */
const XHS_CARD_LAYOUT_VERSION = "auto-redbook-v9-compact-vertical";

function coverLayoutCss(w: number, cardHeight: number, outerBg: string): string {
	const sx = w / 1080;
	const m = (n: number) => `${Math.round(n * sx)}px`;
	return `
.mdtp-xhs-cover-root {
	box-sizing: border-box;
	width: ${w}px;
	min-height: ${cardHeight}px;
	height: ${cardHeight}px;
	background: ${outerBg};
	display: flex;
	flex-direction: column;
}
.mdtp-xhs-cover-wrap {
	box-sizing: border-box;
	flex: 1;
	padding: ${m(65)};
	display: flex;
	min-height: 0;
}
.mdtp-xhs-cover-inner {
	box-sizing: border-box;
	flex: 1;
	background: #f3f3f3;
	border-radius: ${m(25)};
	padding: ${m(80)} ${m(85)};
	display: flex;
	flex-direction: column;
	min-height: 0;
	box-shadow: 0 8px 32px rgba(0,0,0,0.1);
}
.mdtp-xhs-cover-emoji {
	font-size: ${m(180)};
	line-height: 1.12;
	margin-bottom: ${m(50)};
	flex-shrink: 0;
}
.mdtp-xhs-cover-title {
	font-weight: 900;
	line-height: 1.35;
	color: #111827;
	flex: 1;
	word-break: break-word;
	overflow-wrap: anywhere;
	min-height: 0;
}
.mdtp-xhs-cover-subtitle {
	font-weight: 400;
	line-height: 1.4;
	color: #111827;
	margin-top: ${m(40)};
	flex-shrink: 0;
	opacity: 0.92;
}
`;
}

function makeXhsCardsRenderSig(
	plugin: MdToPlatformPlugin,
	raw: string,
	partCount: number,
	publishXhsSnippet: string,
	fontSigPart: string,
): string {
	const s = plugin.settings;
	return hashString(
		[
			XHS_CARD_LAYOUT_VERSION,
			raw,
			s.xhsDelimiter,
			normalizeXhsTheme(s.xhsTheme),
			String(s.xhsWidth),
			String(s.xhsHeight),
			String(s.xhsDpr),
			String(s.xhsMaxHeight),
			String(s.xhsDynamicHeight),
			String(partCount),
			String(s.xhsCoverEnabled),
			fontSigPart,
			publishXhsSnippet.slice(0, 6000),
		].join("\0"),
	);
}

export async function runRenderXhsPipeline(
	plugin: MdToPlatformPlugin,
	file: TFile,
	opts?: {
		suppressNotice?: boolean;
		/** 由外层传入则不在此关闭；未传则本函数自建并收尾 */
		progress?: PipelineProgressHandle;
	},
): Promise<string> {
	let ownProgress: PipelineProgressHandle | undefined;
	const progress = opts?.progress ?? (ownProgress = createPipelineProgressOverlay("MDTP 渲染小红书卡片"));

	try {
		progress.setPhase("正在读取 xhs_content…", 0.08, false);
		const raw = await readXhsContentWithFallback(plugin, file);

		let re: RegExp;
		try {
			const rawPat = (plugin.settings.xhsDelimiter || "").trim() || "^---\\s*$";
			// 多张卡片需全局分割；与 Auto-Redbook 等「单独一行 ---」分页一致
			const flags = rawPat.includes("g") ? "m" : "mg";
			re = new RegExp(rawPat, flags);
		} catch {
			throw new Error("小红书分隔正则无效");
		}
		const parts = raw.split(re).filter((p) => p.trim().length > 0);
		if (parts.length === 0) {
			throw new Error("xhs_content 分段为空");
		}

		progress.setPhase("正在读取 publish_xhs（封面文案）…", 0.12, false);
		const publishMd = await tryReadPublishXhsWithFallback(plugin, file);
		const publishSig = publishMd ?? "";

		progress.setPhase(`准备渲染 ${parts.length} 张卡片为 PNG…`, 0.15, true);

		const outDir = resolveXhsCardImagesFsDir(plugin, file, plugin.settings);
		const { fontFaceCss, sigPart: fontSigPart } = buildLXGWWenKaiFontFaceCss(
			plugin,
			{
				enabled: plugin.settings.xhsUseLXGWWenKai,
				customPath: plugin.settings.xhsFontTtfPath,
			},
		);
		if (plugin.settings.xhsUseLXGWWenKai && !fontFaceCss) {
			const msg =
				"已开启霞鹜文楷但未加载到 TTF：请将 .ttf 放入插件目录 fonts/（与 main.js 同级），或设置里填写绝对路径。见 fonts/README.md";
			console.warn(`[md-to-platform] ${msg}`);
			if (!opts?.suppressNotice) {
				new Notice(msg, 12000);
			}
		}
		const wenKaiActive = Boolean(fontFaceCss);
		const fontStack = getXhsCardFontStack(wenKaiActive);
		const renderSig = makeXhsCardsRenderSig(
			plugin,
			raw,
			parts.length,
			publishSig,
			fontSigPart,
		);
		const sigPath = path.join(outDir, XHS_CARDS_SIG);
		let reusePng = false;
		if (fs.existsSync(sigPath)) {
			try {
				const prev = fs.readFileSync(sigPath, "utf8").trim();
				if (prev === renderSig) {
					let allOk = true;
					for (let i = 0; i < parts.length; i++) {
						const fp = path.join(outDir, `card_${i + 1}.png`);
						if (!fs.existsSync(fp) || fs.statSync(fp).size === 0) {
							allOk = false;
							break;
						}
					}
					if (allOk && plugin.settings.xhsCoverEnabled) {
						const cov = path.join(outDir, "cover.png");
						if (!fs.existsSync(cov) || fs.statSync(cov).size === 0) {
							allOk = false;
						}
					}
					reusePng = allOk;
				}
			} catch {
				reusePng = false;
			}
		}

		if (reusePng) {
			progress.setPhase(
				`内容与版式未变且已有 ${parts.length} 张 PNG，跳过卡片渲染…`,
				0.45,
				false,
			);
			if (!opts?.suppressNotice) {
				new Notice(`已复用 ${parts.length} 张卡片：${outDir}`);
			}
			if (opts?.progress) {
				progress.setPhase(`已复用 ${parts.length} 张卡片 PNG`, 0.85, false);
			} else {
				progress.setPhase("已完成", 1, false);
				await new Promise((r) => setTimeout(r, 280));
			}
			return outDir;
		}

		const tid = normalizeXhsTheme(plugin.settings.xhsTheme);
		const outerBg =
			XHS_AUTO_REDBOOK_OUTER_GRADIENT[tid] ??
			XHS_AUTO_REDBOOK_OUTER_GRADIENT.default;
		const captureBg =
			XHS_CARD_CAPTURE_BG[tid] ?? XHS_CARD_CAPTURE_BG.default;
		const w = plugin.settings.xhsWidth;
		const baseH = plugin.settings.xhsHeight;
		const dpr = plugin.settings.xhsDpr;
		const maxH = plugin.settings.xhsMaxHeight;

		/* Shadow root：隔离 Obsidian 全局样式（含对 p/blockquote 的 !important），否则主题排版几乎不生效，只剩内联的外层渐变 */
		const host = document.body.appendChild(document.createElement("div"));
		host.style.cssText =
			"position:fixed;left:-10000px;top:0;pointer-events:none;z-index:-1;";
		const shadow = host.attachShadow({ mode: "open" });
		const styleEl = document.createElement("style");
		const themeRaw = AUTO_REDBOOK_THEME_RAW[tid] ?? AUTO_REDBOOK_THEME_RAW.default;
		const fontBlock = fontFaceCss ? `${fontFaceCss}\n` : "";
		const wenKaiScope = wenKaiActive
			? `${xhsWenKaiScopeCss(fontStack)}\n${xhsPreserveMonospaceInContentCss()}\n`
			: "";
		styleEl.textContent =
			fontBlock +
			XHS_AUTO_REDBOOK_INNER_CSS +
			"\n" +
			themeRaw +
			"\n" +
			XHS_MARKDOWN_TYPO_BOOST +
			"\n" +
			wenKaiScope +
			coverLayoutCss(w, baseH, outerBg);
		shadow.appendChild(styleEl);

		const g = globalThis as typeof globalThis & { fetch?: typeof fetch };
		const prevFetch = g.fetch;
		try {
			g.fetch = fetchViaRequestUrl as typeof fetch;

			if (plugin.settings.xhsCoverEnabled) {
				progress.setPhase("正在导出封面 cover.png…", 0.16, false);
				const coverFields = extractXhsCoverFields(publishMd, parts[0] ?? "");
				const coverRoot = document.createElement("div");
				coverRoot.className = "mdtp-xhs-cover-root";
				const wrap = document.createElement("div");
				wrap.className = "mdtp-xhs-cover-wrap";
				const innerC = document.createElement("div");
				innerC.className = "mdtp-xhs-cover-inner";
				const elEmoji = document.createElement("div");
				elEmoji.className = "mdtp-xhs-cover-emoji";
				elEmoji.textContent = coverFields.emoji;
				const elTitle = document.createElement("div");
				elTitle.className = "mdtp-xhs-cover-title";
				elTitle.textContent = coverFields.title;
				const sx = w / 1080;
				const tChars = [...coverFields.title].length;
				let titlePx = Math.round(130 * sx);
				if (tChars > 18) titlePx = Math.round(88 * sx);
				else if (tChars > 12) titlePx = Math.round(108 * sx);
				elTitle.style.fontSize = `${titlePx}px`;
				const elSub = document.createElement("div");
				elSub.className = "mdtp-xhs-cover-subtitle";
				elSub.style.fontSize = `${Math.round(72 * sx)}px`;
				elSub.textContent = coverFields.subtitle;
				innerC.appendChild(elEmoji);
				innerC.appendChild(elTitle);
				innerC.appendChild(elSub);
				wrap.appendChild(innerC);
				coverRoot.appendChild(wrap);
				shadow.appendChild(coverRoot);
				await new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				});
				await new Promise<void>((r) => setTimeout(r, 50));
				let coverDataUrl: string;
				try {
					coverDataUrl = await htmlToImage.toPng(coverRoot, {
						pixelRatio: dpr,
						width: w,
						height: baseH,
						backgroundColor: captureBg,
						cacheBust: true,
					});
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					throw new Error(`封面 cover.png html-to-image 导出失败（${msg}）`);
				}
				const coverB64 = coverDataUrl.replace(/^data:image\/\w+;base64,/, "");
				fs.writeFileSync(
					path.join(outDir, "cover.png"),
					Buffer.from(coverB64, "base64"),
				);
				shadow.removeChild(coverRoot);
			}

			for (let i = 0; i < parts.length; i++) {
				const frac = parts.length > 0 ? (i + 1) / parts.length : 1;
				progress.setPhase(
					`正在导出第 ${i + 1}/${parts.length} 张卡片（html-to-image）…`,
					0.15 + frac * 0.8,
					false,
				);
				let partMd = parts[i].trim();
				if (i === parts.length - 1) {
					const stripped = sanitizeLastCardForImage(partMd);
					if (stripped.trim().length > 0) partMd = stripped;
				}
				const outer = document.createElement("div");
				outer.style.cssText = [
					`box-sizing:border-box`,
					`width:${w}px`,
					`min-height:${baseH}px`,
					`padding:${XHS_OUTER_PAD_PX}px`,
					`background:${outerBg}`,
					`display:flex`,
					`flex-direction:column`,
					`font-family:${fontStack}`,
				].join(";");

				const inner = document.createElement("div");
				inner.className = "mdtp-xhs-card-inner";
				inner.style.justifyContent = "";

				const content = document.createElement("div");
				content.className = "mdtp-xhs-card-content";
				content.innerHTML = md.render(partMd);
				inner.appendChild(content);
				outer.appendChild(inner);
				shadow.appendChild(outer);

				await new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				});
				await new Promise<void>((r) => setTimeout(r, 50));

				/* 固定高度时：正文块明显矮于内层白卡，则垂直居中，减轻「上半截一坨、下半截全空」 */
				if (!plugin.settings.xhsDynamicHeight) {
					void inner.offsetHeight;
					const innerH = inner.clientHeight;
					const contentH = content.scrollHeight;
					if (innerH > 120 && contentH / innerH < 0.56) {
						inner.style.justifyContent = "center";
					}
				}

				if (plugin.settings.xhsDynamicHeight) {
					const rawH = outer.scrollHeight;
					const h = Math.min(Math.max(rawH, baseH), maxH);
					outer.style.height = `${h}px`;
				} else {
					outer.style.height = `${baseH}px`;
				}

				let dataUrl: string;
				try {
					dataUrl = await htmlToImage.toPng(outer, {
						pixelRatio: dpr,
						width: w,
						height: outer.offsetHeight,
						backgroundColor: captureBg,
						cacheBust: true,
					});
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					throw new Error(
						`第 ${i + 1} 张卡片 html-to-image 导出失败（${msg}）。若正文含跨域图片，可先去掉图片或换用本地图。`,
					);
				}
				const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
				const buf = Buffer.from(b64, "base64");
				const out = path.join(outDir, `card_${i + 1}.png`);
				fs.writeFileSync(out, buf);
				shadow.removeChild(outer);
			}
			fs.writeFileSync(sigPath, renderSig, "utf8");
		} finally {
			g.fetch = prevFetch;
			document.body.removeChild(host);
		}

		if (opts?.progress) {
			progress.setPhase(`已导出 ${parts.length} 张卡片 PNG`, 0.85, false);
		} else {
			progress.setPhase("已完成", 1, false);
			await new Promise((r) => setTimeout(r, 280));
		}

		if (!opts?.suppressNotice) {
			const cov = plugin.settings.xhsCoverEnabled ? "、cover.png" : "";
			new Notice(`已生成 ${parts.length} 张卡片${cov}：${outDir}`);
		}
		return outDir;
	} finally {
		ownProgress?.close();
	}
}
