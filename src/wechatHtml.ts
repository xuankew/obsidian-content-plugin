import { parseHTML } from "linkedom";
import { HUASHENG_STYLES } from "./huasheng/stylesData";
import { renderHuashengWechatHtml } from "./huasheng/renderHuashengWechat";
import { stripWechatImagePlaceholderTextForDigest } from "./wechatImagePlaceholders";

/** 公众号 sanitize 用：Obsidian 有 DOMParser；无则用 linkedom，避免展平/删空 li 整段被跳过。 */
function mutateWechatHtmlInFragment(
	html: string,
	rootId: string,
	mutate: (root: Element, doc: Document) => void,
): string {
	const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="${rootId}">${html}</div></body></html>`;
	const run = (doc: Document, root: Element | null): string | null => {
		if (!root) return null;
		mutate(root, doc);
		return root.innerHTML;
	};
	if (typeof DOMParser !== "undefined") {
		try {
			const doc = new DOMParser().parseFromString(wrapped, "text/html");
			const out = run(doc, doc.getElementById(rootId));
			if (out !== null) return out;
		} catch {
			/* 走 linkedom */
		}
	}
	try {
		const { document } = parseHTML(wrapped);
		const out = run(document, document.getElementById(rootId));
		if (out !== null) return out;
	} catch {
		/* */
	}
	return html;
}

/** 设置页下拉：与 [huasheng_editor](https://github.com/alchaincyf/huasheng_editor) 同源样式 id / 名称 */
export const WECHAT_THEME_OPTIONS: readonly { id: string; name: string }[] = Object.keys(
	HUASHENG_STYLES,
).map((id) => ({ id, name: HUASHENG_STYLES[id]!.name }));

/** 旧版 bm.md 时代主题 id → 花生样式 id */
const LEGACY_THEME_TO_HUASHENG: Record<string, string> = {
	default: "wechat-default",
	minimal: "wechat-elegant",
	warm: "warm-docs",
	professional: "wechat-default",
	"ayu-light": "wechat-default",
	bauhaus: "wechat-tech",
	blueprint: "wechat-tech",
	botanical: "wechat-elegant",
	"green-simple": "wechat-default",
	maximalism: "warm-docs",
	"neo-brutalism": "guardian",
	newsprint: "nikkei",
	organic: "wechat-elegant",
	"playful-geometric": "gaudi-organic",
	retro: "latepost-depth",
	sketch: "wechat-nyt",
	terminal: "wechat-tech",
};

/** 将设置中的主题 id 规范为 `HUASHENG_STYLES` 中的键 */
export function normalizeWechatTheme(theme: string): string {
	const raw = theme.trim();
	if (HUASHENG_STYLES[raw]) return raw;
	const mapped = LEGACY_THEME_TO_HUASHENG[raw];
	if (mapped && HUASHENG_STYLES[mapped]) return mapped;
	return "wechat-default";
}

/**
 * CommonMark 下「- 第一项」后空一行再跟**未缩进**的续段，会把续段解析到 `</ul>` 之外，
 * 表现为：列表里像多了空条目、重点句跑到列表外、微信里出现「幽灵项目符号」。
 * 在续行前补 4 空格，使其成为同一条列表项内的下一段（与规范中多段列表一致）。
 */
export function mergeListItemContinuationsForWechat(markdown: string): string {
	const lines = markdown.split(/\r?\n/);
	const out: string[] = [];
	let i = 0;

	const isListLine = (s: string): boolean =>
		/^\s*(?:[-*+]|\d+\.)\s/.test(s) &&
		s.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim() !== "";
	const isBlank = (s: string): boolean => s.trim() === "";
	const isFoldableContinuation = (s: string): boolean => {
		if (isBlank(s)) return false;
		// 顶格起行（行首非空格/Tab）：CommonMark 会当作列表已结束后的新段落，不得再缩进并进上一条 li，
		// 否则最后一条有序项会吞掉后续正文，微信里表现为编号错乱、ul 与上文粘连等。
		if (!/^[ \t]/.test(s)) return false;
		const t = s.trimStart();
		if (/^\s*(?:[-*+]|\d+\.)\s/.test(s)) return false;
		if (/^#{1,6}\s/.test(t)) return false;
		if (/^>\s?/.test(t)) return false;
		if (/^```/.test(t)) return false;
		return true;
	};

	while (i < lines.length) {
		const line = lines[i]!;
		out.push(line);

		if (
			isListLine(line) &&
			i + 1 < lines.length &&
			isBlank(lines[i + 1]!)
		) {
			let j = i + 1;
			while (j < lines.length && isBlank(lines[j]!)) j++;
			if (j < lines.length && isFoldableContinuation(lines[j]!)) {
				for (let b = i + 1; b < j; b++) out.push(lines[b]!);
				while (j < lines.length) {
					const L = lines[j]!;
					if (isBlank(L)) {
						let k = j + 1;
						while (k < lines.length && isBlank(lines[k]!)) k++;
						if (k >= lines.length) {
							out.push(L);
							j = k;
							break;
						}
						const nx = lines[k]!;
						if (
							isListLine(nx) ||
							/^#{1,6}\s/.test(nx.trimStart()) ||
							/^>\s?/.test(nx.trimStart()) ||
							/^```/.test(nx.trimStart())
						) {
							j = k;
							break;
						}
						out.push("");
						j = k;
						continue;
					}
					if (isListLine(L)) break;
					if (/^#{1,6}\s/.test(L.trimStart())) break;
					if (/^>\s?/.test(L.trimStart())) break;
					out.push(/^\s{4,}/.test(L) ? L : `    ${L.trimStart()}`);
					j++;
				}
				i = j;
				continue;
			}
		}
		i++;
	}
	return out.join("\n");
}

/**
 * 「1. **标题**」与下一行「(说明…) / （说明…）」之间**仅单换行、无空行」时，CommonMark 常解析成同一 li 内两个 &lt;p&gt;，
 * 微信里会像「一条空编号 + 一条有字」交错。将顶格括号行缩进为列表续段，利于合并为一段或单 p。
 */
export function mergeParenLineAfterListItemForWechat(markdown: string): string {
	const lines = markdown.split(/\r?\n/);
	const out: string[] = [];
	let i = 0;
	const isBlank = (s: string) => s.trim() === "";
	const isListLine = (s: string): boolean =>
		/^\s*(?:[-*+]|\d+\.)\s/.test(s) &&
		s.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim() !== "";
	while (i < lines.length) {
		const line = lines[i]!;
		if (
			isListLine(line) &&
			i + 1 < lines.length &&
			!isBlank(lines[i + 1]!)
		) {
			const next = lines[i + 1]!;
			const t = next.trimStart();
			if (
				/^(?:\(|（)/.test(t) &&
				!/^\s*(?:[-*+]|\d+\.)\s/.test(next)
			) {
				out.push(line);
				out.push(/^\s{4,}/.test(next) ? next : `    ${t}`);
				i += 2;
				continue;
			}
		}
		out.push(line);
		i++;
	}
	return out.join("\n");
}

/** 顶格短句（如「重复三四次。」）紧跟在 `* 最后一行` 后、中间无空行时，CommonMark 会当成列表外新段落；缩进后进同一条 li。 */
const FLUSH_TAIL_MAX_LEN = 52;

export function mergeFlushTailAfterListItemForWechat(markdown: string): string {
	const lines = markdown.split(/\r?\n/);
	const out: string[] = [];
	let i = 0;
	const isBlank = (s: string) => s.trim() === "";
	const isListLine = (s: string): boolean =>
		/^\s*(?:[-*+]|\d+\.)\s/.test(s) &&
		s.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim() !== "";

	while (i < lines.length) {
		const line = lines[i]!;
		if (
			isListLine(line) &&
			i + 1 < lines.length &&
			!isBlank(lines[i + 1]!)
		) {
			const next = lines[i + 1]!;
			if (/^[ \t]/.test(next)) {
				out.push(line);
				i++;
				continue;
			}
			if (/^\s*(?:[-*+]|\d+\.)\s/.test(next)) {
				out.push(line);
				i++;
				continue;
			}
			const t = next.trimStart();
			if (/^#{1,6}\s/.test(t)) {
				out.push(line);
				i++;
				continue;
			}
			if (/^```/.test(t) || /^>\s?/.test(t) || /^!\[/.test(t)) {
				out.push(line);
				i++;
				continue;
			}
			if (/^(?:\*|-|_){3,}\s*$/.test(t.trim())) {
				out.push(line);
				i++;
				continue;
			}
			const trimmed = t.trim();
			if (
				trimmed.length > 0 &&
				trimmed.length <= FLUSH_TAIL_MAX_LEN &&
				!isBlank(next)
			) {
				out.push(line);
				out.push(/^\s{4,}/.test(next) ? next : `    ${trimmed}`);
				i += 2;
				continue;
			}
		}
		out.push(line);
		i++;
	}
	return out.join("\n");
}

/** 零宽字符常见于 LLM 输出，夹在 `-` 与正文之间时会导致「看似有字、实为幽灵列表项」 */
const ZW_RE = /[\u200b\ufeff]/g;

function isEmptyListMarkerLine(line: string): boolean {
	const t = line.replace(ZW_RE, "");
	const ul = t.match(/^(\s*)([-*+])\s*(.*)$/);
	if (ul) {
		const body = (ul[3] ?? "")
			.replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, "")
			.trim();
		return body === "";
	}
	const ol = t.match(/^(\s*)(\d+)\.\s*(.*)$/);
	if (ol) {
		const body = (ol[3] ?? "")
			.replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, "")
			.trim();
		return body === "";
	}
	return false;
}

/**
 * 代码块外去掉零宽字符，减少列表/排版异常。
 */
export function stripZeroWidthOutsideCodeBlocks(markdown: string): string {
	const chunks = markdown.split(/(```[\s\S]*?```)/g);
	return chunks
		.map((c, i) => (i % 2 === 1 ? c : c.replace(ZW_RE, "")))
		.join("");
}

/**
 * 删除仅含列表标记而无正文的行（含 `- `、`-`、全角空格、零宽字符等「假空」），避免渲染出空列表项。
 */
export function removeEmptyMarkdownListMarkerLines(markdown: string): string {
	const chunks = markdown.split(/(```[\s\S]*?```)/g);
	return chunks
		.map((c, i) => {
			if (i % 2 === 1) return c;
			return c
				.split(/\r?\n/)
				.filter((line) => !isEmptyListMarkerLine(line))
				.join("\n");
		})
		.join("");
}

/**
 * 段落内**单个换行**在 markdown-it 中往往被当成空格。
 * 对非列表、非标题、非代码块的连续行，转为 Markdown 硬换行（行末两空格），以便对话、短句分段在公众号里仍换行显示。
 */
export function markdownHardBreaksForWechatRender(markdown: string): string {
	const chunks = markdown.split(/(^```[\s\S]*?^```)/gm);
	return chunks
		.map((chunk, i) => {
			if (i % 2 === 1) return chunk;
			return hardBreakInPlainBlocks(chunk);
		})
		.join("");
}

function hardBreakInPlainBlocks(md: string): string {
	const blocks = md.split(/\n\n+/);
	return blocks
		.map((block) => {
			if (!block.includes("\n")) return block;
			const lines = block.split("\n");
			if (lines.length <= 1) return block;
			const t0 = lines[0]!.trimStart();
			if (/^#{1,6}\s/.test(t0)) return block;
			if (/^>\s?/.test(t0)) return block;
			if (lines.some((l) => /^[ \t]*(?:[-*+]|\d+\.)\s/.test(l))) return block;
			if (lines.some((l) => /^\s*\|/.test(l))) return block;
			if (lines.some((l) => /^[ \t]{0,3}```/.test(l))) return block;
			return lines.map((l) => l.replace(/\s+$/, "")).join("  \n");
		})
		.join("\n\n");
}

/**
 * 列表项之间的空行会被解析为「松散列表」，易生成 `&lt;li&gt;&lt;p&gt;…&lt;/p&gt;`，公众号编辑器易多出幽灵项目符号。
 * 在送渲染前去掉**仅夹在两条列表行之间**的空行（不影响「段落与列表之间」的空行）。
 */
export function collapseMarkdownListBlankLines(markdown: string): string {
	let md = markdown.replace(
		/([：:])\s*\n\s*\n+(\s*(?:[-*+]|\d+\.)\s)/gm,
		"$1\n$2",
	);
	for (let iter = 0; iter < 6; iter++) {
		const lines = md.split(/\r?\n/);
		const out: string[] = [];
		function isListLine(l: string): boolean {
			const t = l.replace(ZW_RE, "");
			if (isEmptyListMarkerLine(l)) return true;
			return /^[ \t]*(?:[-*+]|\d+\.)\s/.test(t);
		}
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (line.trim() === "" && i > 0 && i < lines.length - 1) {
				if (isListLine(lines[i - 1]!) && isListLine(lines[i + 1]!)) {
					continue;
				}
			}
			out.push(line);
		}
		const joined = out.join("\n");
		if (joined === md) break;
		md = joined;
	}
	return md;
}

/**
 * 将 &lt;li&gt; 内直接子级 &lt;p&gt; 展平（多段用 &lt;br /&gt;&lt;br /&gt; 连接），避免：
 * - 松散列表的 li&gt;p 与主题里 `p { margin: … }` 叠加大间距、像「空一条」；
 * - 正则误匹配「一个 li 内多个 p」时把 HTML 截断，造成幽灵编号/圆点。
 * 嵌套列表自深到浅处理，避免先改父级 innerHTML 时子级仍指向旧节点。
 */
function flattenListItemParagraphsForWechatHtml(html: string): string {
	return mutateWechatHtmlInFragment(html, "mdtp-li-flat-root", (root) => {
		const lis = Array.from(root.querySelectorAll("li"));
		lis.sort((a, b) => listItemNestingDepth(b) - listItemNestingDepth(a));
		for (const li of lis) {
			flattenSingleLiParagraphs(li);
		}
	});
}

function listItemNestingDepth(li: Element): number {
	let n = 0;
	let el: Element | null = li;
	while (el) {
		if (el.tagName === "LI") n++;
		el = el.parentElement;
	}
	return n;
}

function flattenSingleLiParagraphs(li: Element): void {
	const kids = Array.from(li.children);
	if (kids.length === 0) return;
	if (!kids.some((k) => k.tagName === "P")) return;

	if (kids.every((k) => k.tagName === "P")) {
		const parts = kids
			.map((k) => (k as HTMLElement).innerHTML.trim())
			.filter((s) => s.length > 0);
		li.innerHTML = parts.length > 0 ? parts.join("<br /><br />") : "";
		return;
	}

	let i = 0;
	while (i < kids.length && kids[i]!.tagName === "P") i++;
	if (i === 0) return;

	const leadingPs = kids.slice(0, i);
	const rest = kids.slice(i);
	const merged = leadingPs
		.map((k) => (k as HTMLElement).innerHTML.trim())
		.filter((s) => s.length > 0)
		.join("<br /><br />");
	li.innerHTML = merged + rest.map((el) => el.outerHTML).join("");
}

const HOIST_OUT_OF_LIST_TAGS = new Set([
	"P",
	"DIV",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
]);

/**
 * 若 ul/ol 下出现直接子级的 p/div/标题（非 li），属无效结构，微信常把其后正文缩进成「列表内」。
 * 将这些节点整段移到列表之后。
 */
function hoistNonLiDirectChildrenOutOfLists(html: string): string {
	return mutateWechatHtmlInFragment(html, "mdtp-hoist-root", (root, doc) => {
		for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
			const toMove: Element[] = [];
			for (const child of Array.from(list.children)) {
				if (child.tagName === "LI") continue;
				if (HOIST_OUT_OF_LIST_TAGS.has(child.tagName)) toMove.push(child);
			}
			if (toMove.length === 0) continue;
			const frag = doc.createDocumentFragment();
			for (const el of toMove) frag.appendChild(el);
			list.parentNode?.insertBefore(frag, list.nextSibling);
		}
	});
}

/**
 * 用 DOM 删除仍残留的「空 li」（仅 br/空白/&nbsp;），避免微信里出现幽灵圆点。
 */
function stripEmptyListItemsFromWechatHtml(html: string): string {
	return mutateWechatHtmlInFragment(html, "mdtp-sanitize-root", (root) => {
		const isLiVisuallyEmpty = (li: Element): boolean => {
			if (li.querySelector("img, picture, svg, video, iframe")) return false;
			const t = (li.textContent || "")
				.replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, "")
				.trim();
			return t.length === 0;
		};

		for (let pass = 0; pass < 30; pass++) {
			let changed = false;
			for (const li of Array.from(root.querySelectorAll("li"))) {
				if (isLiVisuallyEmpty(li)) {
					li.remove();
					changed = true;
				}
			}
			for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
				if (list.querySelector("li") === null) {
					list.remove();
					changed = true;
				}
			}
			if (!changed) break;
		}
	});
}

/**
 * 微信公众号编辑器对「列表项内再包一层 &lt;p&gt;」兼容性很差（松散列表会生成 `&lt;li&gt;&lt;p&gt;…&lt;/p&gt;&lt;/li&gt;`），
 * 易出现多余项目符号、空白一条、编号错位等。推送前用 DOM 展平 li 内段落（勿用正则逐段替换，多 &lt;p&gt; 时会截断 HTML）。
 * 保留原生 ul/ol/li，再叠一层内联样式，减轻主题与编辑器默认样式冲突导致的「幽灵圆点」等。
 */
export function sanitizeWechatArticleHtmlForMpEditor(html: string): string {
	let out = flattenListItemParagraphsForWechatHtml(html);
	for (let n = 0; n < 12; n++) {
		const before = out;
		out = out.replace(/<li([^>]*)>\s*<br\s*\/?>\s*<\/li>/gi, "");
		out = out.replace(/<li([^>]*)>\s*<p([^>]*)>\s*<\/p>\s*<\/li>/gi, "");
		out = out.replace(
			/<li([^>]*)>\s*<p[^>]*>\s*(?:&nbsp;|&#160;|\u00a0|\s)*<br\s*\/?>\s*<\/p>\s*<\/li>/gi,
			"",
		);
		out = out.replace(
			/<li([^>]*)>\s*(?:&nbsp;|&#160;|\u00a0|\s|<br\s*\/?>)*\s*<\/li>/gi,
			"",
		);
		out = out.replace(/<li([^>]*)>\s*<\/li>/gi, "");
		if (out === before) break;
	}
	out = stripEmptyListItemsFromWechatHtml(out);
	out = hoistNonLiDirectChildrenOutOfLists(out);
	out = applyWechatNativeListPresentation(out);
	out = normalizeWechatArticleImagesForMobile(out);
	return out;
}

function mergeWechatElementStyle(el: Element, additions: string): void {
	const cur = (el.getAttribute("style") || "")
		.trim()
		.replace(/^;+\s*/, "")
		.replace(/;+\s*$/g, "");
	el.setAttribute("style", cur ? `${cur}; ${additions}` : additions);
}

/**
 * 在公众号编辑器里强化原生列表的 list-style 与缩进，并压平 li 内残留 &lt;p&gt; 的外边距，
 * 避免与主题内联样式叠加后出现错位、多空行。
 * `list-style-position: inside`：窄屏/微信里 outside 易把「符号一行、正文下一行」拆开。
 */
function applyWechatNativeListPresentation(html: string): string {
	return mutateWechatHtmlInFragment(html, "mdtp-native-list", (root) => {
		root.querySelectorAll("ul").forEach((ul) => {
			mergeWechatElementStyle(
				ul,
				"list-style-type: disc !important; list-style-position: inside !important; padding-left: 0.75em !important; margin: 14px 0 !important;",
			);
		});
		root.querySelectorAll("ol").forEach((ol) => {
			mergeWechatElementStyle(
				ol,
				"list-style-type: decimal !important; list-style-position: inside !important; padding-left: 0.85em !important; margin: 14px 0 !important;",
			);
		});
		root.querySelectorAll("li").forEach((li) => {
			mergeWechatElementStyle(
				li,
				"margin: 5px 0 !important; display: list-item !important; text-indent: 0 !important; overflow-wrap: break-word !important; word-break: break-word !important;",
			);
		});
		root.querySelectorAll("li > p").forEach((p) => {
			mergeWechatElementStyle(p, "margin: 0 !important; text-indent: 0 !important;");
		});
	});
}

/**
 * 主题里 img 常带 max-height:500px 等，竖图在手机上会按高度缩成很窄一条；去掉过严高度上限并拉满版心宽度。
 * 仅含一张插图的段落若继承「首行缩进」，易把图挤偏，一并去掉。
 */
function normalizeWechatArticleImagesForMobile(html: string): string {
	return mutateWechatHtmlInFragment(html, "mdtp-img-mobile", (root) => {
		root.querySelectorAll("img").forEach((img) => {
			mergeWechatElementStyle(
				img,
				"width: 100% !important; max-width: 100% !important; height: auto !important; max-height: none !important; box-sizing: border-box !important; display: block !important; margin-left: auto !important; margin-right: auto !important;",
			);
		});
		for (const p of Array.from(root.querySelectorAll("p"))) {
			const kids = p.querySelectorAll("*");
			if (kids.length !== 1 || kids[0]!.tagName !== "IMG") continue;
			mergeWechatElementStyle(
				p,
				"text-indent: 0 !important; margin-left: 0 !important; margin-right: 0 !important;",
			);
		}
	});
}

/**
 * 与 {@link extractTitle} 一致：仅从「首行」得到草稿标题字符串（用于比对是否重复）。
 */
function titleStringFromFirstLine(firstLine: string): string {
	const t = firstLine.trim();
	const hm = t.match(/^#{1,6}\s+(.+)$/);
	if (hm) return hm[1]!.trim().slice(0, 64);
	return t.slice(0, 64);
}

/**
 * 草稿标题已单独传给微信；若正文首行与草稿标题字段一致（含无 `#` 的中文大纲标题、## 等），推送后会与标题栏重复，渲染前去掉该行。
 * 此前仅处理 `# 标题`，故「一、……」首行不会被去掉。
 */
export function stripLeadingTitleHeadingFromMarkdown(
	markdown: string,
	articleTitle: string,
): string {
	if (!articleTitle.trim()) return markdown;

	const lines = markdown.split(/\r?\n/);
	let idx = 0;
	while (idx < lines.length && lines[idx]!.trim() === "") idx++;
	if (idx >= lines.length) return markdown;

	const firstLineTitle = titleStringFromFirstLine(lines[idx]!);
	if (firstLineTitle !== articleTitle) return markdown;

	lines.splice(idx, 1);
	while (idx < lines.length && lines[idx]!.trim() === "") {
		lines.splice(idx, 1);
	}
	return lines.join("\n");
}

/** 使用花生编辑器同源内联样式渲染公众号正文 HTML */
export function markdownToWechatHtml(body: string, theme: string): string {
	return renderHuashengWechatHtml(body, normalizeWechatTheme(theme));
}

export function extractTitle(markdown: string): string {
	const first = markdown.split(/\r?\n/).find((l) => l.trim().length > 0);
	if (!first) return "未命名";
	return titleStringFromFirstLine(first);
}

export function extractDigest(markdown: string, maxLen = 120): string {
	const body = stripWechatImagePlaceholderTextForDigest(markdown);
	const text = body
		.replace(/^#+\s.*/gm, "")
		.replace(/!\[[^\]]*\]\([^)]+\)/g, "")
		.replace(/[*_`#>\[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return text.slice(0, maxLen);
}

export type PipelineMarkdownForWechatOptions = {
	/** 与 {@link stripLeadingTitleHeadingFromMarkdown} 所用标题一致；默认 {@link extractTitle}(markdown) */
	titleForStrip?: string;
};

/**
 * 与推送公众号前对正文的 Markdown 预处理一致（不含插图 URL 替换、不含 publish_gzh 元数据行）。
 * 供本地预览与单测复用，避免与 {@link publishWechat} 行为漂移。
 */
export function pipelineMarkdownForWechatRender(
	markdown: string,
	options?: PipelineMarkdownForWechatOptions,
): string {
	const title = options?.titleForStrip ?? extractTitle(markdown);
	let md = stripZeroWidthOutsideCodeBlocks(markdown);
	md = mergeParenLineAfterListItemForWechat(md);
	md = mergeFlushTailAfterListItemForWechat(md);
	md = mergeListItemContinuationsForWechat(md);
	md = collapseMarkdownListBlankLines(md);
	md = removeEmptyMarkdownListMarkerLines(md);
	md = markdownHardBreaksForWechatRender(md);
	md = stripLeadingTitleHeadingFromMarkdown(md, title);
	return md;
}

/**
 * 本地调试：与草稿箱 `content` 相同的正文 HTML 片段（已 sanitize，未做微信素材库图片 URL 替换）。
 */
export function wechatArticleHtmlForLocalPreview(
	markdown: string,
	theme: string,
	options?: PipelineMarkdownForWechatOptions,
): string {
	const body = pipelineMarkdownForWechatRender(markdown, options);
	let html = markdownToWechatHtml(body, theme);
	html = sanitizeWechatArticleHtmlForMpEditor(html);
	return html;
}
