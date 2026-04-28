/**
 * 与 video_config.json 对齐的结构（可扩展 voiceover 等字段）
 */
export type VideoPlatformCopy = {
	cover_title: string;
	opening_text: string;
	ending_text: string;
	/**
	 * 各平台**上传页**用的短标题；可与 `cover_title` 相同或更短/更合规。空则发布时可沿用 `cover_title`。
	 */
	publish_title?: string;
	/**
	 * 各平台**作品描述/简介/正文**（可含话题占位）。用于手动复制到抖音、视频号、小红书等，与首帧/尾帧口播字句区分。
	 */
	publish_description?: string;
};

export type MdtpVideoConfig = {
	accountInfo: string;
	topic: string;
	/** 主配音全文（TTS 用；若缺省则由脚本从 Markdown 里尝试抽取） */
	voiceover?: string;
	platforms: {
		douyin: VideoPlatformCopy;
		xiaohongshu: VideoPlatformCopy;
		shipinhao: VideoPlatformCopy;
	};
	/** 元信息 */
	_targetSeconds?: number;
};

export function parseVideoConfigJson(raw: string): MdtpVideoConfig {
	const o = JSON.parse(raw) as unknown;
	if (typeof o !== "object" || o === null) {
		throw new Error("video_config 不是对象");
	}
	const obj = o as Record<string, unknown>;
	const pl = obj.platforms as Record<string, unknown> | undefined;
	if (!pl || typeof pl !== "object") {
		throw new Error("video_config 缺少 platforms");
	}
	const need = (p: string): VideoPlatformCopy => {
		const v = pl[p] as Record<string, unknown> | undefined;
		if (!v) {
			return { cover_title: "", opening_text: "", ending_text: "" };
		}
		return {
			cover_title: String(v.cover_title ?? ""),
			opening_text: String(v.opening_text ?? ""),
			ending_text: String(v.ending_text ?? ""),
			publish_title:
				v.publish_title != null ? String(v.publish_title) : undefined,
			publish_description:
				v.publish_description != null
					? String(v.publish_description)
					: undefined,
		};
	};
	return {
		accountInfo: String(obj.accountInfo ?? ""),
		topic: String(obj.topic ?? ""),
		voiceover: obj.voiceover != null ? String(obj.voiceover) : undefined,
		platforms: {
			douyin: need("douyin"),
			xiaohongshu: need("xiaohongshu"),
			shipinhao: need("shipinhao"),
		},
		_targetSeconds:
			typeof obj._targetSeconds === "number" ? obj._targetSeconds : undefined,
	};
}
