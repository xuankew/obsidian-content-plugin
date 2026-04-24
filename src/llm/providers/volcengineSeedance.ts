import { requestUrl } from "obsidian";
import type { MdToPlatformSettings } from "../../settings";

const TASK_PATH = "/api/v3/contents/generations/tasks";

function resolveArkBase(settings: MdToPlatformSettings): string {
	const raw =
		(settings.volcengineArkBaseUrl || "").trim() ||
		"https://ark.cn-beijing.volces.com";
	return raw.replace(/\/$/, "");
}

function netHint(endpoint: string, err: unknown): Error {
	const msg = err instanceof Error ? err.message : String(err);
	return new Error(
		`火山方舟 Seedance API 异常（${endpoint}）。请检查网络与 Key。原始信息：${msg}`,
	);
}

/** 与官方示例一致：文本 + 参考图（data URL） */
export type SeedanceContentItem =
	| { type: "text"; text: string }
	| {
			type: "video_url";
			video_url: { url: string };
	  };

export type SeedanceTaskRequest = {
	model?: string;
	content: SeedanceContentItem[];
	[key: string]: unknown;
};

/**
 * 创建 Seedance 等内容生成任务：`POST /api/v3/contents/generations/tasks`
 * @returns 接口 JSON（通常含 task id，供后续轮询）
 */
export async function submitSeedanceGenerationTask(
	settings: MdToPlatformSettings,
	body: SeedanceTaskRequest,
): Promise<unknown> {
	const key = settings.volcengineArkApiKey.trim();
	if (!key) {
		throw new Error("请先在设置中填写火山方舟 API Key");
	}

	const model =
		(body.model ?? settings.seedanceModel ?? "doubao-seedance-1-5-pro-251215")
			.trim() || "doubao-seedance-1-5-pro-251215";
	const payload = { ...body, model };

	const url = `${resolveArkBase(settings)}${TASK_PATH}`;

	let res;
	try {
		res = await requestUrl({
			url,
			method: "POST",
			contentType: "application/json",
			headers: { Authorization: `Bearer ${key}` },
			body: JSON.stringify(payload),
		});
	} catch (e) {
		throw netHint("contents/generations/tasks", e);
	}

	const data = res.json as {
		error?: { message?: string; code?: string };
		message?: string;
	};

	if (res.status >= 400) {
		throw new Error(
			data.error?.message ||
				data.message ||
				`Seedance 任务 HTTP ${res.status}`,
		);
	}

	return res.json;
}

/** 构建「文本 + 参考图」的 content 数组（图生视频常见形态） */
export function buildSeedanceContentTextAndReferenceImage(
	prompt: string,
	imageDataUrl: string,
): SeedanceContentItem[] {
	return [
		{ type: "text", text: prompt.trim() },
		{ type: "video_url", video_url: { url: imageDataUrl } },
	];
}
