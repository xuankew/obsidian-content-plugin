/**
 * 排查公众号有序列表「奇数位空项」：node 下执行
 *   npx tsx scripts/debug-wechat-list.ts
 */
import MarkdownIt from "markdown-it";
import { parseHTML } from "linkedom";

if (typeof globalThis.DOMParser === "undefined") {
	(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = class {
		parseFromString(html: string, _mime?: string) {
			const src = html.includes("<!DOCTYPE")
				? html
				: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
			return parseHTML(src).document;
		}
	} as unknown as typeof DOMParser;
}
import { preprocessHuashengMarkdown } from "../src/huasheng/renderHuashengWechat";
import {
	sanitizeWechatArticleHtmlForMpEditor,
	mergeListItemContinuationsForWechat,
	mergeParenLineAfterListItemForWechat,
	mergeFlushTailAfterListItemForWechat,
	collapseMarkdownListBlankLines,
	removeEmptyMarkdownListMarkerLines,
	markdownHardBreaksForWechatRender,
} from "../src/wechatHtml";
import { renderHuashengWechatHtml } from "../src/huasheng/renderHuashengWechat";

/** 顶格续行：merge 会缩进续行；markdown-it 常出 li 内双 p */
const sample = `冷静下来想想，吼孩子很少是因为单一事件。它常常是**几重压力叠加在一起的结果**：

1. **孩子的行为**

(磨蹭、顶嘴、犯错)：这是导火索。

2. **我们自身的状态**

(工作压力、身体疲劳、心情不佳)：这是火药库。自己累了一天，耐心早就见底了。

3. **对未来的焦虑**

(“现在就这样，以后怎么办？”)：这是助燃剂。一道题不会，可能瞬间就联想到学习跟不上。
`;

function countLis(html: string): number {
	const m = html.match(/<li\b/g);
	return m ? m.length : 0;
}

function extractOlSnippet(html: string, maxLen = 3000): string {
	const i = html.indexOf("<ol");
	if (i < 0) return "(no <ol>)";
	return html.slice(i, Math.min(i + maxLen, html.length));
}

function publishPipeline(mdIn: string): string {
	let x = mdIn;
	x = mergeParenLineAfterListItemForWechat(x);
	x = mergeFlushTailAfterListItemForWechat(x);
	x = mergeListItemContinuationsForWechat(x);
	x = collapseMarkdownListBlankLines(x);
	x = removeEmptyMarkdownListMarkerLines(x);
	x = markdownHardBreaksForWechatRender(x);
	return x;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

console.log("=== 1) preprocessHuashengMarkdown 后（前 900 字符）===\n");
const pre = preprocessHuashengMarkdown(sample);
console.log(pre.slice(0, 900));
console.log("\n=== 2) publish 管道后（前 1200 字符）===\n");
const pub = publishPipeline(pre);
console.log(pub.slice(0, 1200));

const rawHtml = md.render(pub);
console.log("\n=== 3) markdown-it 后 <li> 数量:", countLis(rawHtml));
console.log(extractOlSnippet(rawHtml));

const huasheng = renderHuashengWechatHtml(pub, "wechat-elegant");
console.log("\n=== 3b) 花生 applyHuasheng 后 <li> 数量:", countLis(huasheng));
const olPos = huasheng.indexOf("<ol");
console.log(
	olPos >= 0 ? huasheng.slice(olPos, olPos + 2200) : "(no ol in huasheng)",
);

const sanitizedFromHuasheng = sanitizeWechatArticleHtmlForMpEditor(huasheng);
console.log("\n=== 4) sanitize(花生 HTML) 后 <li> 数量:", countLis(sanitizedFromHuasheng));
const ol2 = sanitizedFromHuasheng.indexOf("<ol");
console.log(
	ol2 >= 0
		? sanitizedFromHuasheng.slice(ol2, ol2 + 2200)
		: "(no ol after sanitize)",
);

const sanitized = sanitizeWechatArticleHtmlForMpEditor(rawHtml);
console.log("\n=== 4b) sanitize(纯 md HTML) 后 <li> 数量:", countLis(sanitized));

{
	const {
		document,
	} = parseHTML(`<div id="root">${sanitizedFromHuasheng}</div>`);
	const root = document.getElementById("root");
	const lis = root?.querySelectorAll("li") ?? [];
	console.log("\n=== 逐条 <li> textContent（sanitize 花生稿）===");
	lis.forEach((li, i) => {
		const t = (li.textContent || "").replace(/\s+/g, " ").trim();
		console.log(`  [${i + 1}] len=${t.length} ${t.slice(0, 120)}`);
	});
}
