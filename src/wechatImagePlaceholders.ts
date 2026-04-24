/**
 * 公众号文内插图占位：支持
 * 1) 传统：`[配图：说明 | 生图提示词：xxx]`
 * 2) 全角：从 `【配图提示词】` 起，若干行为生图用中文提示；可跟 `配图内容：…` 作图说/alt；仅提示词时可用空行结束块
 */

export const WECHAT_LEGACY_IMAGE_PLACEHOLDER_RE =
	/\[配图[：:]\s*([^|\]]+?)(?:\s*[|｜]\s*生图提示词[：:]\s*([^\]]+))?\]/g;

const MARK = "【配图提示词】";
const PC_LINE = /^\s*配图内容[：:]\s*(.*)$/;

export type WechatImagePlaceholderMatch = {
	start: number;
	end: number;
	full: string;
	prompt: string;
	desc: string;
	kind: "legacy" | "fullwidth";
};

const DEFAULT_IMAGE_PROMPT =
	"温馨中国家庭室内场景，卡通插画，父亲母亲约35岁、女儿12岁儿子9岁";

function findLegacyPlaceholders(src: string): WechatImagePlaceholderMatch[] {
	const re = new RegExp(WECHAT_LEGACY_IMAGE_PLACEHOLDER_RE.source, "g");
	const out: WechatImagePlaceholderMatch[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(src))) {
		if (m.index === undefined) continue;
		const full = m[0];
		const d = (m[1] || "").trim().replace(/\s+/g, " ");
		const p = ((m[2] as string | undefined) || m[1] || "").trim() || d;
		out.push({
			start: m.index,
			end: m.index + full.length,
			full,
			prompt: p,
			desc: d || p,
			kind: "legacy",
		});
	}
	return out;
}

function findFullwidthPlaceholders(src: string): WechatImagePlaceholderMatch[] {
	const out: WechatImagePlaceholderMatch[] = [];
	const len = src.length;
	const markLen = MARK.length;
	let from = 0;

	while (from < len) {
		const idx = src.indexOf(MARK, from);
		if (idx < 0) break;
		const blockStart = idx;
		let i = idx + markLen;
		if (i < len && (src[i] === "：" || src[i] === ":")) {
			i++;
		}
		const line0End = src.indexOf("\n", i);
		const e0 = line0End < 0 ? len : line0End;
		const firstLine = src.slice(i, e0).trim();
		const promptLines: string[] = [];
		if (firstLine.length > 0) {
			promptLines.push(firstLine);
		}
		let cur = line0End < 0 ? len : line0End + 1;
		let desc = "";
		let blockEnd = len;
		while (cur < len) {
			const lineEnd = src.indexOf("\n", cur);
			const line = lineEnd < 0 ? src.slice(cur) : src.slice(cur, lineEnd);
			const t = line.trim();
			if (t.length === 0) {
				if (promptLines.length > 0) {
					blockEnd = cur;
					break;
				}
				if (lineEnd < 0) {
					blockEnd = len;
					break;
				}
				cur = lineEnd + 1;
				continue;
			}
			const pcm = t.match(PC_LINE);
			if (pcm) {
				desc = (pcm[1] || "").trim();
				blockEnd = lineEnd < 0 ? len : lineEnd + 1;
				break;
			}
			if (t.startsWith(MARK) || /^\[配图[：:]/.test(t)) {
				blockEnd = cur;
				break;
			}
			promptLines.push(t);
			if (lineEnd < 0) {
				blockEnd = len;
				break;
			}
			cur = lineEnd + 1;
		}
		if (cur >= len && blockEnd === len) {
			blockEnd = len;
		}
		const prompt = promptLines.join(" ").replace(/\s+/g, " ").trim();
		const promptForApi = prompt || DEFAULT_IMAGE_PROMPT;
		let descForAlt = desc;
		if (!descForAlt) {
			if (prompt) {
				descForAlt =
					prompt.length > 72 ? `${prompt.slice(0, 69)}…` : prompt;
			} else {
				descForAlt = "插图";
			}
		} else if (descForAlt.length > 72) {
			descForAlt = `${descForAlt.slice(0, 69)}…`;
		}
		const full = src.slice(blockStart, blockEnd);
		out.push({
			start: blockStart,
			end: blockEnd,
			full,
			prompt: promptForApi,
			desc: descForAlt,
			kind: "fullwidth",
		});
		from = blockEnd;
	}
	return out;
}

function rangesOverlap(
	a: { start: number; end: number },
	b: { start: number; end: number },
): boolean {
	return !(a.end <= b.start || b.end <= a.start);
}

/**
 * 合并传统与全角；与全角区域重叠的 `[配图…]` 不再单独匹配（以全角为准）。
 */
export function findAllWechatImagePlaceholders(
	src: string,
): WechatImagePlaceholderMatch[] {
	const fullw = findFullwidthPlaceholders(src);
	const fullRanges = fullw.map((b) => ({ start: b.start, end: b.end }));
	const legacy = findLegacyPlaceholders(src).filter(
		(m) => !fullRanges.some((r) => rangesOverlap(m, r)),
	);
	return [...fullw, ...legacy].sort((a, b) => a.start - b.start);
}

/**
 * 摘要等：去掉文内未替换的插图占位。
 */
export function stripWechatImagePlaceholderTextForDigest(src: string): string {
	let t = src;
	for (const m of [...findAllWechatImagePlaceholders(t)].sort(
		(a, b) => b.start - a.start,
	)) {
		t = t.slice(0, m.start) + t.slice(m.end);
	}
	return t;
}
