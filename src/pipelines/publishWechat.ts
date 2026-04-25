import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TFile } from "obsidian";
import { FileSystemAdapter, Notice } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import {
	ARTIFACT_PUBLISH_GZH_WITH_IMAGES,
	readPublishGzhWithFallback,
	removeSandboxWechatTmp,
	tryReadExistingPublishGzhWithImages,
	writeVaultMarkdown,
} from "../noteArtifacts";
import {
	getSessionKey,
	isWritingWorkflowLayout,
	vaultRelPublishedGzhSession,
	vaultRelSandboxSession,
} from "../workflowPaths";
import { generateImage } from "../llm";
import { getWechatCoverColors, renderWechatCoverThumbPng } from "../wechatCoverThumb";
import { getSessionCacheDir, ensureDir, hashString, writeFileUtf8 } from "../cache";
import {
	markdownToWechatHtml,
	extractTitle,
	extractDigest,
	sanitizeWechatArticleHtmlForMpEditor,
	pipelineMarkdownForWechatRender,
	stripGzhTitleCandidatePreamble,
} from "../wechatHtml";
import {
	getAccessToken,
	addMaterialThumb,
	addDraft,
} from "../wechatApi";
import {
	replaceMarkdownFileImagesWithWechatUrls,
	sweepHtmlFileImageSrcs,
} from "../wechatMarkdownImages";
import { createPipelineProgressOverlay } from "../ui/pipelineProgress";
import { findAllWechatImagePlaceholders } from "../wechatImagePlaceholders";

/** 首行元数据：与 publish_gzh 源文 hash 一致时可跳过生图 */
const MDTP_GZH_SRC_LINE = /^<!--\s*mdtp:src\s+([a-f0-9]+)\s*-->\s*\r?\n?/;

function splitGzhWithImagesStored(full: string): { metaHash: string | null; body: string } {
	const m = full.match(MDTP_GZH_SRC_LINE);
	if (!m) return { metaHash: null, body: full };
	return { metaHash: m[1] ?? null, body: full.slice(m[0].length) };
}

function stripGzhWithImagesMeta(full: string): string {
	return splitGzhWithImagesStored(full).body;
}

function verifyMarkdownLocalImagesExist(mdBody: string): boolean {
	const re = /!\[[^\]]*\]\((file:[^)]+)\)/g;
	let found = false;
	let mm: RegExpExecArray | null;
	while ((mm = re.exec(mdBody))) {
		found = true;
		try {
			const pth = fileURLToPath(mm[1]);
			if (!fs.existsSync(pth)) return false;
		} catch {
			return false;
		}
	}
	return found;
}

function loadFirstThumbBuffer(imgDir: string, mdBody: string): Buffer | null {
	const p0 = path.join(imgDir, "img_0.png");
	if (fs.existsSync(p0)) return fs.readFileSync(p0);
	const m = mdBody.match(/!\[[^\]]*\]\((file:[^)]+)\)/);
	if (!m) return null;
	try {
		const pth = fileURLToPath(m[1]);
		if (fs.existsSync(pth)) return fs.readFileSync(pth);
	} catch {
		return null;
	}
	return null;
}

let cachedToken: { token: string; exp: number } | null = null;

async function token(plugin: MdToPlatformPlugin): Promise<string> {
	const { wechatAppId, wechatAppSecret } = plugin.settings;
	if (!wechatAppId || !wechatAppSecret) {
		throw new Error("请填写公众号 AppID 与 AppSecret");
	}
	const now = Date.now();
	if (cachedToken && cachedToken.exp > now + 60_000) {
		return cachedToken.token;
	}
	const t = await getAccessToken(wechatAppId, wechatAppSecret);
	cachedToken = { token: t, exp: now + 7000_000 };
	return t;
}

export async function runPublishWechatPipeline(
	plugin: MdToPlatformPlugin,
	file: TFile,
): Promise<void> {
	const progress = createPipelineProgressOverlay("MDTP 公众号草稿");
	try {
		progress.setPhase("正在读取 publish_gzh.md…", 0.06, false);
		const src = await readPublishGzhWithFallback(plugin, file);
		const srcHash = hashString(src);
		const cacheDir = (() => {
			if (!isWritingWorkflowLayout(plugin.settings)) {
				return getSessionCacheDir(plugin, file.path);
			}
			const adapter = plugin.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) {
				return getSessionCacheDir(plugin, file.path);
			}
			const rel = vaultRelSandboxSession(plugin.settings, getSessionKey(file));
			return adapter.getFullPath(rel);
		})();
		const imgDir = path.join(cacheDir, "wechat_images");
		ensureDir(imgDir);

		const placeholderMatches = findAllWechatImagePlaceholders(src);
		const totalPh = placeholderMatches.length;

		let mdOut: string;
		let firstThumbBuf: Buffer | null = null;
		let reusedImages = false;

		const existingFull = await tryReadExistingPublishGzhWithImages(plugin, file, cacheDir);
		if (existingFull) {
			const { metaHash, body } = splitGzhWithImagesStored(existingFull);
			const phInBody = findAllWechatImagePlaceholders(body).length > 0;
			const hashMatch = metaHash !== null && metaHash === srcHash;
			const imagesOk = !phInBody && verifyMarkdownLocalImagesExist(body);
			if (imagesOk && (hashMatch || metaHash === null)) {
				const thumb = loadFirstThumbBuffer(imgDir, body);
				if (thumb) {
					reusedImages = true;
					firstThumbBuf = thumb;
					mdOut = hashMatch ? existingFull : `<!-- mdtp:src ${srcHash} -->\n${body}`;
					progress.setPhase(
						hashMatch
							? "publish_gzh 未变且带图稿可用，跳过 CogView 生图…"
							: "检测到本地带图稿与插图文件，跳过 CogView 生图…",
						0.38,
						false,
					);
				}
			}
		}

		if (!reusedImages) {
			if (totalPh === 0) {
				progress.setPhase("未检测到插图占位，跳过生图，直接走排版与发布…", 0.28, false);
				mdOut = `<!-- mdtp:src ${srcHash} -->\n${src}`;
			} else {
				const asc = [...placeholderMatches].sort(
					(a, b) => a.start - b.start,
				);
				const mdImgChunks: string[] = [];
				for (let pi = 0; pi < asc.length; pi++) {
					const m = asc[pi]!;
					progress.setPhase(
						`正在生成第 ${pi + 1}/${totalPh} 处插图…`,
						0.1 + (0.42 * (pi + 1)) / totalPh,
						true,
					);
					const buf = await generateImage(
						plugin.settings,
						m.prompt,
						"wechatArticle",
					);
					if (!firstThumbBuf) {
						firstThumbBuf = buf;
					}
					const fname = `img_${pi}.png`;
					const abs = path.join(imgDir, fname);
					fs.writeFileSync(abs, buf);
					const fileUrl = pathToFileURL(abs).href;
					const escAlt = m.desc.replace(/[\[\]]/g, "");
					mdImgChunks.push(
						escAlt.length > 0
							? `![${escAlt}](${fileUrl})`
							: `![插图](${fileUrl})`,
					);
				}
				let mdGen = src;
				for (let i = asc.length - 1; i >= 0; i--) {
					const m = asc[i]!;
					const rep = mdImgChunks[i]!;
					mdGen = mdGen.slice(0, m.start) + rep + mdGen.slice(m.end);
				}
				mdOut = `<!-- mdtp:src ${srcHash} -->\n${mdGen}`;
			}
		}

		progress.setPhase("正在写入带图 Markdown 与 HTML…", 0.58, false);
		writeFileUtf8(path.join(cacheDir, ARTIFACT_PUBLISH_GZH_WITH_IMAGES), mdOut);
		if (isWritingWorkflowLayout(plugin.settings)) {
			const pubRel = `${vaultRelPublishedGzhSession(
				plugin.settings,
				getSessionKey(file),
			)}/${ARTIFACT_PUBLISH_GZH_WITH_IMAGES}`;
			await writeVaultMarkdown(plugin.app.vault, pubRel, mdOut);
		}

		const mdStrip = stripGzhWithImagesMeta(mdOut);

		progress.setPhase("正在获取 access_token…", 0.62, true);
		const tok = await token(plugin);

		progress.setPhase("正在上传正文插图到微信素材库（并替换为线上链接）…", 0.66, true);
		const mdWithWxImages = await replaceMarkdownFileImagesWithWechatUrls(
			mdStrip,
			tok,
			(done, total) => {
				progress.setPhase(
					`上传插图到微信 ${done}/${total}…`,
					0.66 + (0.12 * done) / Math.max(total, 1),
					true,
				);
			},
		);

		const draftTitle = extractTitle(mdStrip);
		const mdForDigest = stripGzhTitleCandidatePreamble(mdWithWxImages);

		let mdForRender = pipelineMarkdownForWechatRender(mdWithWxImages, {
			titleForStrip: draftTitle,
		});

		progress.setPhase("正在渲染公众号 HTML（花生排版）…", 0.78, true);
		let htmlOut = markdownToWechatHtml(mdForRender, plugin.settings.wechatTheme);

		htmlOut = sanitizeWechatArticleHtmlForMpEditor(htmlOut);
		htmlOut = await sweepHtmlFileImageSrcs(htmlOut, tok);
		writeFileUtf8(path.join(cacheDir, "wechat_article.html"), htmlOut);

		const title = draftTitle;
		const digest = extractDigest(mdForDigest);

		let thumbBytes: Buffer;
		if (plugin.settings.wechatThumbSource === "titleCard") {
			progress.setPhase("正在生成纯色标题封面…", 0.86, true);
			const { bg, text } = getWechatCoverColors(plugin.settings.wechatCoverBgPreset);
			thumbBytes = await renderWechatCoverThumbPng(title, {
				backgroundColor: bg,
				textColor: text,
				fontSizePx: plugin.settings.wechatCoverTitleFontPx,
			});
		} else if (firstThumbBuf) {
			thumbBytes = firstThumbBuf;
		} else {
			new Notice(
				"未生成正文插图：已改用语义标题色卡作为草稿封面（可在设置中固定为「纯色标题卡」）。",
				10000,
			);
			progress.setPhase("无首张插图，改用语义标题封面…", 0.86, true);
			const { bg, text } = getWechatCoverColors(plugin.settings.wechatCoverBgPreset);
			thumbBytes = await renderWechatCoverThumbPng(title, {
				backgroundColor: bg,
				textColor: text,
				fontSizePx: plugin.settings.wechatCoverTitleFontPx,
			});
		}

		progress.setPhase("正在上传封面缩略图…", 0.88, true);
		const thumbId = await addMaterialThumb(tok, thumbBytes, "thumb.png");

		progress.setPhase("正在创建公众号草稿…", 0.94, true);
		await addDraft(tok, [
			{
				title,
				author: "",
				digest,
				content: htmlOut,
				thumb_media_id: thumbId,
			},
		]);

		progress.setPhase("已推送到草稿箱", 1, false);
		await new Promise((r) => setTimeout(r, 420));
	} finally {
		progress.close();
	}

	new Notice("已推送到公众号草稿箱");
	await removeSandboxWechatTmp(plugin, file);
}
