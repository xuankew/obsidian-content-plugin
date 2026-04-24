import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { Plugin } from "obsidian";

export function hashNotePath(vaultPath: string): string {
	return crypto.createHash("sha256").update(vaultPath).digest("hex").slice(0, 16);
}

/** 用于判断「源稿是否变更」、小红书卡片是否需重渲 */
export function hashString(utf8: string): string {
	return crypto.createHash("sha256").update(utf8, "utf8").digest("hex").slice(0, 32);
}

export function getPluginCacheRoot(plugin: Plugin): string {
	return path.join(plugin.manifest.dir ?? "", ".cache");
}

export function getSessionCacheDir(plugin: Plugin, notePath: string): string {
	const h = hashNotePath(notePath);
	return path.join(getPluginCacheRoot(plugin), h);
}

export function ensureDir(p: string): void {
	if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function writeFileUtf8(file: string, content: string): void {
	ensureDir(path.dirname(file));
	fs.writeFileSync(file, content, "utf8");
}

export function readFileUtf8(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
}

export function cleanupOldCacheDirs(
	cacheRoot: string,
	ttlMs: number,
	now: number = Date.now(),
): number {
	if (!fs.existsSync(cacheRoot)) return 0;
	let removed = 0;
	for (const name of fs.readdirSync(cacheRoot)) {
		const full = path.join(cacheRoot, name);
		try {
			const st = fs.statSync(full);
			if (!st.isDirectory()) continue;
			if (now - st.mtimeMs > ttlMs) {
				fs.rmSync(full, { recursive: true, force: true });
				removed++;
			}
		} catch {
			/* ignore */
		}
	}
	return removed;
}
