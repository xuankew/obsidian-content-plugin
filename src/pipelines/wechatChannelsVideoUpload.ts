import { Notice } from "obsidian";
import type { TFile } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import { getAccessToken } from "../wechatApi";
import { channelsVideoUploadFull } from "../wechatChannelsApi";

/**
 * 读取库内 .mp4，走 init + 分片 chunk。与公众号共用 access_token。
 * 若微信文档另有 finish/complete 步骤，需在拿到 upload_id 后另行调用（本插件仅实现 init+chunk）。
 */
export async function runWechatChannelsVideoUpload(
	plugin: MdToPlatformPlugin,
	file: TFile,
	onProgress?: (done: number, total: number) => void,
): Promise<{ uploadId: string; lastChunkJson: string }> {
	const s = plugin.settings;
	if (!s.wechatAppId.trim() || !s.wechatAppSecret.trim()) {
		throw new Error(
			"请先在设置中填写公众号 AppID 与 AppSecret（与视频号共用 access_token）",
		);
	}
	const ext = file.extension.toLowerCase();
	if (ext !== "mp4") {
		throw new Error("请选择扩展名为 .mp4 的视频文件");
	}

	const token = await getAccessToken(s.wechatAppId, s.wechatAppSecret);
	const buf = Buffer.from(await plugin.app.vault.readBinary(file));
	const chunkSize =
		Number.isFinite(s.channelsVideoChunkSize) && s.channelsVideoChunkSize >= 65536
			? s.channelsVideoChunkSize
			: 1048576;

	const { uploadId, lastChunk } = await channelsVideoUploadFull({
		accessToken: token,
		initPath: s.channelsVideoInitPath,
		chunkPath: s.channelsVideoChunkPath,
		fileBuffer: buf,
		fileName: file.name,
		chunkSize,
		mediaType: s.channelsVideoChunkMediaType,
		onProgress,
	});

	const lastChunkJson = JSON.stringify(lastChunk, null, 2);
	return { uploadId, lastChunkJson };
}

/** 供 UI 调用：统一 Notice，失败时抛出已含说明的 Error */
export async function runWechatChannelsVideoUploadWithNotice(
	plugin: MdToPlatformPlugin,
	file: TFile,
	onProgress?: (done: number, total: number) => void,
): Promise<void> {
	try {
		new Notice("正在获取 access_token 并上传视频…", 5000);
		const { uploadId, lastChunkJson } = await runWechatChannelsVideoUpload(
			plugin,
			file,
			onProgress,
		);
		console.info(
			"[md-to-platform] 视频号分片上传完成 upload_id=%s\n%s",
			uploadId,
			lastChunkJson,
		);
		new Notice(
			`视频号分片上传完成，upload_id=${uploadId}。完整响应已写入控制台；若业务还需「完结」接口请按文档另行对接。`,
			14000,
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		new Notice(`视频号上传失败：${msg}`, 12000);
		throw e;
	}
}
