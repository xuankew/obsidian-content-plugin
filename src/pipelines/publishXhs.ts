import { spawn } from "node:child_process";
import * as path from "node:path";
import type { TFile } from "obsidian";
import { FileSystemAdapter, Notice } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import {
	getPublishXhsAbsPathWithFallback,
	removeSandboxXhsMarkdownTmp,
} from "../noteArtifacts";
import {
	getBundledPublishXhsRedbookPyPath,
	getBundledXhsPipTargetPath,
} from "../rulesLoader";
import { runRenderXhsPipeline } from "./renderXhs";
import { createPipelineProgressOverlay } from "../ui/pipelineProgress";
import { pushXhsCardImagesToWechatNewspicDraft } from "./wechatXhsNewspicDraft";
import { ensureXhsVenvInstalled, getXhsEnvStatus } from "../xhsEnv";

const LOG_PFX = "[md-to-platform]";

function quoteShArg(s: string): string {
	if (!s) return s;
	if (/[\s"\\]/.test(s)) {
		return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return s;
}

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

		const custom = plugin.settings.xhsHelperCommand.trim();
		let cmd = custom;
		if (!cmd && plugin.settings.xhsUseBundledRedbookPublish) {
			const scriptPath = getBundledPublishXhsRedbookPyPath(plugin);
			if (!scriptPath) {
				throw new Error("未找到内置 publish_xhs_redbook.py：请重装/更新插件");
			}
			const status = await getXhsEnvStatus(plugin, plugin.settings.xhsPythonPath);
			if (!status.hasVenv || !status.canImportXhs) {
				if (!plugin.settings.xhsAutoInstallDeps) {
					throw new Error(
						"小红书发布依赖未就绪：请到设置页点击「一键安装/修复发布依赖」，或开启「发布前自动安装依赖」",
					);
				}
				progress.setPhase("正在安装小红书发布依赖（首次/修复）…", 0.9, true);
				const installed = await ensureXhsVenvInstalled(
					plugin,
					plugin.settings.xhsPythonPath,
					{
						onLog: (s) => console.info(`${LOG_PFX} xhs env`, s),
					},
				);
				if (!installed.canImportXhs) {
					throw new Error("已创建 venv 但仍无法 import xhs：请打开 Console 查看安装日志");
				}
				cmd = `${quoteShArg(installed.venvPython)} ${quoteShArg(scriptPath)}`;
			} else {
				cmd = `${quoteShArg(status.venvPython)} ${quoteShArg(scriptPath)}`;
			}
		}

		if (!cmd) {
			if (wechatNewspicMsg) {
				progress.setPhase(
					wechatNewspicMsg.startsWith("公众号图片草稿失败")
						? wechatNewspicMsg
						: "已完成（无外部发布命令）",
					1,
					false,
				);
			} else {
				progress.setPhase("已完成（未配置发布命令，仅生成图片）", 1, false);
			}
			await new Promise((r) => setTimeout(r, 350));
			new Notice(wechatNewspicMsg ?? "未配置发布命令，已生成图片");
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

		const xhsPipTgt = getBundledXhsPipTargetPath(plugin);
		if (xhsPipTgt) {
			const d = path.delimiter;
			env.PYTHONPATH = xhsPipTgt + (env.PYTHONPATH ? d + env.PYTHONPATH : "");
			if (plugin.settings.debugLog) {
				console.info(`${LOG_PFX} PYTHONPATH 含内置 pip 包:`, xhsPipTgt);
			}
		}

		const scriptLog: string[] = [];
		await new Promise<void>((resolve, reject) => {
			const child = spawn(cmd, {
				shell: true,
				env,
				detached: false,
			});
			const append = (chunk: unknown) => {
				const s = String(chunk);
				scriptLog.push(s);
			};
			child.stdout?.on("data", append);
			child.stderr?.on("data", append);
			child.on("error", (e) => {
				reject(
					new Error(
						e instanceof Error
							? `无法启动发布脚本：${e.message}（本机是否已安装 Python3？Windows 可尝试在「发布命令」中写 py -3 ...）`
							: String(e),
					),
				);
			});
			child.on("close", (code) => {
				const combined = scriptLog.join("").trim();
				if (code === 0) {
					if (combined) console.info(`${LOG_PFX} 小红书发布脚本输出:\n`, combined);
					resolve();
					return;
				}
				console.error(`${LOG_PFX} 小红书发布脚本失败 (exit`, code, ")\n", combined);
				const full =
					combined || `无控制台输出（退出码 ${code}）。常见：未填 Cookie、未 pip install xhs、无 publish_xhs.md、或 python3 不在 PATH。`;
				const max = 1500;
				const forUser =
					full.length > max ? `${full.slice(0, max)}…[完整见 Console：${LOG_PFX}]` : full;
				reject(new Error(forUser));
			});
		});

		/** 仅在实际发笔记成功（非 dry-run）后清理 Sandbox 中 xhs md tmp；渲染/仅导出 PNG 不清理 */
		if (!plugin.settings.xhsHelperDryRun) {
			await removeSandboxXhsMarkdownTmp(plugin, file);
		}

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
