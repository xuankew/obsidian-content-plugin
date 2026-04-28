/**
 * 与 `videoTtsConfigJson` 及 scripts/render_video.py 中 MDT_VIDEO_TTS_CONFIG_JSON 一致的结构
 */
export type VideoTtsUserConfig = {
	engine: "edge" | "listenhub";
	edge: { voice: string };
	listenhub: { apiKey: string; voice: string; model: string; baseUrl?: string };
};

const DEFAULT: VideoTtsUserConfig = {
	engine: "edge",
	edge: { voice: "zh-CN-YunxiNeural" },
	listenhub: {
		apiKey: "",
		voice: "CN-Man-Beijing-V2",
		model: "flowtts",
	},
};

export function parseVideoTtsUserConfigJson(raw: string): VideoTtsUserConfig {
	if (!raw || !String(raw).trim()) {
		return { ...DEFAULT, engine: "edge" };
	}
	try {
		const o = JSON.parse(raw) as unknown;
		if (typeof o !== "object" || o === null) {
			return { ...DEFAULT };
		}
		const obj = o as Record<string, unknown>;
		const eng = String(obj.engine ?? "edge").toLowerCase();
		const engine: "edge" | "listenhub" =
			eng === "listenhub" ? "listenhub" : "edge";
		const edgeO = (obj.edge as Record<string, unknown>) || {};
		const lh = (obj.listenhub as Record<string, unknown>) || {};
		const baseUrl = lh.baseUrl != null ? String(lh.baseUrl).trim() : "";
		return {
			engine,
			edge: {
				voice: String(edgeO.voice ?? DEFAULT.edge.voice),
			},
			listenhub: {
				apiKey: String(lh.apiKey ?? ""),
				voice: String(lh.voice ?? DEFAULT.listenhub.voice),
				model: String(lh.model ?? DEFAULT.listenhub.model),
				...(baseUrl ? { baseUrl } : {}),
			},
		};
	} catch {
		return { ...DEFAULT };
	}
}

export function toVideoTtsConfigJsonString(
	c: VideoTtsUserConfig,
	pretty = true,
): string {
	const body: Record<string, unknown> = {
		engine: c.engine,
		edge: c.edge,
		listenhub: { ...c.listenhub },
	};
	if (!c.listenhub.baseUrl) {
		const l = body.listenhub as Record<string, unknown>;
		delete l.baseUrl;
	}
	return pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body);
}

/** 保证 JSON 内 `engine` 与 `videoTtsEngine` 一致，供子进程与脚本读取 */
export function applyEngineToTtsConfigJson(
	engine: "edge" | "listenhub",
	videoTtsConfigJson: string,
): string {
	const c = parseVideoTtsUserConfigJson(videoTtsConfigJson);
	c.engine = engine;
	return toVideoTtsConfigJsonString(c, true);
}

export function patchVideoTtsUserConfig(
	raw: string,
	patch: {
		engine?: "edge" | "listenhub";
		edgeVoice?: string;
		listenhubApiKey?: string;
		listenhubVoice?: string;
		listenhubModel?: string;
	},
): string {
	const c = parseVideoTtsUserConfigJson(raw);
	if (patch.engine) c.engine = patch.engine;
	if (patch.edgeVoice != null) {
		const v = patch.edgeVoice.trim();
		c.edge.voice = v || DEFAULT.edge.voice;
	}
	if (patch.listenhubApiKey != null) c.listenhub.apiKey = patch.listenhubApiKey;
	if (patch.listenhubVoice != null) {
		const v = patch.listenhubVoice.trim();
		c.listenhub.voice = v || DEFAULT.listenhub.voice;
	}
	if (patch.listenhubModel != null) {
		const v = patch.listenhubModel.trim();
		c.listenhub.model = v || DEFAULT.listenhub.model;
	}
	return toVideoTtsConfigJsonString(c, true);
}
