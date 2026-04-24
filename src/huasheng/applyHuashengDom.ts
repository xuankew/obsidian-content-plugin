import { HUASHENG_STYLES } from "./stylesData";

type StyleMap = Record<string, string>;

const HEADING_INLINE_OVERRIDES: Record<string, string> = {
	strong:
		"font-weight: 700; color: inherit !important; background-color: transparent !important;",
	em: "font-style: italic; color: inherit !important; background-color: transparent !important;",
	a: "color: inherit !important; text-decoration: none !important; border-bottom: 1px solid currentColor !important; background-color: transparent !important;",
	code: "color: inherit !important; background-color: transparent !important; border: none !important; padding: 0 !important;",
	span: "color: inherit !important; background-color: transparent !important;",
	b: "font-weight: 700; color: inherit !important; background-color: transparent !important;",
	i: "font-style: italic; color: inherit !important; background-color: transparent !important;",
	del: "color: inherit !important; background-color: transparent !important;",
	mark: "color: inherit !important; background-color: transparent !important;",
	s: "color: inherit !important; background-color: transparent !important;",
	u: "color: inherit !important; text-decoration: underline !important; background-color: transparent !important;",
	ins: "color: inherit !important; text-decoration: underline !important; background-color: transparent !important;",
	kbd: "color: inherit !important; background-color: transparent !important; border: none !important; padding: 0 !important;",
	sub: "color: inherit !important; background-color: transparent !important;",
	sup: "color: inherit !important; background-color: transparent !important;",
};

function groupConsecutiveImages(doc: Document): void {
	const body = doc.body;
	const children = Array.from(body.children);

	type ImgItem = {
		element: Element;
		img: Element;
		index: number;
		inSameParagraph: boolean;
		paragraphImageCount: number;
	};

	const imagesToProcess: ImgItem[] = [];

	children.forEach((child, index) => {
		if (child.tagName === "P") {
			const images = child.querySelectorAll("img");
			if (images.length > 0) {
				if (images.length > 1) {
					imagesToProcess.push(
						...Array.from(images).map((img) => ({
							element: child,
							img,
							index,
							inSameParagraph: true,
							paragraphImageCount: images.length,
						})),
					);
				} else {
					imagesToProcess.push({
						element: child,
						img: images[0]!,
						index,
						inSameParagraph: false,
						paragraphImageCount: 1,
					});
				}
			}
		} else if (child.tagName === "IMG") {
			imagesToProcess.push({
				element: child,
				img: child,
				index,
				inSameParagraph: false,
				paragraphImageCount: 1,
			});
		}
	});

	const groups: ImgItem[][] = [];
	let currentGroup: ImgItem[] = [];

	imagesToProcess.forEach((item, i) => {
		if (i === 0) {
			currentGroup.push(item);
		} else {
			const prevItem = imagesToProcess[i - 1]!;
			let isContinuous = false;
			if (item.index === prevItem.index) {
				isContinuous = true;
			} else if (item.index - prevItem.index === 1) {
				isContinuous = true;
			}
			if (isContinuous) {
				currentGroup.push(item);
			} else {
				if (currentGroup.length > 0) groups.push([...currentGroup]);
				currentGroup = [item];
			}
		}
	});
	if (currentGroup.length > 0) groups.push(currentGroup);

	groups.forEach((group) => {
		if (group.length < 2) return;
		const imageCount = group.length;
		const firstElement = group[0]!.element;
		const gridContainer = doc.createElement("div");
		gridContainer.setAttribute("class", "image-grid");
		gridContainer.setAttribute("data-image-count", String(imageCount));

		let gridStyle = "";
		let columns = 2;
		if (imageCount === 2) {
			gridStyle = `
display: grid;
grid-template-columns: 1fr 1fr;
gap: 8px;
margin: 20px auto;
max-width: 100%;
align-items: start;
`.trim();
			columns = 2;
		} else if (imageCount === 3) {
			gridStyle = `
display: grid;
grid-template-columns: repeat(3, 1fr);
gap: 8px;
margin: 20px auto;
max-width: 100%;
align-items: start;
`.trim();
			columns = 3;
		} else if (imageCount === 4) {
			gridStyle = `
display: grid;
grid-template-columns: 1fr 1fr;
gap: 8px;
margin: 20px auto;
max-width: 100%;
align-items: start;
`.trim();
			columns = 2;
		} else {
			gridStyle = `
display: grid;
grid-template-columns: repeat(3, 1fr);
gap: 8px;
margin: 20px auto;
max-width: 100%;
align-items: start;
`.trim();
			columns = 3;
		}
		gridContainer.setAttribute("style", gridStyle);
		gridContainer.setAttribute("data-columns", String(columns));

		group.forEach((item) => {
			const imgWrapper = doc.createElement("div");
			imgWrapper.setAttribute(
				"style",
				`
width: 100%;
height: auto;
overflow: hidden;
`.trim(),
			);
			const img = item.img.cloneNode(true) as HTMLImageElement;
			img.setAttribute(
				"style",
				`
width: 100%;
height: auto;
display: block;
border-radius: 8px;
`.trim(),
			);
			imgWrapper.appendChild(img);
			gridContainer.appendChild(imgWrapper);
		});

		firstElement.parentNode!.insertBefore(gridContainer, firstElement);
		const elementsToRemove = new Set<Element>();
		group.forEach((item) => {
			elementsToRemove.add(item.element);
		});
		elementsToRemove.forEach((element) => {
			element.parentNode?.removeChild(element);
		});
	});
}

function convertToTable(doc: Document, grid: Element, columns: number): void {
	const imgWrappers = Array.from(grid.children);
	const table = doc.createElement("table");
	table.setAttribute(
		"style",
		`
width: 100% !important;
border-collapse: collapse !important;
margin: 20px auto !important;
table-layout: fixed !important;
border: none !important;
background: transparent !important;
`.trim(),
	);

	const rows = Math.ceil(imgWrappers.length / columns);
	for (let i = 0; i < rows; i++) {
		const tr = doc.createElement("tr");
		for (let j = 0; j < columns; j++) {
			const index = i * columns + j;
			const td = doc.createElement("td");
			td.setAttribute(
				"style",
				`
padding: 4px !important;
vertical-align: top !important;
width: ${100 / columns}% !important;
border: none !important;
background: transparent !important;
`.trim(),
			);
			if (index < imgWrappers.length) {
				const imgWrapper = imgWrappers[index]!;
				const img = imgWrapper.querySelector("img");
				if (img) {
					let imgMaxHeight: string;
					let containerHeight: string;
					if (columns === 2) {
						imgMaxHeight = "340px";
						containerHeight = "360px";
					} else if (columns === 3) {
						imgMaxHeight = "340px";
						containerHeight = "360px";
					} else {
						imgMaxHeight = "340px";
						containerHeight = "360px";
					}
					const wrapper = doc.createElement("div");
					wrapper.setAttribute(
						"style",
						`
width: 100% !important;
height: ${containerHeight} !important;
text-align: center !important;
background-color: #f5f5f5 !important;
border-radius: 4px !important;
padding: 10px !important;
box-sizing: border-box !important;
overflow: hidden !important;
display: table !important;
`.trim(),
					);
					const innerWrapper = doc.createElement("div");
					innerWrapper.setAttribute(
						"style",
						`
display: table-cell !important;
vertical-align: middle !important;
text-align: center !important;
`.trim(),
					);
					const newImg = img.cloneNode(true) as HTMLImageElement;
					newImg.setAttribute(
						"style",
						`
max-width: calc(100% - 20px) !important;
max-height: ${imgMaxHeight} !important;
width: auto !important;
height: auto !important;
display: inline-block !important;
margin: 0 auto !important;
border-radius: 4px !important;
object-fit: contain !important;
`.trim(),
					);
					innerWrapper.appendChild(newImg);
					wrapper.appendChild(innerWrapper);
					td.appendChild(wrapper);
				}
			}
			tr.appendChild(td);
		}
		table.appendChild(tr);
	}
	grid.parentNode!.replaceChild(table, grid);
}

function convertGridToTableInDoc(doc: Document): void {
	doc.querySelectorAll(".image-grid").forEach((grid) => {
		const columns = parseInt(grid.getAttribute("data-columns") || "2", 10) || 2;
		convertToTable(doc, grid, columns);
	});
}

function mergeStyle(el: Element, extra: string): void {
	const cur = el.getAttribute("style") || "";
	el.setAttribute("style", `${cur}; ${extra}`);
}

/** 花生编辑器同源：Markdown HTML + 主题 → 全内联样式；多图网格并转为 table 以兼容公众号 */
export function applyHuashengInlineStyles(html: string, styleKey: string): string {
	const cfg = HUASHENG_STYLES[styleKey];
	if (!cfg) {
		throw new Error(`未知公众号排版主题：${styleKey}`);
	}
	const style = cfg.styles as StyleMap;
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");

	groupConsecutiveImages(doc);

	Object.keys(style).forEach((selector) => {
		if (selector === "pre" || selector === "code" || selector === "pre code") return;
		const css = style[selector];
		if (!css) return;
		doc.querySelectorAll(selector).forEach((el) => {
			if (el.tagName === "IMG" && el.closest(".image-grid")) return;
			mergeStyle(el, css);
		});
	});

	const preCss = style.pre;
	const codeCss = style.code;
	if (preCss) {
		doc.querySelectorAll("pre").forEach((el) => mergeStyle(el, preCss));
	}
	if (codeCss) {
		doc.querySelectorAll("pre code").forEach((el) => mergeStyle(el, codeCss));
		doc.querySelectorAll("code").forEach((el) => {
			if (el.closest("pre")) return;
			mergeStyle(el, codeCss);
		});
	}

	const headingInlineSelectorList = Object.keys(HEADING_INLINE_OVERRIDES).join(", ");
	doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
		heading.querySelectorAll(headingInlineSelectorList).forEach((node) => {
			const tag = node.tagName.toLowerCase();
			const override = HEADING_INLINE_OVERRIDES[tag];
			if (!override) return;
			const currentStyle = node.getAttribute("style") || "";
			const sanitizedStyle = currentStyle
				.replace(/color:\s*[^;]+;?/gi, "")
				.replace(/background(?:-color)?:\s*[^;]+;?/gi, "")
				.replace(/border(?:-bottom)?:\s*[^;]+;?/gi, "")
				.replace(/text-decoration:\s*[^;]+;?/gi, "")
				.replace(/box-shadow:\s*[^;]+;?/gi, "")
				.replace(/padding:\s*[^;]+;?/gi, "")
				.replace(/;\s*;/g, ";")
				.trim();
			node.setAttribute("style", `${sanitizedStyle}; ${override}`);
		});
	});

	convertGridToTableInDoc(doc);

	const container = doc.createElement("div");
	container.setAttribute("style", style.container!);
	container.innerHTML = doc.body.innerHTML;
	return container.outerHTML;
}
