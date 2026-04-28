import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { FileSystemAdapter, Notice } from "obsidian";
import type { MdToPlatformPlugin } from "./pluginTypes";
import type { MdtpVideoConfig } from "./videoConfig";
import type { MdtpVideoPlatformId } from "./upload/videoPlatformUpload";
import {
	getBundledPublishDouyinPlaywrightPyPath,
	getBundledPublishWeChatChannelsPlaywrightPyPath,
	getBundledPublishXhsPlaywrightPyPath,
} from "./rulesLoader";
import {
	ensureXhsVenvInstalled,
	getXhsEnvStatus,
	tryGetXhsVenvPythonPath,
} from "./xhsEnv";
import type { PipelineProgressHandle } from "./ui/pipelineProgress";

const LOG = "[md-to-platform] playwrightMdtpVideo";

function playwrightDepsOk(st: Awaited<ReturnType<typeof getXhsEnvStatus>>): boolean {
	return st.hasVenv && st.canImportPlaywright;
}

/** 与 `mdtpVideo` 的 render 解释器选择一致 */
function resolvePythonForVideoScripts(plugin: MdToPlatformPlugin): string {
	const v = plugin.settings.videoPythonPath.trim();
	if (v) return v;
	const venvPy = tryGetXhsVenvPythonPath(plugin);
	if (venvPy) return venvPy;
	return plugin.settings.xhsPythonPath.trim();
}

async function resolvePlaywrightPython(
	plugin: MdToPlatformPlugin,
): Promise<string> {
	const hint = resolvePythonForVideoScripts(plugin);
	let st = await getXhsEnvStatus(plugin, hint);
	if (playwrightDepsOk(st) && st.venvPython) return st.venvPython;
	if (!plugin.settings.xhsAutoInstallDeps) {
		throw new Error(
			"Playwright 未就绪：请在设置「0」中点击「一键安装/修复发布依赖」或开启「发布前自动安装依赖」。",
		);
	}
	const inst = await ensureXhsVenvInstalled(plugin, hint, {
		onLog: (s) => console.info(LOG, s),
	});
	if (!playwrightDepsOk(inst) || !inst.venvPython) {
		throw new Error("安装后仍无法 import playwright，请查看 Console。");
	}
	return inst.venvPython;
}

function copyTextForPlatform(
	cfg: MdtpVideoConfig,
	k: keyof MdtpVideoConfig["platforms"],
): { title: string; desc: string } {
	const p = cfg.platforms[k];
	const title = (p.publish_title?.trim() || p.cover_title || "").trim();
	const desc = (p.publish_description?.trim() || "").trim();
	return { title, desc };
}

function topicTagsCsv(cfg: MdtpVideoConfig): string {
	const t = (cfg.topic || "").trim();
	if (!t) return "";
	return t
		.split(/[,，;；]/)
		.map((s) => s.trim().replace(/^#/, ""))
		.filter(Boolean)
		.join(",");
}

function spawnPy(
	py: string,
	scriptPath: string,
	env: NodeJS.ProcessEnv,
): Promise<{ code: number; out: string }> {
	return new Promise((resolve, reject) => {
		const chunks: string[] = [];
		const child = spawn(py, [scriptPath], { env, shell: false });
		const ap = (c: unknown) => chunks.push(String(c));
		child.stdout?.on("data", ap);
		child.stderr?.on("data", ap);
		child.on("error", reject);
		child.on("close", (code) =>
			resolve({ code: code ?? 1, out: chunks.join("") }),
		);
	});
}

/**
 * 在「生成短视频」成功后，按设置依次执行各平台 Playwright 脚本（需各平台 mp4 存在）。
 */
export async function runMdtpVideoPlaywrightPublishes(
	plugin: MdToPlatformPlugin,
	outDir: string,
	videoCfg: MdtpVideoConfig,
	platforms: MdtpVideoPlatformId[],
	progress: PipelineProgressHandle,
): Promise<void> {
	if (platforms.length === 0) return;
	const py = await resolvePlaywrightPython(plugin);
	const adapter = plugin.app.vault.adapter;
	const vaultRoot =
		adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
	const vprof = plugin.settings.videoPlaywrightProfileName
		.replace(/[/\\]/g, "")
		.trim() || "default";
	const pIdx = 0.92;
	const step = 0.04 / Math.max(1, platforms.length);

	for (let i = 0; i < platforms.length; i++) {
		const plat = platforms[i]!;
		progress.setPhase(
			`正在 Playwright 发布：${plat}…`,
			pIdx + step * (i + 1),
			true,
		);
		const baseEnv: NodeJS.ProcessEnv = { ...process.env };
		if (vaultRoot) baseEnv.MDT_VAULT_ROOT = vaultRoot;
		if (plugin.settings.debugLog) baseEnv.MDT_DEBUG = "1";
		baseEnv.MDT_DRY_RUN = "0";
		/** 与小红书 Playwright 行为对齐 */
		baseEnv.MDT_XHS_PLAYWRIGHT_HEADED = plugin.settings.xhsPlaywrightHeaded
			? "1"
			: "0";
		baseEnv.MDT_XHS_PLAYWRIGHT_MANUAL_CLICK = plugin.settings
			.xhsPlaywrightManualFinalClick
			? "1"
			: "0";
		baseEnv.MDT_XHS_PLAYWRIGHT_KEEP_OPEN = plugin.settings.xhsPlaywrightKeepOpenOnError
			? "1"
			: "0";
		baseEnv.MDT_VIDEO_PLAYWRIGHT_PROFILE = vprof;
		/** 通用名（与 Python 里一致） */
		baseEnv.MDT_PLAYWRIGHT_HEADED = baseEnv.MDT_XHS_PLAYWRIGHT_HEADED;

		if (plat === "douyin") {
			const p = getBundledPublishDouyinPlaywrightPyPath(plugin);
			if (!p) {
				new Notice("未找到 publish_douyin_playwright.py", 5000);
				continue;
			}
			const mp4 = path.join(outDir, "douyin.mp4");
			if (!fs.existsSync(mp4)) {
				new Notice("缺少 douyin.mp4，跳过抖音发布", 5000);
				continue;
			}
			const { title, desc: douyinDesc } = copyTextForPlatform(
				videoCfg,
				"douyin",
			);
			/** 抖音作品简介 + # 话题：与小红书正文一致，见 `publish_douyin_playwright` 说明 */
			const { desc: xhsBody } = copyTextForPlatform(videoCfg, "xiaohongshu");
			if (!title) {
				new Notice("video_config 中抖音无可用标题，跳过抖音", 8000);
				continue;
			}
			const tagCsv = topicTagsCsv(videoCfg);
			const parts = (tagCsv || "")
				.split(/[,，;；]/)
				.map((s) => s.trim().replace(/^#/, ""))
				.filter(Boolean);
			let body = (xhsBody || douyinDesc || title).trim();
			if (parts.length > 0 && !/#\S/.test(body)) {
				const tail = parts.map((t) => `#${t}`).join(" ");
				body = body ? `${body}\n${tail}` : tail;
			}
			const env: NodeJS.ProcessEnv = { ...baseEnv };
			env.MDT_DOUYIN_VIDEO = mp4;
			env.MDT_DOUYIN_TITLE = title;
			env.MDT_DOUYIN_BODY = body;
			const tags = tagCsv;
			if (tags) env.MDT_DOUYIN_TAGS = tags;
			const r = await spawnPy(py, p, env);
			if (r.code !== 0) {
				console.error(LOG, "douyin", r.out);
				new Notice(
					`抖音 Playwright 退出码 ${r.code}。详见 Console / mdtp 截图。`,
					10000,
				);
			} else {
				new Notice("抖音：已执行发布流程（请在抖音内确认）", 6000);
			}
		} else if (plat === "shipinhao") {
			const p = getBundledPublishWeChatChannelsPlaywrightPyPath(plugin);
			if (!p) {
				new Notice("未找到 publish_wechat_channels_playwright.py", 5000);
				continue;
			}
			const mp4 = path.join(outDir, "shipinhao.mp4");
			if (!fs.existsSync(mp4)) {
				new Notice("缺少 shipinhao.mp4，跳过视频号", 5000);
				continue;
			}
			const { title, desc } = copyTextForPlatform(videoCfg, "shipinhao");
			const t0 = title || (videoCfg.platforms.shipinhao?.cover_title ?? "");
			if (!t0) {
				new Notice("video_config 中视频号无可用标题，跳过", 8000);
				continue;
			}
			const env: NodeJS.ProcessEnv = { ...baseEnv };
			env.MDT_CHANNELS_VIDEO = mp4;
			env.MDT_CHANNELS_TITLE = t0;
			env.MDT_CHANNELS_BODY = desc || t0;
			const tags = topicTagsCsv(videoCfg);
			if (tags) env.MDT_CHANNELS_TAGS = tags;
			const r = await spawnPy(py, p, env);
			if (r.code !== 0) {
				console.error(LOG, "channels", r.out);
				new Notice(`视频号 Playwright 退出码 ${r.code}。见 Console。`, 10000);
			} else {
				new Notice("视频号：已执行发表流程", 6000);
			}
		} else if (plat === "xiaohongshu") {
			const p = getBundledPublishXhsPlaywrightPyPath(plugin);
			if (!p) {
				new Notice("未找到 publish_xhs_playwright.py", 5000);
				continue;
			}
			const mp4 = path.join(outDir, "xiaohongshu.mp4");
			if (!fs.existsSync(mp4)) {
				new Notice("缺少 xiaohongshu.mp4，跳过小红书", 5000);
				continue;
			}
			const { title, desc } = copyTextForPlatform(videoCfg, "xiaohongshu");
			const t0 = title || (videoCfg.platforms.xiaohongshu?.cover_title ?? "");
			if (!t0) {
				new Notice("video_config 中小红书无标题，跳过", 8000);
				continue;
			}
			const xprof =
				plugin.settings.xhsPlaywrightProfileName.replace(/[/\\]/g, "").trim() ||
				"default";
			const env: NodeJS.ProcessEnv = { ...baseEnv };
			env.MDT_XHS_VIDEO_PATH = mp4;
			env.MDT_XHS_VIDEO_TITLE = t0;
			env.MDT_XHS_VIDEO_DESC = desc || t0;
			const tags = topicTagsCsv(videoCfg);
			if (tags) env.MDT_XHS_VIDEO_TAGS = tags;
			env.MDT_XHS_PLAYWRIGHT_PROFILE = xprof;
			env.MDT_XHS_AS_PRIVATE = plugin.settings.xhsPublishAsPrivate ? "1" : "0";
			const r = await spawnPy(py, p, env);
			if (r.code !== 0) {
				console.error(LOG, "xhs video", r.out);
				new Notice(
					`小红书视频 Playwright 退出码 ${r.code}。见 Console / 截图。`,
					10000,
				);
			} else {
				new Notice("小红书：已执行发布流程", 6000);
			}
		}
		/** 公众号 wechat_mp 仍为占位，不在此列表中调用 */
	}
}
