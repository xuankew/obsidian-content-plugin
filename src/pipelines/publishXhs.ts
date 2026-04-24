import { spawn } from "node:child_process";
import type { TFile } from "obsidian";
import { FileSystemAdapter, Notice } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import { getPublishXhsAbsPathWithFallback } from "../noteArtifacts";
import { runRenderXhsPipeline } from "./renderXhs";
import { createPipelineProgressOverlay } from "../ui/pipelineProgress";
import { pushXhsCardImagesToWechatNewspicDraft } from "./wechatXhsNewspicDraft";

export async function runPublishXhsPipeline(
	plugin: MdToPlatformPlugin,
	file: TFile,
): Promise<void> {
	const progress = createPipelineProgressOverlay("MDTP 小红书");
	try {
		// 导出卡片仅依赖 xhs_content.md；publish_xhs.md 仅在调用外部发布脚本时需要
		progress.setPhase("正在将 xhs_content 渲染为卡片 PNG（可能较久）…", 0.12, true);
		const imagesDir = await runRenderXhsPipeline(plugin, file, {
			suppressNotice: true,
			progress,
		});

		let wechatNewspicMsg: string | null = null;
		if (plugin.settings.xhsWechatNewspicDraft) {
			progress.setPhase("正在同步公众号「图片消息」草稿（贴图）…", 0.82, true);
			try {
				const { media_id } = await pushXhsCardImagesToWechatNewspicDraft(
					plugin,
					file,
					imagesDir,
				);
				wechatNewspicMsg = `公众号图片草稿已创建（newspic media_id=${media_id.slice(0, 8)}…）`;
			} catch (e) {
				const err = e instanceof Error ? e.message : String(e);
				wechatNewspicMsg = `公众号图片草稿失败：${err}`;
				console.error("[md-to-platform] xhs wechat newspic draft", e);
			}
		}

		const cmd = plugin.settings.xhsHelperCommand.trim();
		if (!cmd) {
			if (wechatNewspicMsg) {
				progress.setPhase(wechatNewspicMsg.startsWith("公众号图片草稿失败") ? wechatNewspicMsg : "已完成（无外部发布命令）", 1, false);
			} else {
				progress.setPhase("已完成（未配置发布命令，仅生成图片）", 1, false);
			}
			await new Promise((r) => setTimeout(r, 350));
			new Notice(wechatNewspicMsg ?? "未配置发布命令，已生成图片");
			return;
		}

		if (!plugin.settings.xhsPublishEnabled) {
			progress.setPhase("已完成（未开启外部发布，仅生成图片）", 1, false);
			await new Promise((r) => setTimeout(r, 350));
			if (wechatNewspicMsg) {
				new Notice(
					`${wechatNewspicMsg}（未执行发布命令：请开启「启用外部发布脚本」）`,
				);
			} else {
				new Notice("已生成图片；需在设置中开启「启用外部发布脚本」才会执行命令");
			}
			return;
		}

		progress.setPhase("正在定位 publish_xhs.md（供发布脚本）…", 0.88, false);
		const adapter = plugin.app.vault.adapter;
		const vaultRoot =
			adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";

		const publishPath = getPublishXhsAbsPathWithFallback(plugin, file);

		progress.setPhase("正在执行外部发布脚本…", 0.94, true);

		const env: NodeJS.ProcessEnv = {
			...process.env,
			MDT_PUBLISH_XHS: publishPath,
			MDT_XHS_IMAGES_DIR: imagesDir,
			MDT_VAULT_ROOT: vaultRoot,
			MDT_DRY_RUN: plugin.settings.xhsHelperDryRun ? "1" : "0",
		};
		if (plugin.settings.xhsCookie.trim()) {
			env.MDT_XHS_COOKIE = plugin.settings.xhsCookie.trim();
		}
		env.MDT_XHS_AS_PRIVATE = plugin.settings.xhsPublishAsPrivate ? "1" : "0";

		await new Promise<void>((resolve, reject) => {
			const child = spawn(cmd, {
				shell: true,
				env,
				detached: false,
			});
			let err = "";
			child.stderr?.on("data", (c) => {
				err += String(c);
			});
			child.on("close", (code) => {
				if (code === 0) resolve();
				else reject(new Error(err || `脚本退出码 ${code}`));
			});
		});

		progress.setPhase("全部完成", 1, false);
		await new Promise((r) => setTimeout(r, 380));

		const baseMsg = plugin.settings.xhsHelperDryRun
			? "发布脚本已执行（dry-run）"
			: "发布脚本已执行";
		new Notice(wechatNewspicMsg ? `${baseMsg}；${wechatNewspicMsg}` : baseMsg);
	} finally {
		progress.close();
	}
}
