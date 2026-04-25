/**
 * 将小红书导出的 card_*.png 同步为公众号草稿中的「图片消息」类型（newspic / 贴图多图），
 * 与长文图文（news）不同。最多 20 张图，见微信 draft/add 文档。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TFile } from "obsidian";
import type { MdToPlatformSettings } from "../settings";
import type { MdToPlatformPlugin } from "../pluginTypes";
import { getAccessToken, addMaterialImage, addDraft, type DraftNewspicArticle } from "../wechatApi";
import { tryReadPublishXhsWithFallback, readXhsContentWithFallback } from "../noteArtifacts";
import { toPlainTitleForPlatformDrafts } from "../plainTitle";
import {
	extractXhsCoverFields,
	extractXhsWechatNewspicBodyText,
} from "../xhsCardPostprocess";

let cachedToken: { token: string; exp: number } | null = null;

async function wechatAccessToken(plugin: MdToPlatformPlugin): Promise<string> {
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

function splitXhsParts(settings: MdToPlatformSettings, raw: string): string[] {
	let re: RegExp;
	try {
		const rawPat = (settings.xhsDelimiter || "").trim() || "^---\\s*$";
		const flags = rawPat.includes("g") ? "m" : "mg";
		re = new RegExp(rawPat, flags);
	} catch {
		return raw.trim() ? [raw] : [];
	}
	return raw.split(re).filter((p) => p.trim().length > 0);
}

/** 与后台常见标题上限对齐（多字节算一字） */
function sliceGzhTitle(s: string, max: number): string {
	const arr = Array.from(s);
	if (arr.length <= max) return s;
	return `${arr.slice(0, max - 1).join("")}…`;
}

function listCardPngsSorted(imagesDir: string): string[] {
	if (!fs.existsSync(imagesDir)) return [];
	const files = fs.readdirSync(imagesDir);
	const card = files.filter((f) => /^card_\d+\.png$/i.test(f));
	card.sort((a, b) => {
		const na = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
		const nb = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
		return na - nb;
	});
	return card.slice(0, 20);
}

/**
 * 上传 card_*.png 为永久图片素材，并创建 newspic 草稿。
 */
export async function pushXhsCardImagesToWechatNewspicDraft(
	plugin: MdToPlatformPlugin,
	file: TFile,
	imagesDir: string,
): Promise<{ media_id: string }> {
	const names = listCardPngsSorted(imagesDir);
	if (names.length === 0) {
		throw new Error("未找到 card_*.png，无法创建图片消息草稿");
	}

	const raw = await readXhsContentWithFallback(plugin, file);
	const parts = splitXhsParts(plugin.settings, raw);
	const firstCard = (parts[0] ?? raw).trim();

	const publishMd = await tryReadPublishXhsWithFallback(plugin, file);
	const { title } = extractXhsCoverFields(publishMd, firstCard);
	const titleWx =
		sliceGzhTitle(toPlainTitleForPlatformDrafts(title), 32) || "笔记";
	const content = extractXhsWechatNewspicBodyText(
		publishMd,
		firstCard,
	).trim() || " ";

	const access = await wechatAccessToken(plugin);
	const image_list: { image_media_id: string }[] = [];
	for (const name of names) {
		const buf = fs.readFileSync(path.join(imagesDir, name));
		const mid = await addMaterialImage(access, buf, name);
		image_list.push({ image_media_id: mid });
	}

	const article: DraftNewspicArticle = {
		article_type: "newspic",
		title: titleWx,
		content,
		image_info: { image_list },
	};
	return addDraft(access, [article]);
}
