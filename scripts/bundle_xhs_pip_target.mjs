#!/usr/bin/env node
/**
 * 为「本机当前平台 + 架构」执行 pip --target，供插件在运行时设置 PYTHONPATH。
 * 需已安装能 pip 的 Python；Homebrew 若报 PEP 668，请先用 scripts/bootstrap_xhs_venv.sh
 * 再设：MDT_BUNDLE_PYTHON="<插件>/scripts/xhs_venv/bin/python3" node scripts/bundle_xhs_pip_target.mjs
 * 或：npm run bundle:xhs-embed
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const id = `${os.platform()}-${os.arch}`;
const target = path.join(__dirname, "xhs_bundles", id);
const custom = process.env.MDT_BUNDLE_PYTHON?.trim();
const isWin = os.platform() === "win32";

const pipArgs = [
	"-m",
	"pip",
	"install",
	"xhs",
	"requests",
	"python-dotenv",
	"-t",
	target,
];

fs.mkdirSync(path.dirname(target), { recursive: true });

let result;
if (isWin && !custom) {
	result = spawnSync("py", ["-3", ...pipArgs], { stdio: "inherit", shell: false });
} else {
	const exe = custom || (isWin ? "python" : "python3");
	result = spawnSync(exe, pipArgs, { stdio: "inherit", shell: false });
}
if (result.error) throw result.error;
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
console.log(
	"\n已写入（仅本机平台）:",
	"\n  ",
	target,
	"\n若存在该目录，发布小红书时插件会自动将 PYTHONPATH 指到这里。\n",
);
