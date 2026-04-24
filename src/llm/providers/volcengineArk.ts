import { requestUrl } from "obsidian";
import type { MdToPlatformSettings } from "../../settings";
import {
	augmentGenericImagePrompt,
	augmentWechatArticleImagePrompt,
	type ZhipuImageAugmentKind,
} from "./zhipu";

const DEFAULT_ARK_BASE = "https://ark.cn-beijing.volces.com";

function resolveArkBase(settings: MdToPlatformSettings): string {
	const raw =
		(settings.volcengineArkBaseUrl || "").trim() || DEFAULT_ARK_BASE;
	return raw.replace(/\/$/, "");
}

function netHint(endpoint: string, err: unknown): Error {
	const msg = err instanceof Error ? err.message : String(err);
	return new Error(
		`火山方舟 API 网络异常（${endpoint}）。请检查网络、代理与 API Key。原始信息：${msg}`,
	);
}

/**
 * 火山引擎方舟图片生成（如 doubao-seedream），与 OpenAPI 示例一致：
 * POST /api/v3/images/generations
 */
export async function generateImageVolcengineArk(
	settings: MdToPlatformSettings,
	prompt: string,
	kind: ZhipuImageAugmentKind,
): Promise<Buffer> {
	const key = settings.volcengineArkApiKey.trim();
	if (!key) {
		throw new Error("请填写火山方舟 API Key");
	}

	const finalPrompt =
		kind === "wechatArticle"
			? augmentWechatArticleImagePrompt(prompt)
			: augmentGenericImagePrompt(prompt);

	const base = resolveArkBase(settings);
	const endpoint = `${base}/api/v3/images/generations`;

	const body: Record<string, unknown> = {
		model:
			settings.volcengineImageModel.trim() ||
			"doubao-seedream-5-0-260128",
		prompt: finalPrompt,
		sequential_image_generation: "disabled",
		response_format: "url",
		size: (settings.volcengineImageSize || "2K").trim() || "2K",
		stream: false,
		watermark: settings.volcengineImageWatermark,
	};

	let res;
	try {
		res = await requestUrl({
			url: endpoint,
			method: "POST",
			contentType: "application/json",
			headers: {
				Authorization: `Bearer ${key}`,
			},
			body: JSON.stringify(body),
		});
	} catch (e) {
		throw netHint("images/generations", e);
	}

	const data = res.json as {
		error?: { message?: string; code?: string };
		data?: Array<{ url?: string; b64_json?: string }>;
	};

	if (res.status >= 400) {
		throw new Error(
			data.error?.message || `火山方舟生图 HTTP ${res.status}`,
		);
	}

	const first = data.data?.[0];
	const b64 = first?.b64_json;
	if (b64) {
		return Buffer.from(b64, "base64");
	}
	const imageUrl = first?.url;
	if (!imageUrl) {
		throw new Error(data.error?.message || "火山方舟未返回图片 URL 或 base64");
	}

	let imgRes;
	try {
		imgRes = await requestUrl({ url: imageUrl });
	} catch (e) {
		throw netHint("下载生图结果", e);
	}
	return Buffer.from(imgRes.arrayBuffer);
}
