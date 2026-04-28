/** 解析扩写第 3 步：<<<VIDEO_SCRIPT>>> / <<<VIDEO_CONFIG>>> */
export function splitVideoScriptOutput(text: string): {
	videoScriptMd: string;
	videoConfigJson: string;
} {
	const m1 = text.indexOf("<<<VIDEO_SCRIPT>>>");
	const m2 = text.indexOf("<<<VIDEO_CONFIG>>>");
	if (m1 === -1 || m2 === -1) {
		return {
			videoScriptMd:
				"（模型未按标记输出视频脚本。以下为原始前段，请手动整理或重试扩写。）\n\n" +
				text.slice(0, 4000),
			videoConfigJson: JSON.stringify(
				{
					_parseError: "missing_markers",
					accountInfo: "",
					topic: "",
					voiceover: "",
					platforms: {
						douyin: {
							cover_title: "",
							opening_text: "",
							ending_text: "",
							publish_title: "",
							publish_description: "",
						},
						xiaohongshu: {
							cover_title: "",
							opening_text: "",
							ending_text: "",
							publish_title: "",
							publish_description: "",
						},
						shipinhao: {
							cover_title: "",
							opening_text: "",
							ending_text: "",
							publish_title: "",
							publish_description: "",
						},
					},
				},
				null,
				2,
			),
		};
	}
	const block1 = text.slice(m1 + "<<<VIDEO_SCRIPT>>>".length, m2).trim();
	let block2 = text.slice(m2 + "<<<VIDEO_CONFIG>>>".length).trim();
	// 去掉 ```json ... ``` 包裹
	const fence = block2.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/m);
	if (fence) {
		block2 = fence[1].trim();
	}
	let pretty = block2;
	try {
		pretty = JSON.stringify(JSON.parse(block2), null, 2);
	} catch {
		// 保留原文，由下游修正
	}
	return {
		videoScriptMd: block1 || "（空）",
		videoConfigJson: pretty,
	};
}
