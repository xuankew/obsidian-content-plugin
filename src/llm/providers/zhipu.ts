import { requestUrl } from "obsidian";
import type { MdToPlatformSettings } from "../../settings";

const CHAT_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const IMG_URL = "https://open.bigmodel.cn/api/paas/v4/images/generations";

/** 公众号正文插图：强调「有人物、有场景」，避免过长否定句把模型带偏成静物/抽象图 */
export function augmentWechatArticleImagePrompt(prompt: string): string {
	let core = prompt.trim();
	if (!core) {
		core = "父母与孩子在客厅或书房互动，日常亲子场景";
	}
	const pre =
		"卡通扁平插画，画面中心为一组清晰可辨的人物（家长与孩子），中国家庭室内，至少两人同框，";
	const post =
		"，人物占画面主要面积，东亚长相，柔和配色；不要无人物的食物特写、静物拼盘、抽象色块";
	return (pre + core + post).slice(0, 2000);
}

/** Baoyu 等其它配图：只做轻量后缀，避免覆盖用户长提示 */
export function augmentGenericImagePrompt(prompt: string): string {
	let out = prompt.trim();
	if (!out) {
		return "竖版信息流插画，留白，柔和配色";
	}
	if (!/中国|东亚|国人|中文/i.test(out)) {
		out += "，东亚审美";
	}
	return out.slice(0, 2000);
}

export type ZhipuImageAugmentKind = "wechatArticle" | "generic";

/** Obsidian 的 requestUrl 不受浏览器 CORS 限制；桌面端对 fetch 跨域常报 Failed to fetch */
function netHint(endpoint: string, err: unknown): Error {
	const msg = err instanceof Error ? err.message : String(err);
	return new Error(
		`智谱 API 网络异常（${endpoint}）。请检查：本机网络、代理/VPN、公司防火墙；并确认 API Key 有效。原始信息：${msg}`,
	);
}

export async function chatZhipu(
	settings: MdToPlatformSettings,
	messages: { role: string; content: string }[],
): Promise<string> {
	const key = settings.apiKey.trim();
	if (!key) throw new Error("请先在设置中填写 API Key");

	let res;
	try {
		res = await requestUrl({
			url: CHAT_URL,
			method: "POST",
			contentType: "application/json",
			headers: { Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				model: settings.textModel || "glm-4-flash",
				messages,
				temperature: 0.7,
			}),
		});
	} catch (e) {
		throw netHint("Chat", e);
	}

	const data = res.json as {
		error?: { message?: string };
		choices?: { message?: { content?: string } }[];
	};
	if (res.status >= 400) {
		throw new Error(data.error?.message || `智谱 Chat HTTP ${res.status}`);
	}
	const text = data.choices?.[0]?.message?.content;
	if (!text) throw new Error("智谱返回空内容");
	return text;
}

export async function generateImageZhipu(
	settings: MdToPlatformSettings,
	prompt: string,
	options?: {
		apiKey?: string;
		kind?: ZhipuImageAugmentKind;
	},
): Promise<Buffer> {
	const key = (options?.apiKey ?? settings.imageApiKey ?? settings.apiKey).trim();
	if (!key) throw new Error("缺少智谱 API Key（插图）");

	const kind = options?.kind ?? "generic";
	const finalPrompt =
		kind === "wechatArticle"
			? augmentWechatArticleImagePrompt(prompt)
			: augmentGenericImagePrompt(prompt);

	const model = (settings.imageModel || "glm-image").trim();
	const body: Record<string, unknown> = {
		model,
		prompt: finalPrompt,
	};
	if (model === "glm-image") {
		body.size = (settings.zhipuImageSize || "1280x1280").trim() || "1280x1280";
		/** OpenAI 兼容字段：优先直接返回 base64，避免仅依赖临时 URL */
		body.response_format = "b64_json";
	}

	let res;
	try {
		res = await requestUrl({
			url: IMG_URL,
			method: "POST",
			contentType: "application/json",
			headers: { Authorization: `Bearer ${key}` },
			body: JSON.stringify(body),
		});
	} catch (e) {
		throw netHint("智谱生图", e);
	}

	const data = res.json as {
		error?: { code?: string; message?: string };
		data?: { url?: string; b64_json?: string }[];
	};
	if (res.status >= 400) {
		throw new Error(
			data.error?.message || `智谱生图 HTTP ${res.status}`,
		);
	}
	if (data.error?.message) {
		throw new Error(data.error.message);
	}
	const first = data.data?.[0];
	let b64 = first?.b64_json;
	if (b64) {
		return Buffer.from(b64, "base64");
	}
	let url = first?.url;
	if (url?.startsWith("data:image") && url.includes("base64,")) {
		const i = url.indexOf("base64,");
		b64 = url.slice(i + "base64,".length);
		return Buffer.from(b64, "base64");
	}
	if (!url) throw new Error("智谱生图未返回图片 URL 或 base64");

	let imgRes;
	try {
		imgRes = await requestUrl({ url });
	} catch (e) {
		throw netHint("下载智谱图片", e);
	}
	return Buffer.from(imgRes.arrayBuffer);
}
