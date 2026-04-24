/**
 * 复现用户提供的原文经完整管道后的 HTML（node + linkedom DOMParser shim）
 * npx esbuild scripts/repro-user-md.ts --bundle --platform=node --packages=external --outfile=scripts/repro-user-md.cjs --format=cjs && node scripts/repro-user-md.cjs
 */
import { parseHTML } from "linkedom";
import MarkdownIt from "markdown-it";
import { preprocessHuashengMarkdown, renderHuashengWechatHtml } from "../src/huasheng/renderHuashengWechat";
import {
	mergeParenLineAfterListItemForWechat,
	mergeFlushTailAfterListItemForWechat,
	mergeListItemContinuationsForWechat,
	collapseMarkdownListBlankLines,
	removeEmptyMarkdownListMarkerLines,
	markdownHardBreaksForWechatRender,
	sanitizeWechatArticleHtmlForMpEditor,
	stripZeroWidthOutsideCodeBlocks,
} from "../src/wechatHtml";

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

const userMd = `冷静下来想想，吼孩子很少是因为单一事件。它常常是**几重压力叠在一起的结果**：

1.  **孩子的行为**（磨蹭、顶嘴、犯错）：这是导火索。
2.  **我们自身的状态**（工作压力、身体疲劳、心情不佳）：这是火药库。自己累了一天，耐心早就见底了。
3.  **对未来的焦虑**（"现在就这样，以后怎么办？"）：这是助燃剂。一道题不会，可能瞬间就联想到学习跟不上、考不好、将来怎么办……这种越想越远的担心，会让火气一下子冒得老高。

不是随便喘两口气，而是有节奏的腹式呼吸。我常用的方法是Andrew Weil博士推荐的"4-7-8"呼吸法：
*   **用鼻子慢慢吸气，心里默数4秒。**
*   **屏住呼吸，默数7秒。**
*   **用嘴巴缓缓呼气，可以轻轻发出"呼"的声音，默数8秒。**
`;

function publishPipe(md: string): string {
	let x = stripZeroWidthOutsideCodeBlocks(md);
	x = mergeParenLineAfterListItemForWechat(x);
	x = mergeFlushTailAfterListItemForWechat(x);
	x = mergeListItemContinuationsForWechat(x);
	x = collapseMarkdownListBlankLines(x);
	x = removeEmptyMarkdownListMarkerLines(x);
	x = markdownHardBreaksForWechatRender(x);
	return x;
}

const pub = publishPipe(userMd);
console.log("=== publish 管道后 Markdown ===\n");
console.log(pub);
console.log("\n=== preprocessHuasheng 后（节选）===\n");
console.log(preprocessHuashengMarkdown(pub).slice(0, 1200));

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
const raw = md.render(pub);
console.log("\n=== 仅 markdown-it（无花生）ol/ul ===\n");
console.log(raw);

const full = renderHuashengWechatHtml(pub, "wechat-elegant");
const clean = sanitizeWechatArticleHtmlForMpEditor(full);
console.log("\n=== sanitize 后（节选 ol+ul）===\n");
const iol = clean.indexOf("<ol");
const iul = clean.indexOf("<ul");
const slice = (i: number) => (i >= 0 ? clean.slice(i, i + 3500) : "(none)");
console.log(slice(Math.min(iol >= 0 ? iol : 99999, iul >= 0 ? iul : 99999)));

console.log("\n=== li 计数 ===");
console.log("<li> count:", (clean.match(/<li\b/g) || []).length);
