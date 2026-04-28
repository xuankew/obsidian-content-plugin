import type { MdToPlatformSettings } from "../settings";

/**
 * 预留：将 mdtp 生成的竖屏 MP4 **自动**发布到各平台（当前**未接好**，`uploadMdtpVideoStub` 仅返回说明）。
 * 抖音无单独开关；各平台**发布标题/作品描述**见会话目录下 `video_publish_copies.md` 与 `video_config.json`。
 * 微信视频号**网页 Playwright 发表**或**手动**分片上传（分片为独立命令）见主流程说明。
 */
export type MdtpVideoPlatformId =
	| "douyin"
	| "xiaohongshu"
	| "shipinhao"
	| /** 微信公众号（视频素材等，仍占位） */
		"wechat_mp";

export interface MdtpVideoUploadResult {
	ok: boolean;
	platform: MdtpVideoPlatformId;
	message: string;
	raw?: unknown;
}

/** 未再用于主路径；`mdtpVideo` 直接调 `playwrightMdtpVideo` */
export async function uploadMdtpVideoStub(
	platform: MdtpVideoPlatformId,
	_localMp4Path: string,
): Promise<MdtpVideoUploadResult> {
	return {
		ok: false,
		platform,
		message:
			platform === "wechat_mp"
				? "公众号视频仍占位：请手动或后续接素材 API。"
				: "未启用对应开关：请用「生成短视频」并勾选各平台发布。",
	};
}

const PLATFORM_ORDER: MdtpVideoPlatformId[] = [
	"douyin",
	"xiaohongshu",
	"wechat_mp",
	"shipinhao",
];

export function getEnabledMdtpVideoUploadPlatforms(
	s: Pick<
		MdToPlatformSettings,
		| "videoUploadDouyin"
		| "videoUploadXiaohongshu"
		| "videoUploadGongzhonghao"
		| "videoUploadShipinhao"
	>,
): MdtpVideoPlatformId[] {
	const out: MdtpVideoPlatformId[] = [];
	if (s.videoUploadDouyin) out.push("douyin");
	if (s.videoUploadXiaohongshu) out.push("xiaohongshu");
	if (s.videoUploadGongzhonghao) out.push("wechat_mp");
	if (s.videoUploadShipinhao) out.push("shipinhao");
	return PLATFORM_ORDER.filter((p) => out.includes(p));
}
