import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { TFile } from "obsidian";
import { FileSystemAdapter, Notice } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import {
	getVideoConfigAbsPathWithFallback,
	listVideoCardImageDirCandidates,
	resolveVideoArtifactsFsDir,
} from "../noteArtifacts";
import {
	getBundledRenderVideoPyPath,
	getPluginFolderPath,
	resolveXhsPythonExecutable,
} from "../rulesLoader";
import { runRenderXhsPipeline } from "./renderXhs";
import { createPipelineProgressOverlay } from "../ui/pipelineProgress";
import { parseVideoConfigJson } from "../videoConfig";
import { writeVideoPublishCopiesMd } from "../videoPublishCopies";
import { applyEngineToTtsConfigJson } from "../videoTtsUserConfig";
import { getEnabledMdtpVideoUploadPlatforms } from "../upload/videoPlatformUpload";
import { runMdtpVideoPlaywrightPublishes } from "../playwrightMdtpVideo";
import { tryGetXhsVenvPythonPath } from "../xhsEnv";

const LOG_PFX = "[md-to-platform] mdtpVideo";

/** 与 `render_video.py` 最终输出一致：三份成品各一份即视为已合成过 */
const MDTp_FINAL_PLATFORM_MP4 = ["douyin.mp4", "xiaohongshu.mp4", "shipinhao.mp4"] as const;

function areMdtpFinalVideosPresent(outDir: string): boolean {
	for (const name of MDTp_FINAL_PLATFORM_MP4) {
		const p = path.join(outDir, name);
		try {
			const st = fs.statSync(p);
			if (!st.isFile() || st.size < 1) return false;
		} catch {
			return false;
		}
	}
	return true;
}

/**
 * 优先「视频合成」专用路径 → **再优先库内 xhs_venv**（一键安装写入处）→ 小红书解释器
 * → 系统 python。若「小红书 Python」误填了 Homebrew 的 python3，而 Pillow 只装在 venv 里，仍需让 venv 先生效。
 */
function resolveRenderVideoPythonExecutable(plugin: MdToPlatformPlugin): string {
	const v = plugin.settings.videoPythonPath.trim();
	if (v) return v;
	const venvPy = tryGetXhsVenvPythonPath(plugin);
	if (venvPy) return venvPy;
	const x = plugin.settings.xhsPythonPath.trim();
	if (x) return x;
	return resolveXhsPythonExecutable("");
}

function defaultBundledBgmAbs(plugin: MdToPlatformPlugin): string {
	return path.join(getPluginFolderPath(plugin), "resource", "mp3", "65歌曲.mp3");
}

function resolveVideoBackgroundMusic(
	plugin: MdToPlatformPlugin,
): { path: string; enabled: boolean; volume: number } {
	const vol = Math.min(0.45, Math.max(0.04, Number(plugin.settings.videoBgmVolume) || 0.14));
	if (!plugin.settings.videoBgmEnabled) {
		return {
			path: defaultBundledBgmAbs(plugin),
			enabled: false,
			volume: vol,
		};
	}
	const root = getPluginFolderPath(plugin);
	const defaultAbs = defaultBundledBgmAbs(plugin);
	const raw = plugin.settings.videoBgmPath.trim();
	const fileAbs = raw
		? path.isAbsolute(raw)
			? path.normalize(raw)
			: path.join(root, raw)
		: defaultAbs;
	return { path: fileAbs, enabled: true, volume: vol };
}

export async function runMdtpVideoPipeline(
	plugin: MdToPlatformPlugin,
	file: TFile,
): Promise<void> {
	const progress = createPipelineProgressOverlay("MDTP 短视频");
	try {
		progress.setPhase("正在读取 video_config.json…", 0.06, false);
		const cfgPath = getVideoConfigAbsPathWithFallback(plugin, file);
		const rawCfg = fs.readFileSync(cfgPath, "utf8");
		const videoCfg = parseVideoConfigJson(rawCfg);

		const outDir = resolveVideoArtifactsFsDir(plugin, file, plugin.settings);
		fs.mkdirSync(outDir, { recursive: true });

		let skipRender = areMdtpFinalVideosPresent(outDir);
		if (skipRender) {
			progress.setPhase("已存在三平台成品 MP4，跳过卡片与 TTS/FFmpeg 合成…", 0.35, false);
			console.info(
				`${LOG_PFX} 复用: ${outDir}（${MDTp_FINAL_PLATFORM_MP4.join("、")} 已存在）`,
			);
		} else {
			/** 9:16 图文卡片与 mp4 同目录，供 FFmpeg 直接铺满，避免 3:4 图上下黑边 */
			progress.setPhase("正在生成 9:16（1080×1920）图文卡片到 video 目录…", 0.2, true);
			const imagesDir = await runRenderXhsPipeline(plugin, file, {
				suppressNotice: true,
				progress,
				forShortVideo9x16: { outDirAbs: outDir, includeCover: false },
			});
			const extraDirs = listVideoCardImageDirCandidates(
				plugin,
				file,
				imagesDir,
			);
			const cardImageDirs: string[] = [];
			const seen = new Set<string>();
			for (const p of [imagesDir, ...extraDirs]) {
				const n = path.normalize(p);
				if (seen.has(n)) continue;
				seen.add(n);
				cardImageDirs.push(n);
			}
			const logoPath = path.join(
				getPluginFolderPath(plugin),
				"resource",
				"img",
				"logo.png",
			);

			const scriptPath = getBundledRenderVideoPyPath(plugin);
			if (!scriptPath) {
				throw new Error("未找到内置 scripts/render_video.py，请更新插件");
			}
			const py = resolveRenderVideoPythonExecutable(plugin);

			const vaultRoot =
				plugin.app.vault.adapter instanceof FileSystemAdapter
					? plugin.app.vault.adapter.getBasePath()
					: "";

			const bgm = resolveVideoBackgroundMusic(plugin);
			if (bgm.enabled && !fs.existsSync(bgm.path)) {
				const hint =
					`未找到背景音乐：${bgm.path}。请放入 resource/mp3 或改正设置「背景音乐文件」；将仅导出口播不混 BGM。`;
				console.warn(`[md-to-platform] mdtpVideo: ${hint}`);
			}
			const job = {
				imagesDir,
				/** 知识卡片 `card_*.png` 目录候选，脚本内按序选用首个含卡片的目录 */
				cardImageDirs,
				/** 与导出小红书卡片一致：首/尾帧优先用此目录下 TTF（如 LXGWWenKaiGB-Regular.ttf） */
				fontDir: path.join(getPluginFolderPath(plugin), "fonts"),
				/** 品牌 logo；不存在时脚本不绘制图块 */
				logoPath: fs.existsSync(logoPath) ? logoPath : "",
				outputDir: outDir,
				videoConfig: videoCfg,
				openSec: 2.5,
				endSec: 3.5,
				backgroundMusic: {
					path: bgm.path,
					enabled: bgm.enabled,
					volume: bgm.volume,
				},
			};

			progress.setPhase("正在本机执行 TTS + FFmpeg 合成三平台视频…", 0.5, true);

			const env: NodeJS.ProcessEnv = { ...process.env };
			env.MDT_VIDEO_JOB_JSON = JSON.stringify(job);
			env.MDT_VIDEO_TTS_CONFIG_JSON = applyEngineToTtsConfigJson(
				plugin.settings.videoTtsEngine,
				plugin.settings.videoTtsConfigJson,
			);
			env.MDT_VIDEO_TTS_ENGINE = plugin.settings.videoTtsEngine;
			if (plugin.settings.videoFfmpegPath.trim()) {
				env.MDT_VIDEO_FFMPEG_PATH = plugin.settings.videoFfmpegPath.trim();
			}
			if (vaultRoot) {
				env.MDT_VAULT_ROOT = vaultRoot;
			}
			if (plugin.settings.debugLog) {
				env.MDT_DEBUG = "1";
			}

			const chunks: string[] = [];
			await new Promise<void>((resolve, reject) => {
				const child = spawn(py, [scriptPath], { env, shell: false });
				const append = (c: unknown) => chunks.push(String(c));
				child.stdout?.on("data", append);
				child.stderr?.on("data", append);
				child.on("error", (e) => reject(e));
				child.on("close", (code) => {
					if (code === 0) {
						if (chunks.join("").trim()) {
							console.info(`${LOG_PFX} render_video.py:\n`, chunks.join(""));
						}
						resolve();
						return;
					}
					reject(
						new Error(
							chunks.join("").trim() || `render_video 退出码 ${code ?? "?"}`,
						),
					);
				});
			});
		}

		try {
			writeVideoPublishCopiesMd(outDir, videoCfg);
		} catch (e) {
			console.warn(`${LOG_PFX} writeVideoPublishCopiesMd:`, e);
		}
		const upPlats = getEnabledMdtpVideoUploadPlatforms(plugin.settings);
		const pwPlats = upPlats.filter((p) => p !== "wechat_mp");
		if (pwPlats.length > 0) {
			progress.setPhase("正在尝试 Playwright 发布到已勾选平台…", 0.95, true);
			try {
				await runMdtpVideoPlaywrightPublishes(
					plugin,
					outDir,
					videoCfg,
					pwPlats,
					progress,
				);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				console.error(LOG_PFX, e);
				new Notice(`短视频已生成，但 Playwright 发布阶段出错：${msg}`, 14000);
			}
		}
		progress.setPhase("完成", 1, false);
		await new Promise((r) => setTimeout(r, 400));
		const gzhHint = upPlats.includes("wechat_mp")
			? "\n（公众号自动上传视频仍为预留。）"
			: "";
		const doneMsg = skipRender
			? `目录内已有三平台成品（douyin / xiaohongshu / shipinhao.mp4），已跳过重新合成。已按当前 video_config 更新 video_publish_copies.md，并执行了上传相关步骤（若已勾选）。\n${outDir}${gzhHint}`
			: `短视频已生成：${outDir}\n含 douyin.mp4 等，及 video_publish_copies.md。${gzhHint}`;
		new Notice(doneMsg, 16000);
	} finally {
		progress.close();
	}
}
