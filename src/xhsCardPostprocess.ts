/**
 * 小红书卡片正文预处理：去尾图话题、解析封面文案（对齐 Auto-Redbook cover.html 字段）。
 */

/** 行是否仅由 # 话题 构成（支持全角＃、多空格、NBSP） */
function isHashtagOnlyLine(line: string): boolean {
	const t = line.replace(/\u00a0/g, " ").trim();
	if (!t) return false;
	const parts = t.split(/\s+/).filter(Boolean);
	return parts.length > 0 && parts.every((p) => /^[#＃][^\s#＃]+$/u.test(p));
}

/** 去掉行尾话题簇：「空格+#词」或「标点+#词…」 */
function stripTrailingHashtagClustersFromLineEnd(line: string): string {
	let s = line.replace(/(\s+[#＃][^\s#＃]+)+$/gu, "");
	s = s.replace(/([，。！？、,.!?])\s*((?:[#＃][^\s#＃]+\s*)+)$/gu, "$1");
	return s.trimEnd();
}

/** 去掉文末连续「仅由 #话题 组成的行」 */
export function stripTrailingHashtagOnlyLines(markdown: string): string {
	const lines = markdown.split("\n");
	let end = lines.length;
	while (end > 0) {
		const raw = lines[end - 1];
		if (raw.trim() === "") {
			end--;
			continue;
		}
		if (isHashtagOnlyLine(raw)) {
			end--;
			continue;
		}
		break;
	}
	return lines.slice(0, end).join("\n").trimEnd();
}

/**
 * 最后一张卡片导出前：去掉所有应出现在发文案里的话题（独占行 + 句末/标点后的尾部 #标签）
 */
export function sanitizeLastCardForImage(markdown: string): string {
	let s = stripTrailingHashtagOnlyLines(markdown);
	const lines = s.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim() === "") continue;
		const raw = lines[i];
		const trimmedRight = raw.trimEnd();
		const cut = stripTrailingHashtagClustersFromLineEnd(trimmedRight);
		if (cut !== trimmedRight) {
			if (cut.trim() === "") {
				lines.splice(i, 1);
			} else {
				lines[i] = raw.slice(0, raw.length - (trimmedRight.length - cut.length));
			}
		}
		break;
	}
	return lines.join("\n").trimEnd();
}

/** 从 publish_xhs 取标题候选；否则用首张卡片首行兜底 */
export function extractXhsCoverFields(
	publishMd: string | null,
	firstCardSnippet: string,
): { title: string; subtitle: string; emoji: string } {
	let title = "";
	let subtitle = "";
	const emojiDefault = "📌";

	if (publishMd && publishMd.trim()) {
		const t1 = publishMd.match(/标题\s*[1１一]\s*[：:]\s*(.+)/u);
		if (t1) title = t1[1].trim();
		const t2 = publishMd.match(/标题\s*[2２二]\s*[：:]\s*(.+)/u);
		if (t2) subtitle = t2[1].trim();
	}

	if (!title) {
		const line =
			firstCardSnippet
				.split("\n")
				.map((l) => l.trim())
				.find((l) => l.length > 0) ?? "";
		title = line
			.replace(/\*\*/g, "")
			.replace(/^#{1,6}\s+/, "")
			.replace(/^>\s*/, "")
			.trim();
		if (title.length > 22) title = `${title.slice(0, 21)}…`;
	}
	if (!title) title = "笔记";

	if (!subtitle) subtitle = "核心要点 · 建议收藏";

	let emoji = emojiDefault;
	const reEmoji = /\p{Extended_Pictographic}/u;
	const em = title.match(reEmoji);
	if (em) {
		emoji = em[0];
		title = title.replace(reEmoji, "").trim();
	}
	if (!title) title = "笔记";

	return { title, subtitle, emoji };
}
