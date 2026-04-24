import * as fs from "node:fs";
import * as path from "node:path";
import { FileSystemAdapter } from "obsidian";
import type { Plugin } from "obsidian";
import type { MdToPlatformSettings } from "./settings";

const GZH_RULE = "公众号扩写规则.md";
/** 列表缩进、紧凑列表、标题与图片等，保证公众号草稿箱排版；与 `公众号扩写规则.md` 合并进扩写 system */
const WECHAT_MD_RULE = "wechat-markdown-rules.zh.md";
const XHS_RULE = "gzh_to_xhs.md";

/**
 * 解析插件根目录。部分环境下 manifest.dir 为空，需用「库路径/.obsidian/plugins/<id>」回退。
 */
export function getPluginFolderPath(plugin: Plugin): string {
	const fromManifest = plugin.manifest.dir?.trim();
	if (fromManifest) {
		const man = path.join(fromManifest, "manifest.json");
		if (fs.existsSync(man)) return path.normalize(fromManifest);
	}
	const adapter = plugin.app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		const base = adapter.getBasePath();
		const candidate = path.join(
			base,
			".obsidian",
			"plugins",
			plugin.manifest.id,
		);
		const man = path.join(candidate, "manifest.json");
		if (fs.existsSync(man)) return path.normalize(candidate);
	}
	if (fromManifest) return path.normalize(fromManifest);
	throw new Error(
		"无法定位插件目录（manifest.dir 异常）。请在设置「规则目录覆盖」中填写 rules 所在文件夹的绝对路径，或重装插件。",
	);
}

/**
 * 规则目录：默认 <插件目录>/rules。
 * 「规则目录覆盖」可为：绝对路径，或**相对于当前 Obsidian 库根**的相对路径（如 rules、notes/rules）。
 */
export function resolveRulesDir(
	plugin: Plugin,
	settings: MdToPlatformSettings,
): string {
	const raw = settings.rulesDirOverride?.trim();
	if (raw) {
		if (path.isAbsolute(raw)) return path.normalize(raw);
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return path.normalize(path.join(adapter.getBasePath(), raw));
		}
		return path.normalize(raw);
	}
	return path.join(getPluginFolderPath(plugin), "rules");
}

export function loadRuleFiles(
	plugin: Plugin,
	settings: MdToPlatformSettings,
): { gzhExpand: string; gzhToXhs: string } {
	const dir = resolveRulesDir(plugin, settings);
	const gzhPath = path.join(dir, GZH_RULE);
	const wechatMdPath = path.join(dir, WECHAT_MD_RULE);
	const xhsPath = path.join(dir, XHS_RULE);
	if (!fs.existsSync(gzhPath)) {
		throw new Error(
			`找不到规则文件：${gzhPath}\n请确认插件目录下有 rules/${GZH_RULE}，或在设置中填写「规则目录覆盖」（支持库内相对路径）。`,
		);
	}
	if (!fs.existsSync(wechatMdPath)) {
		throw new Error(
			`找不到规则文件：${wechatMdPath}\n请确认 rules 目录中有 ${WECHAT_MD_RULE}（与公众号扩写规则一并用于 AI 扩写），或检查「规则目录覆盖」。`,
		);
	}
	if (!fs.existsSync(xhsPath)) {
		throw new Error(
			`找不到规则文件：${xhsPath}\n请确认插件目录下有 rules/${XHS_RULE}，或在设置中填写「规则目录覆盖」。`,
		);
	}
	const gzhBase = fs.readFileSync(gzhPath, "utf8");
	const wechatMd = fs.readFileSync(wechatMdPath, "utf8");
	const gzhExpand = `${gzhBase.replace(/\s+$/, "")}\n\n---\n\n${wechatMd.replace(/^\s+/, "").replace(/\s+$/, "")}\n`;
	return {
		gzhExpand,
		gzhToXhs: fs.readFileSync(xhsPath, "utf8"),
	};
}
