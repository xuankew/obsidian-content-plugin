import { requestUrl } from "obsidian";
import type { MdToPlatformSettings } from "../../settings";

function netHint(err: unknown): Error {
	const msg = err instanceof Error ? err.message : String(err);
	return new Error(
		`OpenAI 兼容接口网络异常。请检查 Base URL、本机网络、代理/VPN、防火墙。原始信息：${msg}`,
	);
}

export async function chatOpenAICompatible(
	settings: MdToPlatformSettings,
	messages: { role: string; content: string }[],
): Promise<string> {
	const base = settings.baseUrl.trim();
	if (!base) throw new Error("OpenAI 兼容模式请填写 Base URL");

	const url = `${base.replace(/\/$/, "")}/chat/completions`;
	let res;
	try {
		res = await requestUrl({
			url,
			method: "POST",
			contentType: "application/json",
			headers: { Authorization: `Bearer ${settings.apiKey.trim()}` },
			body: JSON.stringify({
				model: settings.textModel || "gpt-4o-mini",
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
		throw new Error(data.error?.message || `OpenAI-compatible HTTP ${res.status}`);
	}
	const text = data.choices?.[0]?.message?.content;
	if (!text) throw new Error("模型返回空内容");
	return text;
}
