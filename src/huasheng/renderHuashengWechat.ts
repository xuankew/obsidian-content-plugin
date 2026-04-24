import MarkdownIt from "markdown-it";
import { applyHuashengInlineStyles } from "./applyHuashengDom";
import { patchMarkdownScannerForHuasheng } from "./markdownItPatch";

/** 与 huasheng_editor 一致的 Markdown 预处理（分隔线、加粗、列表等） */
export function preprocessHuashengMarkdown(content: string): string {
	let c = content;
	c = c.replace(/^[ ]{0,3}(\*[ ]*\*[ ]*\*[\* ]*)[ \t]*$/gm, "***");
	c = c.replace(/^[ ]{0,3}(-[ ]*-[ ]*-[- ]*)[ \t]*$/gm, "---");
	c = c.replace(/^[ ]{0,3}(_[ ]*_[ ]*_[_ ]*)[ \t]*$/gm, "___");
	c = c.replace(/\*\*\s+\*\*/g, " ");
	c = c.replace(/\*{4,}/g, "");
	c = c.replace(/\*\*([）」』》〉】〕〗］｝"'。，、；：？！])/g, "**\u200B$1");
	c = c.replace(/([（「『《〈【〔〖［｛"'])\*\*/g, "$1\u200B**");
	c = c.replace(/__\s+__/g, " ");
	c = c.replace(/_{4,}/g, "");
	c = c.replace(/^(\s*(?:\d+\.|-|\*)\s+[^:\n]+)\n\s*:\s*(.+?)$/gm, "$1: $2");
	c = c.replace(/^(\s*(?:\d+\.|-|\*)\s+.+?:)\s*\n\s+(.+?)$/gm, "$1 $2");
	c = c.replace(/^(\s*(?:\d+\.|-|\*)\s+[^:\n]+)\n:\s*(.+?)$/gm, "$1: $2");
	// 松散列表：合并「列表行 + 空行 + 续行」为同一列表项。第二行若以新列表标记开头则不可合并，否则会粘成一行、编号错乱。
	c = c.replace(
		/^(\s*(?:\d+\.|-|\*)\s+.+?)\n\n(\s+.+)$/gm,
		(match, g1: string, g2: string) => {
			const rest = g2.replace(/^\s+/, "");
			if (/^(?:\d+\.|-|\*)\s/.test(rest)) return match;
			return `${g1} ${rest}`;
		},
	);
	return c;
}

let mdSingleton: MarkdownIt | null = null;

function getMarkdownIt(): MarkdownIt {
	if (mdSingleton) return mdSingleton;
	mdSingleton = new MarkdownIt({
		html: false,
		linkify: true,
		/** 关闭「单换行变 br」，减少列表项内幽灵换行；普通段落硬换行仍由 publish 前对非列表块注入的行末两空格承担 */
		breaks: false,
		typographer: false,
		/** 公众号内无法加载 hljs 样式表，仅做转义；由主题 pre/code 内联样式控制外观 */
		highlight: (str) => mdSingleton!.utils.escapeHtml(str),
	});
	// markdown-it 默认 validateLink 禁止 file:，导致 vault 内 ![](/path) 与 file:// 无法生成 <img>，预览与编辑态只见原文
	const baseValidateLink = mdSingleton.validateLink.bind(mdSingleton);
	mdSingleton.validateLink = (url: string) => {
		if (/^file:/i.test(url.trim())) return true;
		return baseValidateLink(url);
	};
	patchMarkdownScannerForHuasheng(mdSingleton);
	return mdSingleton;
}

/**
 * 使用花生编辑器同源样式（内联 CSS + 多图 table 布局）将 Markdown 转为公众号可用 HTML。
 */
export function renderHuashengWechatHtml(markdown: string, huashengStyleKey: string): string {
	const md = getMarkdownIt();
	const processed = preprocessHuashengMarkdown(markdown);
	const html = md.render(processed);
	return applyHuashengInlineStyles(html, huashengStyleKey);
}
