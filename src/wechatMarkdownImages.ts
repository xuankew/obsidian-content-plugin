import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadImg } from "./wechatApi";

/** Markdown 插图：`![](file:...)` */
const MD_FILE_IMG = /!\[([^\]]*)\]\((file:[^)]+)\)/g;

function pathFromFileHref(href: string): string | null {
	try {
		return fileURLToPath(href);
	} catch {
		return null;
	}
}

/**
 * 将 Markdown 中的 `file://` 插图上传为微信素材 URL 并写回正文。
 * 须在渲染 HTML **之前**调用，避免草稿箱内仍为本地路径。
 */
export async function replaceMarkdownFileImagesWithWechatUrls(
	markdown: string,
	accessToken: string,
	onProgress?: (done: number, total: number) => void,
): Promise<string> {
	const matches = [...markdown.matchAll(new RegExp(MD_FILE_IMG.source, "g"))];
	if (matches.length === 0) return markdown;

	const uniqueHrefs = [...new Set(matches.map((m) => m[2]))];
	const hrefToWx = new Map<string, string>();
	let done = 0;
	for (const href of uniqueHrefs) {
		done++;
		onProgress?.(done, uniqueHrefs.length);
		const abs = pathFromFileHref(href);
		if (!abs || !fs.existsSync(abs)) continue;
		const buf = fs.readFileSync(abs);
		const name = path.basename(abs) || "img.png";
		const wxUrl = await uploadImg(accessToken, buf, name);
		hrefToWx.set(href, wxUrl);
	}

	let out = markdown;
	for (const [h, wx] of hrefToWx) {
		out = out.split(h).join(wx);
	}
	return out;
}

/**
 * 兜底：HTML 中若仍有 `src="file:..."`（例如经第三方渲染保留），上传并替换。
 */
export async function sweepHtmlFileImageSrcs(
	html: string,
	accessToken: string,
): Promise<string> {
	let out = html;
	const re = /src="(file:[^"]+)"/g;
	const seen = new Map<string, string>();
	let m: RegExpExecArray | null;
	const hrefs: string[] = [];
	while ((m = re.exec(html))) {
		if (!hrefs.includes(m[1])) hrefs.push(m[1]);
	}
	for (const href of hrefs) {
		const abs = pathFromFileHref(href);
		if (!abs || !fs.existsSync(abs)) continue;
		const buf = fs.readFileSync(abs);
		const wxUrl = await uploadImg(accessToken, buf, path.basename(abs) || "img.png");
		seen.set(href, wxUrl);
	}
	for (const [h, wx] of seen) {
		out = out.split(h).join(wx);
	}
	return out;
}
