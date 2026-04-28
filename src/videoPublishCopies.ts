import * as fs from "node:fs";
import * as path from "node:path";
import type { MdtpVideoConfig } from "./videoConfig";

export const VIDEO_PUBLISH_COPIES_MD = "video_publish_copies.md";

/**
 * 从 `video_config` 生成本地可复制的「发布标题 + 作品描述」，
 * 供抖音/视频号/小红书上传页粘贴（与首帧/尾帧的 opening_text 等用途不同）。
 */
export function writeVideoPublishCopiesMd(
	outDir: string,
	cfg: MdtpVideoConfig,
): void {
	const lines: string[] = [
		"本文件在「生成短视频」成功时，根据同目录下 `video_config.json` 整理；用于**各平台发布页的标题与作品描述/正文**（与视频内口播/首尾的 `cover_title` / `opening_text` 等可不同，偏运营撰写）。",
		"",
		"**说明**：可在「2 · 短视频」中开启合成后 **Playwright** 发布抖音/视频号/小红书视频（本机浏览器登录态）；公众号视频仍占位。`publish_*` 由扩写第 3 步生成。",
		"若字段为空，发布标题可暂用同平台的 `cover_title`；**视频号**本机分片上传请用命令「MDTP：视频号视频分片上传」（与公众号同 AppID/Secret）。",
		"",
	];
	const plats: [keyof MdtpVideoConfig["platforms"], string][] = [
		["douyin", "抖音"],
		["shipinhao", "微信视频号"],
		["xiaohongshu", "小红书"],
	];
	for (const [k, label] of plats) {
		const p = cfg.platforms[k];
		if (!p) continue;
		const pubTitle = (p.publish_title?.trim() || p.cover_title || "").trim();
		const pubDesc = (p.publish_description?.trim() || "").trim();
		lines.push(`## ${label}`);
		lines.push("");
		lines.push("### 发布标题");
		lines.push("");
		lines.push(pubTitle || "（空：请用 `cover_title` 或重跑扩写以生成 `publish_title`）");
		lines.push("");
		lines.push("### 作品描述 / 正文");
		lines.push("");
		lines.push(
			pubDesc ||
				"（空：请重跑扩写，在 `video_config` 的对应平台下填写 `publish_description`）",
		);
		lines.push("");
	}
	lines.push("---", "", `主题 topic：${cfg.topic || "（无）"}`);
	fs.writeFileSync(
		path.join(outDir, VIDEO_PUBLISH_COPIES_MD),
		lines.join("\n") + "\n",
		"utf8",
	);
}
