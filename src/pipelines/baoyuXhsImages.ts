import * as path from "node:path";
import * as fs from "node:fs";
import type { TFile } from "obsidian";
import { Notice } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import { chatCompletion, generateImage } from "../llm";
import {
	readPublishGzhOrNoteBody,
	resolveBaoyuCogviewImagesFsDir,
} from "../noteArtifacts";
import { loadBaoyuXhsImagesRule } from "../baoyuRuleLoader";
import { createPipelineProgressOverlay } from "../ui/pipelineProgress";

const CARD_BLOCK_RE = /<<<CARD>>>([\s\S]*?)<<<END>>>/g;
const MAX_CARDS = 9;
const BETWEEN_IMAGES_MS = 450;

function parseBaoyuCardPrompts(raw: string): string[] {
	const out: string[] = [];
	let m: RegExpExecArray | null;
	const re = new RegExp(CARD_BLOCK_RE.source, "g");
	while ((m = re.exec(raw))) {
		const t = m[1].trim();
		if (t.length > 0) out.push(t);
	}
	return out.slice(0, MAX_CARDS);
}

/**
 * 「Baoyu 风」小红书配图：公众号长文 → LLM 生成每页 CogView 提示词 → 智谱 cogview-3-flash 逐张出图。
 */
export async function runBaoyuXhsImagesPipeline(
	plugin: MdToPlatformPlugin,
	file: TFile,
): Promise<void> {
	const progress = createPipelineProgressOverlay("MDTP Baoyu 风配图");
	let generated = 0;
	let outDir = "";
	try {
		progress.setPhase("正在读取公众号长文…", 0.08, false);
		const articleBody = (await readPublishGzhOrNoteBody(plugin, file)).trim();
		if (articleBody.length < 120) {
			throw new Error(
				"正文过短：请先「扩写」或准备 publish_gzh.md（工作流在 Published/gzh），或在当前笔记写入完整长文",
			);
		}

		const system = loadBaoyuXhsImagesRule(plugin, plugin.settings);
		const user = `以下为公众号长文，请严格按规则输出 <<<CARD>>>…<<<END>>> 块，供 CogView 逐张生图。\n\n---\n\n${articleBody}`;

		progress.setPhase("正在请求 AI 生成各页生图提示词（可能较久）…", 0.2, true);
		const raw = (await chatCompletion(plugin.settings, [
			{ role: "system", content: system },
			{ role: "user", content: user },
		])).trim();

		const prompts = parseBaoyuCardPrompts(raw);
		if (prompts.length === 0) {
			throw new Error(
				"未解析到 <<<CARD>>>…<<<END>>> 块：请重试，或编辑 rules/baoyu_xhs_images.md 收紧格式说明",
			);
		}
		generated = prompts.length;

		outDir = resolveBaoyuCogviewImagesFsDir(plugin, file, plugin.settings);
		fs.mkdirSync(outDir, { recursive: true });

		for (let i = 0; i < prompts.length; i++) {
			progress.setPhase(
				`CogView 生成第 ${i + 1}/${prompts.length} 张图…`,
				0.35 + (0.62 * (i + 1)) / prompts.length,
				true,
			);
			const buf = await generateImage(plugin.settings, prompts[i]);
			const fname = `baoyu_${String(i + 1).padStart(2, "0")}.png`;
			fs.writeFileSync(path.join(outDir, fname), buf);
			if (i < prompts.length - 1 && BETWEEN_IMAGES_MS > 0) {
				await new Promise((r) => setTimeout(r, BETWEEN_IMAGES_MS));
			}
		}

		progress.setPhase("全部完成", 1, false);
		await new Promise((r) => setTimeout(r, 400));
	} finally {
		progress.close();
	}

	new Notice(`Baoyu 风配图：已用 CogView 生成 ${generated} 张，目录：${outDir}`, 14000);
}
