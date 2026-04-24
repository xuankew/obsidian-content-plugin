import { requestUrl } from "obsidian";
import type { MdToPlatformSettings } from "../../settings";

const DEFAULT_BASE = "https://api.deepseek.com";

function netHint(err: unknown): Error {
	const msg = err instanceof Error ? err.message : String(err);
	return new Error(
		`DeepSeek API 网络异常。请检查本机网络、代理/VPN、防火墙。原始信息：${msg}`,
	);
}

export async function chatDeepseek(
	settings: MdToPlatformSettings,
	messages: { role: string; content: string }[],
): Promise<string> {
	const base = settings.baseUrl.trim() || DEFAULT_BASE;
	const url = `${base.replace(/\/$/, "")}/v1/chat/completions`;
	let res;
	try {
		res = await requestUrl({
			url,
			method: "POST",
			contentType: "application/json",
			headers: { Authorization: `Bearer ${settings.apiKey.trim()}` },
			body: JSON.stringify({
				model: settings.textModel || "deepseek-chat",
				messages,
				temperature: 0.7,
			}),
			throw: false,
		});
	} catch (e) {
		throw netHint(e);
	}
	const data = res.json as {
		error?: { message?: string };
		choices?: { message?: { content?: string } }[];
	};
	if (res.status >= 400) {
		throw new Error(data.error?.message || `DeepSeek HTTP ${res.status}`);
	}
	const text = data.choices?.[0]?.message?.content;
	if (!text) throw new Error("DeepSeek 返回空内容");
	return text;
}
