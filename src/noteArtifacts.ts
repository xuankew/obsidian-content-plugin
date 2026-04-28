import * as fs from "node:fs";
import * as path from "node:path";
import {
	FileSystemAdapter,
	normalizePath,
	type Vault,
	TFile,
} from "obsidian";
import type { MdToPlatformSettings } from "./settings";
import type { MdToPlatformPlugin } from "./pluginTypes";
import { getSessionCacheDir, readFileUtf8 } from "./cache";
import {
	getEffectiveWorkflowPathParts,
	getSessionKey,
	isWritingWorkflowLayout,
	vaultRelPublishedGzhSession,
	vaultRelPublishedVideoSession,
	vaultRelPublishedXhsSession,
	vaultRelSandboxSession,
} from "./workflowPaths";

/** 与当前笔记同目录的扩写产物文件名（固定） */
export const ARTIFACT_PUBLISH_GZH = "publish_gzh.md";
export const ARTIFACT_PUBLISH_GZH_WITH_IMAGES = "publish_gzh_with_images.md";
export const ARTIFACT_XHS_CONTENT = "xhs_content.md";
export const ARTIFACT_PUBLISH_XHS = "publish_xhs.md";
export const ARTIFACT_VIDEO_SCRIPT = "video_script.md";
export const ARTIFACT_VIDEO_CONFIG = "video_config.json";

/**
 * 读取已存在的带图公众号稿：优先 Sandbox/缓存工作目录，再 Published，再笔记同目录。
 * 用于跳过重复 CogView 生图。
 */
export async function tryReadExistingPublishGzhWithImages(
	plugin: MdToPlatformPlugin,
	note: TFile,
	cacheDirAbs: string,
): Promise<string | null> {
	const disk = readFileUtf8(
		path.join(cacheDirAbs, ARTIFACT_PUBLISH_GZH_WITH_IMAGES),
	);
	if (disk != null && disk.trim().length > 0) return disk;
	if (isWritingWorkflowLayout(plugin.settings)) {
		const key = getSessionKey(note);
		const vp = normalizePath(
			`${vaultRelPublishedGzhSession(plugin.settings, key)}/${ARTIFACT_PUBLISH_GZH_WITH_IMAGES}`,
		);
		const f = plugin.app.vault.getAbstractFileByPath(vp);
		if (f instanceof TFile) {
			const t = await plugin.app.vault.read(f);
			if (t.trim().length > 0) return t;
		}
	}
	const sib = await readSiblingIfExists(
		plugin.app.vault,
		note,
		ARTIFACT_PUBLISH_GZH_WITH_IMAGES,
	);
	return sib != null && sib.trim().length > 0 ? sib : null;
}

/** 当前笔记同目录下的 Obsidian 库内路径 */
export function siblingVaultPath(note: TFile, basename: string): string {
	const parent = note.parent?.path;
	if (parent == null || parent === "") {
		return normalizePath(basename);
	}
	return normalizePath(`${parent}/${basename}`);
}

export async function ensureVaultFolder(vault: Vault, vaultRelPath: string): Promise<void> {
	const norm = normalizePath(vaultRelPath);
	if (!norm || norm === ".") return;
	const parts = norm.split("/");
	let cur = "";
	for (const p of parts) {
		if (!p) continue;
		cur = cur ? normalizePath(`${cur}/${p}`) : p;
		const existing = vault.getAbstractFileByPath(cur);
		if (!existing) {
			await vault.createFolder(cur);
		}
	}
}

export async function writeVaultMarkdown(
	vault: Vault,
	vaultPath: string,
	content: string,
): Promise<void> {
	const norm = normalizePath(vaultPath);
	const lastSlash = norm.lastIndexOf("/");
	const parent = lastSlash > 0 ? norm.slice(0, lastSlash) : "";
	if (parent) await ensureVaultFolder(vault, parent);
	const existing = vault.getAbstractFileByPath(norm);
	if (existing instanceof TFile) {
		await vault.modify(existing, content);
	} else {
		await vault.create(norm, content);
	}
}

export async function writeSiblingMarkdown(
	vault: Vault,
	note: TFile,
	basename: string,
	content: string,
): Promise<string> {
	const p = siblingVaultPath(note, basename);
	await writeVaultMarkdown(vault, p, content);
	return p;
}

export async function readSiblingIfExists(
	vault: Vault,
	note: TFile,
	basename: string,
): Promise<string | null> {
	const p = siblingVaultPath(note, basename);
	const f = vault.getAbstractFileByPath(p);
	if (f instanceof TFile) return vault.read(f);
	return null;
}

/** 扩写：终稿写入 03-Published/gzh|xhs，同时在 02-Sanbox 下保留一份 tmp。 */
export async function writeExpandOutputs(
	plugin: MdToPlatformPlugin,
	note: TFile,
	publishGzh: string,
	publishXhs: string,
	xhsContent: string,
): Promise<void> {
	const vault = plugin.app.vault;
	const s = plugin.settings;
	if (!isWritingWorkflowLayout(s)) {
		await writeSiblingMarkdown(vault, note, ARTIFACT_PUBLISH_GZH, publishGzh);
		await writeSiblingMarkdown(vault, note, ARTIFACT_PUBLISH_XHS, publishXhs);
		await writeSiblingMarkdown(vault, note, ARTIFACT_XHS_CONTENT, xhsContent);
		return;
	}
	const key = getSessionKey(note);
	const sand = vaultRelSandboxSession(s, key);
	const pgzh = vaultRelPublishedGzhSession(s, key);
	const pxhs = vaultRelPublishedXhsSession(s, key);
	await writeVaultMarkdown(vault, normalizePath(`${sand}/${ARTIFACT_PUBLISH_GZH}`), publishGzh);
	await writeVaultMarkdown(vault, normalizePath(`${sand}/${ARTIFACT_PUBLISH_XHS}`), publishXhs);
	await writeVaultMarkdown(vault, normalizePath(`${sand}/${ARTIFACT_XHS_CONTENT}`), xhsContent);
	await writeVaultMarkdown(vault, normalizePath(`${pgzh}/${ARTIFACT_PUBLISH_GZH}`), publishGzh);
	await writeVaultMarkdown(vault, normalizePath(`${pxhs}/${ARTIFACT_PUBLISH_XHS}`), publishXhs);
	await writeVaultMarkdown(vault, normalizePath(`${pxhs}/${ARTIFACT_XHS_CONTENT}`), xhsContent);
}

/** 扩写阶段：视频脚本 Markdown + 机器可读 JSON（与 gzh/xhs 同会话键） */
export async function writeVideoExpandOutputs(
	plugin: MdToPlatformPlugin,
	note: TFile,
	videoScriptMd: string,
	videoConfigJson: string,
): Promise<void> {
	const vault = plugin.app.vault;
	const s = plugin.settings;
	if (!isWritingWorkflowLayout(s)) {
		await writeSiblingMarkdown(vault, note, ARTIFACT_VIDEO_SCRIPT, videoScriptMd);
		await writeSiblingMarkdown(vault, note, ARTIFACT_VIDEO_CONFIG, videoConfigJson);
		return;
	}
	const key = getSessionKey(note);
	const sand = vaultRelSandboxSession(s, key);
	const pvid = vaultRelPublishedVideoSession(s, key);
	await writeVaultMarkdown(
		vault,
		normalizePath(`${sand}/${ARTIFACT_VIDEO_SCRIPT}`),
		videoScriptMd,
	);
	await writeVaultMarkdown(
		vault,
		normalizePath(`${sand}/${ARTIFACT_VIDEO_CONFIG}`),
		videoConfigJson,
	);
	await writeVaultMarkdown(
		vault,
		normalizePath(`${pvid}/${ARTIFACT_VIDEO_SCRIPT}`),
		videoScriptMd,
	);
	await writeVaultMarkdown(
		vault,
		normalizePath(`${pvid}/${ARTIFACT_VIDEO_CONFIG}`),
		videoConfigJson,
	);
}

/** 公众号→小红书：仅更新小红书相关 md（终稿 + Sandbox tmp）。 */
export async function writeWorkflowXhsPair(
	plugin: MdToPlatformPlugin,
	note: TFile,
	publishXhs: string,
	xhsContent: string,
): Promise<void> {
	const vault = plugin.app.vault;
	const s = plugin.settings;
	if (!isWritingWorkflowLayout(s)) {
		await writeSiblingMarkdown(vault, note, ARTIFACT_PUBLISH_XHS, publishXhs);
		await writeSiblingMarkdown(vault, note, ARTIFACT_XHS_CONTENT, xhsContent);
		return;
	}
	const key = getSessionKey(note);
	const sand = vaultRelSandboxSession(s, key);
	const pxhs = vaultRelPublishedXhsSession(s, key);
	await writeVaultMarkdown(vault, normalizePath(`${sand}/${ARTIFACT_PUBLISH_XHS}`), publishXhs);
	await writeVaultMarkdown(vault, normalizePath(`${sand}/${ARTIFACT_XHS_CONTENT}`), xhsContent);
	await writeVaultMarkdown(vault, normalizePath(`${pxhs}/${ARTIFACT_PUBLISH_XHS}`), publishXhs);
	await writeVaultMarkdown(vault, normalizePath(`${pxhs}/${ARTIFACT_XHS_CONTENT}`), xhsContent);
}

async function readWorkflowPublishGzh(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<string | null> {
	if (!isWritingWorkflowLayout(plugin.settings)) return null;
	const key = getSessionKey(note);
	const s = plugin.settings;
	const vault = plugin.app.vault;
	const paths = [
		normalizePath(`${vaultRelPublishedGzhSession(s, key)}/${ARTIFACT_PUBLISH_GZH}`),
		normalizePath(`${vaultRelSandboxSession(s, key)}/${ARTIFACT_PUBLISH_GZH}`),
	];
	for (const p of paths) {
		const f = vault.getAbstractFileByPath(p);
		if (f instanceof TFile) return vault.read(f);
	}
	return null;
}

async function readWorkflowXhsContent(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<string | null> {
	if (!isWritingWorkflowLayout(plugin.settings)) return null;
	const key = getSessionKey(note);
	const s = plugin.settings;
	const vault = plugin.app.vault;
	const paths = [
		normalizePath(`${vaultRelPublishedXhsSession(s, key)}/${ARTIFACT_XHS_CONTENT}`),
		normalizePath(`${vaultRelSandboxSession(s, key)}/${ARTIFACT_XHS_CONTENT}`),
	];
	for (const p of paths) {
		const f = vault.getAbstractFileByPath(p);
		if (f instanceof TFile) return vault.read(f);
	}
	return null;
}

async function readWorkflowPublishXhs(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<string | null> {
	if (!isWritingWorkflowLayout(plugin.settings)) return null;
	const key = getSessionKey(note);
	const s = plugin.settings;
	const vault = plugin.app.vault;
	const paths = [
		normalizePath(`${vaultRelPublishedXhsSession(s, key)}/${ARTIFACT_PUBLISH_XHS}`),
		normalizePath(`${vaultRelSandboxSession(s, key)}/${ARTIFACT_PUBLISH_XHS}`),
	];
	for (const p of paths) {
		const f = vault.getAbstractFileByPath(p);
		if (f instanceof TFile) return vault.read(f);
	}
	return null;
}

/** 与 xhs_content 查找顺序一致，用于封面标题等；无文件时返回 null */
export async function tryReadPublishXhsWithFallback(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<string | null> {
	const w = await readWorkflowPublishXhs(plugin, note);
	if (w != null && w.trim().length > 0) return w;
	const s = await readSiblingIfExists(plugin.app.vault, note, ARTIFACT_PUBLISH_XHS);
	if (s != null && s.trim().length > 0) return s;
	const cache = readFileUtf8(
		path.join(getSessionCacheDir(plugin, note.path), ARTIFACT_PUBLISH_XHS),
	);
	return cache != null && cache.trim().length > 0 ? cache : null;
}

/** 优先读写作工作流目录 → 笔记同目录 → .cache */
export async function readPublishGzhWithFallback(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<string> {
	const w = await readWorkflowPublishGzh(plugin, note);
	if (w != null) return w;
	const s = await readSiblingIfExists(plugin.app.vault, note, ARTIFACT_PUBLISH_GZH);
	if (s != null) return s;
	const cache = readFileUtf8(
		path.join(getSessionCacheDir(plugin, note.path), ARTIFACT_PUBLISH_GZH),
	);
	if (cache != null) return cache;
	throw new Error(
		"未找到 publish_gzh.md：请先执行「扩写」，或将其放在当前笔记同目录 / 写作工作流目录",
	);
}

/** 优先写作工作流 → 同目录/缓存 → 否则当前笔记全文 */
export async function readPublishGzhOrNoteBody(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<string> {
	const w = await readWorkflowPublishGzh(plugin, note);
	if (w != null && w.trim().length > 0) return w;
	const s = await readSiblingIfExists(plugin.app.vault, note, ARTIFACT_PUBLISH_GZH);
	if (s != null && s.trim().length > 0) return s;
	const cache = readFileUtf8(
		path.join(getSessionCacheDir(plugin, note.path), ARTIFACT_PUBLISH_GZH),
	);
	if (cache != null && cache.trim().length > 0) return cache;
	return plugin.app.vault.read(note);
}

export async function readXhsContentWithFallback(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<string> {
	const w = await readWorkflowXhsContent(plugin, note);
	if (w != null) return w;
	const s = await readSiblingIfExists(plugin.app.vault, note, ARTIFACT_XHS_CONTENT);
	if (s != null) return s;
	const cache = readFileUtf8(
		path.join(getSessionCacheDir(plugin, note.path), ARTIFACT_XHS_CONTENT),
	);
	if (cache != null) return cache;
	throw new Error(
		"未找到 xhs_content.md：请先执行「扩写」，或将其放在当前笔记同目录 / 写作工作流目录",
	);
}

/** 供外部脚本等使用：publish_xhs.md 的绝对路径 */
export function getPublishXhsAbsPathWithFallback(
	plugin: MdToPlatformPlugin,
	note: TFile,
): string {
	const s = plugin.settings;
	const vault = plugin.app.vault;
	const adapter = vault.adapter;
	if (isWritingWorkflowLayout(s)) {
		const key = getSessionKey(note);
		for (const base of [
			vaultRelPublishedXhsSession(s, key),
			vaultRelSandboxSession(s, key),
		]) {
			const vp = normalizePath(`${base}/${ARTIFACT_PUBLISH_XHS}`);
			if (vault.getAbstractFileByPath(vp) instanceof TFile) {
				if (adapter instanceof FileSystemAdapter) return adapter.getFullPath(vp);
			}
		}
	}
	const vp = siblingVaultPath(note, ARTIFACT_PUBLISH_XHS);
	if (vault.getAbstractFileByPath(vp) instanceof TFile) {
		if (adapter instanceof FileSystemAdapter) return adapter.getFullPath(vp);
	}
	const cacheFile = path.join(getSessionCacheDir(plugin, note.path), ARTIFACT_PUBLISH_XHS);
	if (fs.existsSync(cacheFile)) return cacheFile;
	throw new Error(
		"未找到 publish_xhs.md：请先执行「扩写」，或将其放在当前笔记同目录 / 写作工作流目录",
	);
}

/** 供生成视频等使用：video_config.json 的绝对路径 */
export function getVideoConfigAbsPathWithFallback(
	plugin: MdToPlatformPlugin,
	note: TFile,
): string {
	const s = plugin.settings;
	const vault = plugin.app.vault;
	const adapter = vault.adapter;
	if (isWritingWorkflowLayout(s)) {
		const key = getSessionKey(note);
		for (const base of [
			vaultRelPublishedVideoSession(s, key),
			vaultRelSandboxSession(s, key),
		]) {
			const vp = normalizePath(`${base}/${ARTIFACT_VIDEO_CONFIG}`);
			if (vault.getAbstractFileByPath(vp) instanceof TFile) {
				if (adapter instanceof FileSystemAdapter) return adapter.getFullPath(vp);
			}
		}
	}
	const vp = siblingVaultPath(note, ARTIFACT_VIDEO_CONFIG);
	if (vault.getAbstractFileByPath(vp) instanceof TFile) {
		if (adapter instanceof FileSystemAdapter) return adapter.getFullPath(vp);
	}
	throw new Error(
		"未找到 video_config.json：请先扩写并开启「扩写时同步视频脚本」或在工作流/同目录放置该文件",
	);
}

/** 短视频产物目录（与 video_config 同级的库内绝对路径，用于落盘 .mp3/.mp4） */
export function resolveVideoArtifactsFsDir(
	plugin: MdToPlatformPlugin,
	note: TFile,
	settings: MdToPlatformSettings,
): string {
	const adapter = plugin.app.vault.adapter;
	if (isWritingWorkflowLayout(settings)) {
		const key = getSessionKey(note);
		const rel = vaultRelPublishedVideoSession(settings, key);
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getFullPath(rel);
		}
	}
	if (adapter instanceof FileSystemAdapter) {
		const p = note.parent?.path;
		const rel = p
			? normalizePath(`${p}`)
			: "";
		if (rel) return adapter.getFullPath(rel);
	}
	return path.dirname(getSessionCacheDir(plugin, note.path));
}

/** 小红书卡片 PNG 输出目录（绝对路径） */
export function resolveXhsCardImagesFsDir(
	plugin: MdToPlatformPlugin,
	note: TFile,
	settings: MdToPlatformSettings,
): string {
	const adapter = plugin.app.vault.adapter;
	if (isWritingWorkflowLayout(settings)) {
		const key = getSessionKey(note);
		const rel = vaultRelPublishedXhsSession(settings, key);
		if (adapter instanceof FileSystemAdapter) {
			const abs = adapter.getFullPath(rel);
			fs.mkdirSync(abs, { recursive: true });
			return abs;
		}
	}
	if (!settings.xhsSaveCardsNextToNote) {
		return path.join(getSessionCacheDir(plugin, note.path), "xhs_images");
	}
	let sub = (settings.xhsSaveCardsSubfolder || "xhs_cards").trim();
	sub = sub.replace(/^[/\\]+|[/\\]+$/g, "");
	if (!sub || sub.includes("..")) {
		sub = "xhs_cards";
	}
	const parentVault = note.parent?.path ?? "";
	const vaultRel = parentVault
		? normalizePath(`${parentVault}/${sub}`)
		: normalizePath(sub);
	if (!(adapter instanceof FileSystemAdapter)) {
		return path.join(getSessionCacheDir(plugin, note.path), "xhs_images");
	}
	const abs = adapter.getFullPath(vaultRel);
	fs.mkdirSync(abs, { recursive: true });
	return abs;
}

/**
 * 短视频中段轮播用 `card_*.png` 所在目录的**候选**（仅路径；选中有卡片的第一个目录由
 * `render_video.py` 处理）。绝对路径、去重、顺序固定：
 * 1. 各 `02-Sanbox` / `02-Sandbox` 变体下 `…/xhs/<会话>/`（图文卡片常放于此）
 * 2. `…/Sandbox/<会话>/`
 * 3. `…/Sandbox/<会话>/xhs/`
 * 4. `…/Published/xhs/<会话>/`（同「渲染/复用」输出位）
 * 5. 当前「渲染/复用」传下来的目录（如 Published/xhs 或 .cache，与上可能重复会自然去重）
 */
export function listVideoCardImageDirCandidates(
	plugin: MdToPlatformPlugin,
	note: TFile,
	renderImagesDir: string,
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (abs: string) => {
		const n = path.normalize(abs);
		if (seen.has(n)) return;
		seen.add(n);
		out.push(n);
	};

	if (!isWritingWorkflowLayout(plugin.settings)) {
		push(path.normalize(renderImagesDir));
		return out;
	}

	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		push(path.normalize(renderImagesDir));
		return out;
	}

	const s = plugin.settings;
	const key = getSessionKey(note);
	const { workflowVaultRoot, folderSandbox } = getEffectiveWorkflowPathParts(s);

	const sandNames = new Set([folderSandbox]);
	if (folderSandbox === "02-Sanbox" || folderSandbox === "02-sanbox") {
		sandNames.add("02-Sandbox");
	}
	if (folderSandbox === "02-Sandbox") {
		sandNames.add("02-Sanbox");
	}

	for (const sand of sandNames) {
		push(
			adapter.getFullPath(
				normalizePath(`${workflowVaultRoot}/${sand}/xhs/${key}`),
			),
		);
	}
	push(adapter.getFullPath(vaultRelSandboxSession(s, key)));
	push(
		adapter.getFullPath(
			normalizePath(`${vaultRelSandboxSession(s, key)}/xhs`),
		),
	);
	push(adapter.getFullPath(vaultRelPublishedXhsSession(s, key)));
	push(path.normalize(renderImagesDir));
	return out;
}

/**
 * Baoyu 风 CogView 配图输出目录（绝对路径）。
 * 工作流开启：…/Published/xhs/<会话>/baoyu_cogview/；否则笔记旁 baoyu_cogview 或 .cache/baoyu_cogview。
 */
export function resolveBaoyuCogviewImagesFsDir(
	plugin: MdToPlatformPlugin,
	note: TFile,
	settings: MdToPlatformSettings,
): string {
	const adapter = plugin.app.vault.adapter;
	const sub = "baoyu_cogview";
	if (isWritingWorkflowLayout(settings)) {
		const key = getSessionKey(note);
		const rel = normalizePath(
			`${vaultRelPublishedXhsSession(settings, key)}/${sub}`,
		);
		if (adapter instanceof FileSystemAdapter) {
			const abs = adapter.getFullPath(rel);
			fs.mkdirSync(abs, { recursive: true });
			return abs;
		}
	}
	if (!settings.xhsSaveCardsNextToNote) {
		const base = path.join(getSessionCacheDir(plugin, note.path), sub);
		fs.mkdirSync(base, { recursive: true });
		return base;
	}
	const parentVault = note.parent?.path ?? "";
	const vaultRel = parentVault
		? normalizePath(`${parentVault}/${sub}`)
		: normalizePath(sub);
	if (!(adapter instanceof FileSystemAdapter)) {
		const base = path.join(getSessionCacheDir(plugin, note.path), sub);
		fs.mkdirSync(base, { recursive: true });
		return base;
	}
	const abs = adapter.getFullPath(vaultRel);
	fs.mkdirSync(abs, { recursive: true });
	return abs;
}

/** 公众号草稿推送成功后：仅删除 Sandbox 中**公众号**相关 tmp（wechat_images、带图稿 html 等），不删 xhs 文件。 */
export async function removeSandboxWechatTmp(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<void> {
	if (!isWritingWorkflowLayout(plugin.settings)) return;
	const s = plugin.settings;
	const key = getSessionKey(note);
	const relBase = vaultRelSandboxSession(s, key);
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return;
	const baseAbs = adapter.getFullPath(relBase);
	const imgDir = path.join(baseAbs, "wechat_images");
	if (fs.existsSync(imgDir)) {
		try {
			fs.rmSync(imgDir, { recursive: true });
		} catch {
			/* ignore */
		}
	}
	const vault = plugin.app.vault;
	const names = [
		ARTIFACT_PUBLISH_GZH_WITH_IMAGES,
		"wechat_article.html",
		ARTIFACT_PUBLISH_GZH,
	];
	for (const name of names) {
		const vp = normalizePath(`${relBase}/${name}`);
		const f = vault.getAbstractFileByPath(vp);
		if (f instanceof TFile) await vault.delete(f);
	}
}

/** 小红书**发笔记脚本成功**（非 dry-run）后：删除 Sandbox 中 publish_xhs / xhs_content tmp；仅渲染 PNG 不调用。 */
export async function removeSandboxXhsMarkdownTmp(
	plugin: MdToPlatformPlugin,
	note: TFile,
): Promise<void> {
	if (!isWritingWorkflowLayout(plugin.settings)) return;
	const s = plugin.settings;
	const key = getSessionKey(note);
	const relBase = vaultRelSandboxSession(s, key);
	const vault = plugin.app.vault;
	for (const name of [ARTIFACT_PUBLISH_XHS, ARTIFACT_XHS_CONTENT]) {
		const vp = normalizePath(`${relBase}/${name}`);
		const f = vault.getAbstractFileByPath(vp);
		if (f instanceof TFile) await vault.delete(f);
	}
}
