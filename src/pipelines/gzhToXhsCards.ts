import type { TFile } from "obsidian";
import { Notice } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import { chatCompletion } from "../llm";
import { loadRuleFiles } from "../rulesLoader";
import {
	ARTIFACT_PUBLISH_XHS,
	ARTIFACT_XHS_CONTENT,
	readPublishGzhOrNoteBody,
	writeWorkflowXhsPair,
} from "../noteArtifacts";
import { splitPublishXhs } from "../splitPublishXhs";
import {
	getEffectiveWorkflowPathParts,
	getSessionKey,
	isWritingWorkflowLayout,
} from "../workflowPaths";
import { createPipelineProgressOverlay } from "../ui/pipelineProgress";

/**
 * 公众号长文 → 小红书卡片文案 + 导出 PNG（效果对齐「扩写」中的第二步 + 渲染，可独立运行）。
 * 正文来源：同目录 publish_gzh.md（或缓存）优先，否则使用当前打开的笔记全文。
 */
export async function runGzhArticleToXhsCardsPipeline(
	plugin: MdToPlatformPlugin,
	file: TFile,
): Promise<void> {
	const progress = createPipelineProgressOverlay("MDTP 公众号→小红书图文");
	try {
		progress.setPhase("正在加载规则并读取正文…", 0.08, false);
		const rules = loadRuleFiles(plugin, plugin.settings);
		const articleBody = (await readPublishGzhOrNoteBody(plugin, file)).trim();
		if (articleBody.length < 80) {
			throw new Error(
				"正文过短：请先执行「扩写」或放置 publish_gzh.md（工作流下在 Published/gzh），或在当前笔记写入完整公众号文章",
			);
		}

		progress.setPhase("正在请求 AI 生成小红书文案（可能较久）…", 0.22, true);
		const messagesB = [
			{ role: "system" as const, content: rules.gzhToXhs },
			{
				role: "user" as const,
				content: `下面是公众号文章全文。请按规则输出两部分，用下面标记分割（必须包含标记行）：\n\n<<<PUBLISH_XHS>>>\n（此处写 publish_xhs.md 内容：含标题候选与发布正文）\n<<<XHS_CONTENT>>>\n（此处写 xhs_content.md：仅卡片正文，卡片间用单独一行 --- 分割）\n\n【xhs_content 硬性提醒】每张第一行必须是 ##；第 1 张须多段、≥85 字；每张 Markdown 加粗 1–3 处（忌列表步步加粗）；标题「四步」须 4 条齐全；拆「前两步/后两步」须各有导语；避免「盖棺」等词；加粗勿跨行；勿用单独一行 1️⃣/2️⃣ 代替 ##。\n\n---文章开始---\n\n${articleBody}\n\n---文章结束---`,
			},
		];
		const rawB = (await chatCompletion(plugin.settings, messagesB)).trim();
		const { publishXhs, xhsContent } = splitPublishXhs(rawB);

		progress.setPhase("正在写入 publish_xhs / xhs_content…", 0.52, false);
		await writeWorkflowXhsPair(plugin, file, publishXhs, xhsContent);

		progress.setPhase("正在渲染小红书卡片 PNG…", 0.58, true);
		const { runRenderXhsPipeline } = await import("./renderXhs");
		const outDir = await runRenderXhsPipeline(plugin, file, {
			suppressNotice: true,
			progress,
		});

		progress.setPhase("已完成", 1, false);
		await new Promise((r) => setTimeout(r, 400));

		if (isWritingWorkflowLayout(plugin.settings)) {
			const k = getSessionKey(file);
			const w = getEffectiveWorkflowPathParts(plugin.settings);
			new Notice(
				`公众号→小红书（会话 ${k}）：终稿在 ${w.workflowVaultRoot}/${w.folderPublished}/xhs/… ；已生成卡片：${outDir}`,
				12000,
			);
		} else {
			new Notice(
				`公众号→小红书：已写入同目录 ${ARTIFACT_PUBLISH_XHS}、${ARTIFACT_XHS_CONTENT}。卡片图目录：${outDir}`,
				12000,
			);
		}
	} finally {
		progress.close();
	}
}
