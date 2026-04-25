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

/** 与 main.js 同级的内置小红书发布脚本（基于 Auto-Redbook-Skills `publish_xhs.py` 适配 MDT 环境变量） */
export const BUNDLED_SCRIPT_PUBLISH_XHS_REDBOOK = "scripts/publish_xhs_redbook.py" as const;

/**
 * 返回内置 `scripts/publish_xhs_redbook.py` 的绝对路径；若插件目录无法解析或文件不存在则 `null`。
 */
export function getBundledPublishXhsRedbookPyPath(plugin: Plugin): string | null {
	try {
		const root = getPluginFolderPath(plugin);
		const p = path.join(root, BUNDLED_SCRIPT_PUBLISH_XHS_REDBOOK);
		return fs.existsSync(p) ? p : null;
	} catch {
		return null;
	}
}

/** 如 `darwin-arm64`，与 `process` 一致，用于 `scripts/xhs_bundles/<id>/` */
export function getCurrentXhsPipBundleId(): string {
	return `${process.platform}-${process.arch}`;
}

/**
 * 若本机已用 `node scripts/bundle_xhs_pip_target.mjs` 生成了对应平台的 pip --target 目录，则用于 PYTHONPATH，无需系统级 pip 安装 xhs（仍需要任意 Python3 调起发布脚本）。
 * 因含 lxml 等 native 库，**不可**随仓库提交一份就适用所有系统；每平台/每台机各生成一次。
 */
export function getBundledXhsPipTargetPath(plugin: Plugin): string | null {
	try {
		const root = getPluginFolderPath(plugin);
		const p = path.join(root, "scripts", "xhs_bundles", getCurrentXhsPipBundleId());
		try {
			if (!fs.statSync(path.join(p, "xhs")).isDirectory()) return null;
		} catch {
			return null;
		}
		return p;
	} catch {
		return null;
	}
}

/**
 * 解析执行内置发布脚本时使用的 Python。
 * 图形界面下的 Obsidian 的 `PATH` 往往不含 Homebrew 的 `python3`，与终端里 `pip install` 用的解释器不一致，故优先常见绝对路径，或由用户在设置中填写 `xhsPythonPath`。
 */
export function resolveXhsPythonExecutable(pythonPathOverride: string): string {
	const t = pythonPathOverride?.trim() ?? "";
	if (t) return t;
	if (process.platform === "win32") {
		return "py";
	}
	if (process.platform === "darwin") {
		const candidates: string[] = [];
		const hbp = process.env.HOMEBREW_PREFIX
			? path.join(process.env.HOMEBREW_PREFIX, "bin", "python3")
			: "";
		if (hbp && fs.existsSync(hbp)) candidates.push(hbp);
		for (const c of ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"]) {
			if (fs.existsSync(c) && !candidates.includes(c)) candidates.push(c);
		}
		if (candidates.length > 0) return candidates[0];
	}
	return "python3";
}

function quoteShArg(s: string): string {
	if (!s) return s;
	// 含空格、括号等时整体加引号并转义内部引号
	if (/[\s"\\]/.test(s)) {
		return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return s;
}

/**
 * 生成本机可执行的发布命令行（`shell: true`）。无内置脚本或未启用时返回 `""`。
 */
export function buildBundledXhsRedbookCommand(
	plugin: Plugin,
	enabled: boolean,
	pythonPathOverride: string = "",
): string {
	if (!enabled) return "";
	const p = getBundledPublishXhsRedbookPyPath(plugin);
	if (!p) return "";
	const scriptQ = quoteShArg(p);
	const py = resolveXhsPythonExecutable(pythonPathOverride);
	if (process.platform === "win32" && py === "py") {
		// `py` 是 Windows Python Launcher 固定名
		return `py -3 ${scriptQ}`;
	}
	return `${quoteShArg(py)} ${scriptQ}`;
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
