#!/usr/bin/env node
/**
 * 外部发布占位脚本：读取环境变量，打印路径，供 Playwright 等自行扩展。
 * MDT_PUBLISH_XHS   publish_xhs.md 绝对路径
 * MDT_XHS_IMAGES_DIR 卡片图目录
 * MDT_VAULT_ROOT    库根目录
 * MDT_DRY_RUN       1 表示 dry-run
 * MDT_XHS_COOKIE    可选，设置里「小红书登录 Cookie」
 * MDT_XHS_AS_PRIVATE 1/0 是否以私密/仅自己可见发布（脚本自行解析）
 */
const fs = require("fs");

const pub = process.env.MDT_PUBLISH_XHS;
const dir = process.env.MDT_XHS_IMAGES_DIR;
const dry = process.env.MDT_DRY_RUN === "1";
const hasCookie = Boolean(process.env.MDT_XHS_COOKIE);
const asPrivate = process.env.MDT_XHS_AS_PRIVATE === "1";

console.log("[md-to-platform stub]", { pub, dir, dry, hasCookie, asPrivate });

if (!pub || !fs.existsSync(pub)) {
	console.error("缺少或无效 MDT_PUBLISH_XHS");
	process.exit(1);
}
if (!dir || !fs.existsSync(dir)) {
	console.error("缺少或无效 MDT_XHS_IMAGES_DIR");
	process.exit(1);
}

const imgs = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f));
console.log("images:", imgs.length);
if (dry) {
	console.log("dry-run: 跳过真实发布");
	process.exit(0);
}
console.log("请在此接入 Playwright / 小红书发布逻辑");
process.exit(0);
