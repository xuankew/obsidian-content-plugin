import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { FileSystemAdapter, type Plugin } from "obsidian";
import { getPluginFolderPath } from "./rulesLoader";

type ExecSpec = { exe: string; argsPrefix: string[] };

export type PythonProbe = {
	ok: boolean;
	exe: string;
	argsPrefix: string[];
	executable: string;
	version: string;
};

export type XhsEnvStatus = {
	python: PythonProbe | null;
	venvDir: string;
	venvPython: string;
	hasVenv: boolean;
	canImportXhs: boolean;
	/** 已 `pip install playwright` 且可 import；用于内置 Playwright 发布脚本 */
	canImportPlaywright: boolean;
	/** `edge-tts`、`Pillow` 等，用于 `scripts/render_video.py`；FFmpeg 需单独在 PATH/设置中配置 */
	canImportVideoDeps: boolean;
};

function spawnCollect(
	exe: string,
	args: string[],
	opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; out: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(exe, args, {
			shell: false,
			cwd: opts?.cwd,
			env: opts?.env,
			detached: false,
		});
		const chunks: string[] = [];
		const append = (c: unknown) => chunks.push(String(c));
		child.stdout?.on("data", append);
		child.stderr?.on("data", append);
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, out: chunks.join("") }));
	});
}

function getVaultRootAbs(plugin: Plugin): string | null {
	const adapter = plugin.app.vault.adapter;
	return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
}

/**
 * venv 放在库内 `.obsidian/mdtp/xhs_venv`，避免插件更新覆盖。
 * 若无法获得 vault root，则回退到插件目录。
 */
export function resolveXhsVenvDir(plugin: Plugin): string {
	const vault = getVaultRootAbs(plugin);
	if (vault) return path.join(vault, ".obsidian", "mdtp", "xhs_venv");
	return path.join(getPluginFolderPath(plugin), "python", "xhs_venv");
}

export function resolveVenvPythonExecutable(venvDir: string): string {
	if (process.platform === "win32") {
		return path.join(venvDir, "Scripts", "python.exe");
	}
	const p3 = path.join(venvDir, "bin", "python3");
	if (fs.existsSync(p3)) return p3;
	return path.join(venvDir, "bin", "python");
}

/** 若库内/插件下 xhs_venv 已存在且带解释器，返回其路径，否则 `null`（供短视频等优先使用） */
export function tryGetXhsVenvPythonPath(plugin: Plugin): string | null {
	const dir = resolveXhsVenvDir(plugin);
	const py = resolveVenvPythonExecutable(dir);
	return fs.existsSync(py) ? py : null;
}

function candidatesFromSettings(pythonPathOverride: string): ExecSpec[] {
	const t = (pythonPathOverride ?? "").trim();
	const list: ExecSpec[] = [];
	if (t) list.push({ exe: t, argsPrefix: [] });
	return list;
}

function defaultCandidates(): ExecSpec[] {
	if (process.platform === "win32") {
		return [
			{ exe: "py", argsPrefix: ["-3"] },
			{ exe: "python", argsPrefix: [] },
		];
	}
	if (process.platform === "darwin") {
		return [
			{ exe: "/opt/homebrew/bin/python3", argsPrefix: [] },
			{ exe: "/usr/local/bin/python3", argsPrefix: [] },
			{ exe: "python3", argsPrefix: [] },
			{ exe: "python", argsPrefix: [] },
		];
	}
	return [
		{ exe: "python3", argsPrefix: [] },
		{ exe: "python", argsPrefix: [] },
	];
}

export async function probePython(spec: ExecSpec): Promise<PythonProbe> {
	try {
		const code = [
			"import sys",
			"print(sys.executable)",
			"print(sys.version.split()[0])",
		].join(";");
		const { code: rc, out } = await spawnCollect(spec.exe, [
			...spec.argsPrefix,
			"-c",
			code,
		]);
		if (rc !== 0) {
			return {
				ok: false,
				exe: spec.exe,
				argsPrefix: spec.argsPrefix,
				executable: "",
				version: "",
			};
		}
		const lines = out
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		return {
			ok: Boolean(lines[0] && lines[1]),
			exe: spec.exe,
			argsPrefix: spec.argsPrefix,
			executable: lines[0] ?? "",
			version: lines[1] ?? "",
		};
	} catch {
		return {
			ok: false,
			exe: spec.exe,
			argsPrefix: spec.argsPrefix,
			executable: "",
			version: "",
		};
	}
}

export async function detectBestPython(
	pythonPathOverride: string,
): Promise<PythonProbe | null> {
	const specs = [
		...candidatesFromSettings(pythonPathOverride),
		...defaultCandidates(),
	];
	for (const s of specs) {
		const p = await probePython(s);
		if (p.ok) return p;
	}
	return null;
}

export async function canImportXhs(pythonExe: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
	try {
		const { code } = await spawnCollect(pythonExe, ["-c", "import xhs; print('OK')"], {
			env,
		});
		return code === 0;
	} catch {
		return false;
	}
}

export async function canImportPlaywright(
	pythonExe: string,
	env?: NodeJS.ProcessEnv,
): Promise<boolean> {
	try {
		const { code } = await spawnCollect(
			pythonExe,
			["-c", "import playwright; print(1)"],
			{ env },
		);
		return code === 0;
	} catch {
		return false;
	}
}

export async function canImportVideoDeps(
	pythonExe: string,
	env?: NodeJS.ProcessEnv,
): Promise<boolean> {
	try {
		const { code } = await spawnCollect(
			pythonExe,
			["-c", "import edge_tts; from PIL import Image; print(1)"],
			{ env },
		);
		return code === 0;
	} catch {
		return false;
	}
}

/**
 * 下载 Playwright 管理的 Chromium（较大，首次可能数分钟）。失败时仅打日志，不抛错（仍可用本机 Chrome + CDP）。
 */
export async function tryInstallPlaywrightChromium(
	venvPy: string,
	opts?: { onLog?: (s: string) => void; env?: NodeJS.ProcessEnv },
): Promise<boolean> {
	const onLog = opts?.onLog ?? (() => {});
	const env: NodeJS.ProcessEnv = { ...process.env, ...opts?.env };
	if (!(await canImportPlaywright(venvPy, env))) {
		onLog("跳过 Chromium 安装：当前解释器无法 import playwright。\n");
		return false;
	}
	onLog("正在执行 python -m playwright install chromium（首次或更新时较慢、需联网）…\n");
	const { code, out } = await spawnCollect(venvPy, ["-m", "playwright", "install", "chromium"], {
		env,
	});
	onLog(out);
	if (code !== 0) {
		onLog(
			"⚠️ Playwright Chromium 安装未成功。若本机已装 Google Chrome，发布脚本会优先用 Chrome；否则请重试或检查网络/磁盘。\n",
		);
		return false;
	}
	onLog("Playwright Chromium 已就绪。\n");
	return true;
}

export async function ensureXhsVenvInstalled(
	plugin: Plugin,
	pythonPathOverride: string,
	opts?: {
		onLog?: (s: string) => void;
	},
): Promise<XhsEnvStatus> {
	const onLog = opts?.onLog ?? (() => {});
	const venvDir = resolveXhsVenvDir(plugin);
	const venvPy = resolveVenvPythonExecutable(venvDir);

	const py = await detectBestPython(pythonPathOverride);
	if (!py) {
		return {
			python: null,
			venvDir,
			venvPython: venvPy,
			hasVenv: fs.existsSync(venvDir),
			canImportXhs: false,
			canImportPlaywright: false,
			canImportVideoDeps: false,
		};
	}

	if (!fs.existsSync(venvDir)) {
		onLog(`创建 venv: ${venvDir}\n`);
		fs.mkdirSync(path.dirname(venvDir), { recursive: true });
		const { code, out } = await spawnCollect(py.exe, [...py.argsPrefix, "-m", "venv", venvDir]);
		onLog(out);
		if (code !== 0) {
			throw new Error(out || "创建 venv 失败");
		}
	}

	const env: NodeJS.ProcessEnv = { ...process.env };
	onLog("升级 pip…\n");
	{
		const { code, out } = await spawnCollect(venvPy, ["-m", "pip", "install", "-U", "pip"], {
			env,
		});
		onLog(out);
		if (code !== 0) throw new Error(out || "pip 升级失败");
	}

	const reqFile = path.join(getPluginFolderPath(plugin), "scripts", "requirements-xhs-publish.txt");
	if (fs.existsSync(reqFile)) {
		onLog(`安装依赖: ${reqFile}\n`);
		const { code, out } = await spawnCollect(venvPy, ["-m", "pip", "install", "-r", reqFile], {
			env,
		});
		onLog(out);
		if (code !== 0) throw new Error(out || "pip 安装失败");
	} else {
		onLog("requirements-xhs-publish.txt 不存在，尝试仅安装 xhs…\n");
		const { code, out } = await spawnCollect(venvPy, ["-m", "pip", "install", "xhs"], {
			env,
		});
		onLog(out);
		if (code !== 0) throw new Error(out || "pip 安装 xhs 失败");
	}

	const videoReq = path.join(
		getPluginFolderPath(plugin),
		"scripts",
		"requirements-video.txt",
	);
	if (fs.existsSync(videoReq)) {
		onLog(`安装短视频依赖: ${videoReq}\n`);
		const { code: vCode, out: vOut } = await spawnCollect(
			venvPy,
			["-m", "pip", "install", "-r", videoReq],
			{ env },
		);
		onLog(vOut);
		if (vCode !== 0) {
			onLog(
				"⚠️ 短视频依赖（edge-tts、Pillow 等）安装未成功，可在本库 venv 中手动执行：\n" +
					`  "${venvPy}" -m pip install -r ${videoReq}\n` +
					"（小红书发布依赖若已成功，仍可使用；FFmpeg 需本机安装并在 PATH 或设置中指定。）\n",
			);
		}
	} else {
		onLog("未找到 scripts/requirements-video.txt，跳过短视频 pip 依赖。\n");
	}

	const okXhs = await canImportXhs(venvPy, env);
	const okPw = await canImportPlaywright(venvPy, env);
	if (okPw) {
		await tryInstallPlaywrightChromium(venvPy, { onLog, env });
	}
	return {
		python: py,
		venvDir,
		venvPython: venvPy,
		hasVenv: true,
		canImportXhs: okXhs,
		canImportPlaywright: await canImportPlaywright(venvPy, env),
		canImportVideoDeps: await canImportVideoDeps(venvPy, env),
	};
}

export async function getXhsEnvStatus(
	plugin: Plugin,
	pythonPathOverride: string,
): Promise<XhsEnvStatus> {
	const venvDir = resolveXhsVenvDir(plugin);
	const venvPy = resolveVenvPythonExecutable(venvDir);
	const hasVenv = fs.existsSync(venvDir) && fs.existsSync(venvPy);
	const py = await detectBestPython(pythonPathOverride);
	const canXhs = hasVenv ? await canImportXhs(venvPy) : false;
	const canPw = hasVenv ? await canImportPlaywright(venvPy) : false;
	const canVideo = hasVenv ? await canImportVideoDeps(venvPy) : false;
	return {
		python: py,
		venvDir,
		venvPython: venvPy,
		hasVenv,
		canImportXhs: canXhs,
		canImportPlaywright: canPw,
		canImportVideoDeps: canVideo,
	};
}

