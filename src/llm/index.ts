import type { MdToPlatformSettings } from "../settings";
import { chatDeepseek } from "./providers/deepseek";
import {
	chatZhipu,
	generateImageZhipu,
	type ZhipuImageAugmentKind,
} from "./providers/zhipu";
import { generateImageVolcengineArk } from "./providers/volcengineArk";
import { chatOpenAICompatible } from "./providers/openaiCompatible";

export async function chatCompletion(
	settings: MdToPlatformSettings,
	messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<string> {
	const key = settings.apiKey.trim();
	if (!key) throw new Error("请先在设置中填写 API Key");

	switch (settings.llmProvider) {
		case "deepseek":
			return chatDeepseek(settings, messages);
		case "zhipu":
			return chatZhipu(settings, messages);
		case "openai-compatible":
			return chatOpenAICompatible(settings, messages);
		default:
			return chatDeepseek(settings, messages);
	}
}

export async function generateImage(
	settings: MdToPlatformSettings,
	prompt: string,
	kind: ZhipuImageAugmentKind = "generic",
): Promise<Buffer> {
	if (settings.imageProvider === "volcengineArk") {
		return generateImageVolcengineArk(settings, prompt, kind);
	}
	const imgKey = (settings.imageApiKey || settings.apiKey).trim();
	if (!imgKey) {
		throw new Error("插图需要智谱 Key：填写「插图专用 Key」或将 LLM 设为智谱");
	}
	return generateImageZhipu(settings, prompt, { apiKey: imgKey, kind });
}
