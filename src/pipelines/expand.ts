import type { TFile } from "obsidian";
import { Notice } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import { chatCompletion } from "../llm";
import { loadGzhToVideoRule, loadRuleFiles, resolveRulesDir } from "../rulesLoader";
import {
	ARTIFACT_PUBLISH_GZH,
	ARTIFACT_PUBLISH_XHS,
	ARTIFACT_VIDEO_CONFIG,
	ARTIFACT_VIDEO_SCRIPT,
	ARTIFACT_XHS_CONTENT,
	writeExpandOutputs,
	writeVideoExpandOutputs,
} from "../noteArtifacts";
import { splitPublishXhs } from "../splitPublishXhs";
import { splitVideoScriptOutput } from "../splitVideoScript";
import {
	getEffectiveWorkflowPathParts,
	getSessionKey,
	isWritingWorkflowLayout,
} from "../workflowPaths";
import { createPipelineProgressOverlay } from "../ui/pipelineProgress";

export async function runExpandPipeline(
	plugin: MdToPlatformPlugin,
	file: TFile,
): Promise<void> {
	const progress = createPipelineProgressOverlay("MDTP 扩写进行中");
	try {
		progress.setPhase("正在加载规则并读取笔记…", 0.06, false);
		const rules = loadRuleFiles(plugin, plugin.settings);
		if (plugin.settings.debugLog) {
			console.log(
				"[md-to-platform] expand: 已加载 公众号扩写规则 + wechat-markdown-rules.zh.md、gzh_to_xhs；规则目录",
				resolveRulesDir(plugin, plugin.settings),
			);
		}
		const body = await plugin.app.vault.read(file);
		const targetChars = plugin.settings.expandGzhTargetChars;
		const expandUserBody = `请根据以下文章框架或草稿，输出完整公众号 Markdown 正文（可直接发布）。只输出正文，不要解释。

【篇幅】正文以汉语为主时，**纯汉字规模宜约 ${targetChars} 个**（约 ±15% 可接受）；明显过长须删减、过短须略充实。须与上方 system 中的《公众号扩写规则》字数要求同时满足（二者不一致时以更严格者为准）。

---

${body}`;

		progress.setPhase(
			"第 1 步：正在请求 AI 扩写公众号正文（可能需要数十秒）…",
			0.14,
			true,
		);
		const messagesA = [
			{ role: "system" as const, content: rules.gzhExpand },
			{
				role: "user" as const,
				content: expandUserBody,
			},
		];
		const publishGzh = (await chatCompletion(plugin.settings, messagesA)).trim();

		progress.setPhase(
			"第 2 步：正在请求 AI 生成小红书相关文稿（可能需要数十秒）…",
			0.58,
			true,
		);
		const messagesB = [
			{ role: "system" as const, content: rules.gzhToXhs },
			{
				role: "user" as const,
				content: `下面是公众号文章全文。请按规则输出两部分，用下面标记分割（必须包含标记行）：\n\n<<<PUBLISH_XHS>>>\n（此处写 publish_xhs.md 内容：含标题候选与发布正文）\n<<<XHS_CONTENT>>>\n（此处写 xhs_content.md：仅卡片正文，卡片间用单独一行 --- 分割）\n\n【xhs_content 硬性提醒】每张第一行必须是 ##；第 1 张须多段、≥85 字，写清场景+读者收获；每张 Markdown 加粗合计 1–3 处（忌列表步步加粗、忌半屏黄条）；连续步骤条数与标题一致；若拆「前两步/后两步」须各有导语；避免「盖棺」等词；加粗勿跨行；勿用单独一行 1️⃣/2️⃣ 代替 ##。\n\n---文章开始---\n\n${publishGzh}\n\n---文章结束---`,
			},
		];
		const rawB = (await chatCompletion(plugin.settings, messagesB)).trim();
		const { publishXhs, xhsContent } = splitPublishXhs(rawB);

		progress.setPhase("正在写入 Markdown 文件…", 0.82, false);
		await writeExpandOutputs(plugin, file, publishGzh, publishXhs, xhsContent);

		if (plugin.settings.videoScriptEnabled) {
			progress.setPhase(
				"第 3 步：正在生成短视频脚本与平台配置（video_script / video_config）…",
				0.9,
				true,
			);
			const gzhToVideo = loadGzhToVideoRule(plugin, plugin.settings);
			const sec = plugin.settings.videoTargetSeconds;
			const acc = plugin.settings.videoAccountInfo.trim() || "账号";
			const messagesC = [
				{ role: "system" as const, content: gzhToVideo },
				{
					role: "user" as const,
					content: `下面是公众号成稿。请**严格**按 system 中「MDTP 机器可读输出」追加 <<<VIDEO_SCRIPT>>> 与 <<<VIDEO_CONFIG>>>；口播以约 **${sec} 秒** 为目标；若 JSON 中 accountInfo 留空，请填「${acc}」。

【额外】JSON 的 voiceover 字段为**主口播稿**（用于 TTS），不要重复粘贴三处 opening/ending 全文。

---文章开始---

${publishGzh}

---文章结束---`,
				},
			];
			const rawC = (await chatCompletion(plugin.settings, messagesC)).trim();
			const { videoScriptMd, videoConfigJson: rawJ } = splitVideoScriptOutput(rawC);
			let videoConfigJson = rawJ;
			try {
				const o = JSON.parse(rawJ) as Record<string, unknown>;
				if (!o.accountInfo || String(o.accountInfo).trim() === "") {
					o.accountInfo = acc;
				}
				o._targetSeconds = sec;
				videoConfigJson = JSON.stringify(o, null, 2);
			} catch {
				videoConfigJson = rawJ;
			}
			await writeVideoExpandOutputs(plugin, file, videoScriptMd, videoConfigJson);
		}

		progress.setPhase("扩写已完成", 1, false);
		await new Promise((r) => setTimeout(r, 480));
	} finally {
		progress.close();
	}

	if (isWritingWorkflowLayout(plugin.settings)) {
		const k = getSessionKey(file);
		const w = getEffectiveWorkflowPathParts(plugin.settings);
		const v = plugin.settings.videoScriptEnabled
			? `；含 video_script / video_config（${w.workflowVaultRoot}/${w.folderPublished}/video/…）`
			: "";
		new Notice(
			`扩写完成（会话 ${k}）。终稿：${w.workflowVaultRoot}/${w.folderPublished}/gzh|xhs/… ；Sandbox tmp：${w.workflowVaultRoot}/${w.folderSandbox}/…${v}`,
			12000,
		);
	} else {
		const v = plugin.settings.videoScriptEnabled
			? `；含 ${ARTIFACT_VIDEO_SCRIPT}、${ARTIFACT_VIDEO_CONFIG}`
			: "";
		new Notice(
			`扩写完成。当前笔记未修改。已写入同目录：${ARTIFACT_PUBLISH_GZH}、${ARTIFACT_XHS_CONTENT}、${ARTIFACT_PUBLISH_XHS}${v}`,
			10000,
		);
	}
}
