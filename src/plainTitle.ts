/**
 * 公众号草稿 / 小红书发布用的「纯文字」标题：去掉行内 Markdown、行首序号，避免 API 与封面出现 **、`[]` 等。
 * 正文与话题标签不在此列；仅用于 title 字段与封面主标题等。
 */

const RE_LEADING_ENUM = /^\s*(?:第[0-9０-９一二三四五六七八九十百千两]+[步][、,，]?\s*|[（(][0-9０-９一二三四五六七八九十]+[）)]\s*|[0-9０-９]+[、,，.．:：]\s*|[0-9０-９]+[)）]\s*)/u;

const RE_ZW = /[\u200B-\u200D\uFEFF]/g;

/**
 * 去掉标题行首的 `1、``（1）``第一步、` 等（仅对整段标题串、从行首反复剥离）
 */
export function stripLeadingEnumerationFromXhsTitle(s: string): string {
	try {
		let t = s.replace(/^\uFEFF/, "");
		t = t.replace(RE_ZW, "");
		let prev = "";
		while (t !== prev) {
			prev = t;
			t = t.replace(RE_LEADING_ENUM, "").trimStart();
		}
		return t.trim();
	} catch {
		return (s || "").trim();
	}
}

/** 去掉行内轻量 Markdown，得到单行纯文字（用于 title，不过度影响正文） */
function stripInlineMarkdownForTitle(s: string): string {
	if (!s) return "";
	try {
		let t = s.replace(RE_ZW, "");
		for (let pass = 0; pass < 10; pass++) {
			const before = t;
			t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
			t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
			t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
			t = t.replace(/`+([^`]+)`+/g, "$1");
			t = t.replace(/~~([^~]+)~~/g, "$1");
			t = t.replace(/<[^>]{1,200}>/g, "");
			if (t === before) break;
		}
		return t.replace(/\s+/g, " ").trim();
	} catch {
		return s.replace(/^\s+|\s+$/g, "");
	}
}

/**
 * 推送到公众号、小红书 API 的标题字段：无 Markdown、无行首列表序号。
 * 多步剥离以兼容「`1、**强调**`」等组合。
 */
export function toPlainTitleForPlatformDrafts(s: string): string {
	if (!s) return "";
	try {
		let t = s.replace(/^\uFEFF/, "");
		t = t.replace(RE_ZW, "");
		for (let i = 0; i < 3; i++) {
			t = stripLeadingEnumerationFromXhsTitle(t);
			t = stripInlineMarkdownForTitle(t);
		}
		return t.trim();
	} catch {
		return (s || "").replace(RE_ZW, "").trim().slice(0, 256);
	}
}
