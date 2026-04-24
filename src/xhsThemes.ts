/** 设置页下拉：8 套小红书卡片主题 */
export const XHS_THEME_OPTIONS: readonly { id: string; name: string }[] = [
	{ id: "default", name: "默认简约灰" },
	{ id: "playful-geometric", name: "Playful Geometric" },
	{ id: "neo-brutalism", name: "Neo-Brutalism" },
	{ id: "botanical", name: "Botanical" },
	{ id: "professional", name: "Professional" },
	{ id: "retro", name: "Retro" },
	{ id: "terminal", name: "Terminal" },
	{ id: "sketch", name: "Sketch" },
] as const;

/** 与 Auto-Redbook `scripts/render_xhs.js` 中 `THEME_BACKGROUNDS` 一致（外层 card-container 背景） */
export const XHS_AUTO_REDBOOK_OUTER_GRADIENT: Record<string, string> = {
	default: "linear-gradient(180deg, #f3f3f3 0%, #f9f9f9 100%)",
	"playful-geometric": "linear-gradient(135deg, #8B5CF6 0%, #F472B6 100%)",
	"neo-brutalism": "linear-gradient(135deg, #FF4757 0%, #FECA57 100%)",
	botanical: "linear-gradient(135deg, #4A7C59 0%, #8FBC8F 100%)",
	professional: "linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)",
	retro: "linear-gradient(135deg, #D35400 0%, #F39C12 100%)",
	terminal: "linear-gradient(135deg, #0D1117 0%, #161B22 100%)",
	sketch: "linear-gradient(135deg, #555555 0%, #888888 100%)",
};

/**
 * html-to-image 对 `background: linear-gradient(...)` 的卡片需填一近似纯色兜底（与外层视觉接近即可）。
 */
export const XHS_CARD_CAPTURE_BG: Record<string, string> = {
	default: "#f3f3f3",
	"playful-geometric": "#a855f7",
	"neo-brutalism": "#ff6b6b",
	botanical: "#5c8f6a",
	professional: "#2563eb",
	retro: "#d35400",
	terminal: "#0d1117",
	sketch: "#6b7280",
};

export const XHS_THEMES: Record<string, { bg: string; card: string; text: string }> = {
	default: {
		bg: "#f3f4f6",
		card: "#ffffff",
		text: "#1f2937",
	},
	"playful-geometric": {
		bg: "#eef2ff",
		card: "#e0e7ff",
		text: "#312e81",
	},
	"neo-brutalism": {
		bg: "#fef08a",
		card: "#ffffff",
		text: "#0f0f0f",
	},
	botanical: {
		bg: "#ecfdf5",
		card: "#d1fae5",
		text: "#065f46",
	},
	professional: {
		bg: "#f9fafb",
		card: "#ffffff",
		text: "#111827",
	},
	retro: {
		bg: "#2d1b0e",
		card: "#f5e6d3",
		text: "#3d2914",
	},
	terminal: {
		bg: "#0d1117",
		card: "#161b22",
		text: "#3fb950",
	},
	sketch: {
		bg: "#f3f4f6",
		card: "#ffffff",
		text: "#374151",
	},
};

const LEGACY_XHS_THEME: Record<string, string> = {
	playful: "playful-geometric",
};

export function normalizeXhsTheme(theme: string): string {
	const t = (LEGACY_XHS_THEME[theme] ?? theme).trim();
	if (XHS_THEMES[t]) return t;
	return "default";
}
