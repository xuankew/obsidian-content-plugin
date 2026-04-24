import { normalizePath, type TFile } from "obsidian";
import type { MdToPlatformSettings } from "./settings";
import { hashNotePath } from "./cache";

const DEFAULT_WORKFLOW_ROOT = "06-写作";
const DEFAULT_FOLDER_SANDBOX = "02-Sanbox";
const DEFAULT_FOLDER_PUBLISHED = "03-Published";

/**
 * 解析设置里的库内相对路径：去空白、按 `/` `\` 分段、禁止含 `..` 的段、统一为正斜杠。
 * 非法或空则回退到 fallback（须为不含 `..` 的单一或多段安全路径）。
 */
export function sanitizeVaultRelativePath(raw: string, fallback: string): string {
	const parts = raw
		.trim()
		.split(/[/\\]+/)
		.filter((p) => p.length > 0 && p !== ".");
	if (parts.some((p) => p === "..")) {
		return normalizePath(fallback.split(/[/\\]+/).filter((p) => p && p !== "..").join("/"));
	}
	if (parts.length === 0) {
		return normalizePath(fallback.split(/[/\\]+/).filter((p) => p && p !== "..").join("/"));
	}
	return normalizePath(parts.join("/"));
}

function workflowRoot(settings: MdToPlatformSettings): string {
	const raw = settings.workflowVaultRoot.trim() || DEFAULT_WORKFLOW_ROOT;
	return sanitizeVaultRelativePath(raw, DEFAULT_WORKFLOW_ROOT);
}

function folderSandboxName(settings: MdToPlatformSettings): string {
	const raw = settings.folderSandbox.trim() || DEFAULT_FOLDER_SANDBOX;
	return sanitizeVaultRelativePath(raw, DEFAULT_FOLDER_SANDBOX);
}

function folderPublishedName(settings: MdToPlatformSettings): string {
	const raw = settings.folderPublished.trim() || DEFAULT_FOLDER_PUBLISHED;
	return sanitizeVaultRelativePath(raw, DEFAULT_FOLDER_PUBLISHED);
}

/** 与设置页展示一致、用于提示文案的「生效路径」片段（已规范化）。 */
export function getEffectiveWorkflowPathParts(settings: MdToPlatformSettings): {
	workflowVaultRoot: string;
	folderSandbox: string;
	folderPublished: string;
} {
	return {
		workflowVaultRoot: workflowRoot(settings),
		folderSandbox: folderSandboxName(settings),
		folderPublished: folderPublishedName(settings),
	};
}

/** 工作流产出的固定文件名（无扩展名）；打开这些文件时应与会话目录名对齐，而非用文件名当会话 key */
const WORKFLOW_ARTIFACT_BASENAMES = new Set([
	"publish_gzh",
	"publish_gzh_with_images",
	"publish_xhs",
	"xhs_content",
]);

/** 扩写/发布写入的会话目录：`标题片段-8位hash`，与 03-Published/gzh|xhs/<此名>/ 一致 */
const SESSION_FOLDER_RE = /^(.+)-([a-f0-9]{8})$/;

/**
 * 同一篇笔记的稳定会话目录名：文件名片段 + 路径哈希，避免重名冲突。
 * 若当前打开的是会话目录下的 publish_gzh / xhs_content 等产物，则使用**父文件夹名**作为会话 key，
 * 避免出现 `publish_gzh-xxxx` 与真实会话 `给中国家长…-yyyy` 不一致（Published 错乱、Sandbox 清理不到）。
 */
export function getSessionKey(note: TFile): string {
	if (WORKFLOW_ARTIFACT_BASENAMES.has(note.basename)) {
		const parentName = note.parent?.name;
		if (parentName && SESSION_FOLDER_RE.test(parentName)) {
			return parentName;
		}
	}
	let base = note.basename.replace(/[\\/:*?"<>|#]/g, "_").trim();
	if (!base) base = "note";
	if (base.length > 56) base = base.slice(0, 56);
	const h = hashNotePath(note.path).slice(0, 8);
	return `${base}-${h}`;
}

/** 库内路径：`<工作流根>/<Sandbox>/<session>/` */
export function vaultRelSandboxSession(
	settings: MdToPlatformSettings,
	sessionKey: string,
): string {
	return normalizePath(
		`${workflowRoot(settings)}/${folderSandboxName(settings)}/${sessionKey}`,
	);
}

/** 库内路径：`<工作流根>/<Published>/gzh/<session>/` */
export function vaultRelPublishedGzhSession(
	settings: MdToPlatformSettings,
	sessionKey: string,
): string {
	return normalizePath(
		`${workflowRoot(settings)}/${folderPublishedName(settings)}/gzh/${sessionKey}`,
	);
}

/** 库内路径：`<工作流根>/<Published>/xhs/<session>/` */
export function vaultRelPublishedXhsSession(
	settings: MdToPlatformSettings,
	sessionKey: string,
): string {
	return normalizePath(
		`${workflowRoot(settings)}/${folderPublishedName(settings)}/xhs/${sessionKey}`,
	);
}

export function isWritingWorkflowLayout(settings: MdToPlatformSettings): boolean {
	return settings.useWritingWorkflowLayout === true;
}
