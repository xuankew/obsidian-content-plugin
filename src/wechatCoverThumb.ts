import * as htmlToImage from "html-to-image";

/** 公众号草稿封面图推荐比例约 2.35:1，此处 940×400 便于标题居中、字够大 */
const COVER_W = 940;
const COVER_H = 400;

/** 常用背景色 + 配套文字色（保证对比度） */
export const WECHAT_COVER_BG_PRESETS: readonly {
	id: string;
	name: string;
	bg: string;
	text: string;
}[] = [
	{ id: "mint", name: "浅青绿（默认）", bg: "#E8F2EE", text: "#1a3d32" },
	{ id: "cream", name: "暖米白", bg: "#F5F0E8", text: "#3d2e1f" },
	{ id: "mist", name: "浅灰蓝", bg: "#E8EEF5", text: "#1e2a3a" },
	{ id: "blush", name: "浅藕粉", bg: "#F5E8EC", text: "#4a2433" },
	{ id: "sage", name: "豆沙绿", bg: "#E5EDE5", text: "#253828" },
	{ id: "ivory", name: "象牙白", bg: "#FAF8F3", text: "#2c2c2c" },
	{ id: "slate", name: "岩灰", bg: "#ECEFF1", text: "#263238" },
	{ id: "marine", name: "深海蓝", bg: "#1B2D3A", text: "#E8F1F5" },
	{ id: "charcoal", name: "炭灰", bg: "#2E3440", text: "#ECEFF4" },
] as const;

const DEFAULT_COVER_PRESET_ID = "mint";

export function normalizeWechatCoverBgPreset(id: string): string {
	const t = id.trim();
	if (WECHAT_COVER_BG_PRESETS.some((p) => p.id === t)) return t;
	return DEFAULT_COVER_PRESET_ID;
}

export function getWechatCoverColors(presetId: string): { bg: string; text: string } {
	const id = normalizeWechatCoverBgPreset(presetId);
	const p = WECHAT_COVER_BG_PRESETS.find((x) => x.id === id)!;
	return { bg: p.bg, text: p.text };
}

export interface WechatCoverThumbRenderOptions {
	backgroundColor: string;
	textColor: string;
	/** 0 表示按标题长度自动；否则为固定像素（建议 28–52） */
	fontSizePx: number;
}

/**
 * 纯色背景 + 标题居中，用于公众号缩略图（不依赖 CogView，避免与正文插图争抢风格）。
 */
export async function renderWechatCoverThumbPng(
	title: string,
	options: WechatCoverThumbRenderOptions,
): Promise<Buffer> {
	const raw = title.trim() || "未命名";
	const lines = splitTitleForCover(raw);
	const fontPx =
		options.fontSizePx > 0
			? Math.min(64, Math.max(24, Math.round(options.fontSizePx)))
			: raw.length > 48
				? 32
				: raw.length > 34
					? 36
					: raw.length > 22
						? 40
						: 44;

	const COVER_BG = options.backgroundColor;
	const COVER_TEXT = options.textColor;

	const host = document.body.appendChild(document.createElement("div"));
	host.style.cssText =
		"position:fixed;left:-10000px;top:0;pointer-events:none;z-index:-1;";

	const card = document.createElement("div");
	card.style.cssText = [
		`box-sizing:border-box`,
		`width:${COVER_W}px`,
		`height:${COVER_H}px`,
		`background:${COVER_BG}`,
		`display:flex`,
		`flex-direction:column`,
		`align-items:center`,
		`justify-content:center`,
		`padding:32px 48px`,
	].join(";");

	const wrap = document.createElement("div");
	wrap.style.cssText = [
		`text-align:center`,
		`color:${COVER_TEXT}`,
		`font-weight:600`,
		`line-height:1.38`,
		`max-width:100%`,
		`font-family:PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif`,
		`font-size:${fontPx}px`,
	].join(";");

	lines.forEach((line, i) => {
		const lineEl = document.createElement("div");
		lineEl.textContent = line;
		if (i > 0) lineEl.style.marginTop = "10px";
		wrap.appendChild(lineEl);
	});
	card.appendChild(wrap);
	host.appendChild(card);

	await new Promise<void>((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});

	try {
		const dataUrl = await htmlToImage.toPng(card, {
			pixelRatio: 2,
			width: COVER_W,
			height: COVER_H,
			backgroundColor: COVER_BG,
		});
		const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
		return Buffer.from(b64, "base64");
	} finally {
		document.body.removeChild(host);
	}
}

function splitTitleForCover(t: string): string[] {
	if (t.length <= 22) return [t];
	const mid = Math.floor(t.length / 2);
	let cut = t.lastIndexOf("，", mid + 6);
	if (cut < 6) cut = t.lastIndexOf("、", mid + 6);
	if (cut < 6) cut = t.lastIndexOf(" ", mid + 6);
	if (cut < 6) cut = mid;
	const a = t.slice(0, cut + 1).trim();
	const b = t.slice(cut + 1).trim();
	if (!b) return [t];
	return [a, b];
}
