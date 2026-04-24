import * as fs from "node:fs";
import * as path from "node:path";
import type { Plugin } from "obsidian";
import type { MdToPlatformSettings } from "./settings";
import { resolveRulesDir } from "./rulesLoader";

const BAOYU_RULE_FILE = "baoyu_xhs_images.md";

/** 与 rules/baoyu_xhs_images.md 同步；缺失文件时使用本默认内容 */
export const DEFAULT_BAOYU_XHS_IMAGES_RULE = `# Baoyu 风 · 小红书信息流配图（提示词生成）

你是「小红书信息流视觉策划」，参考社区常见爆款信息图的**留白、层级、配色克制、竖版构图**。读者划动时每一张图应自成一页、信息密度适中。

## 输入

用户会提供一篇公众号风格长文（或提纲扩写后的正文）。

## 任务

1. 将全文拆成 **3～9 张** 连续滑动的配图需求（每张对应插件「插图渠道」一次生图；具体模型由用户在插件设置中选择，如智谱 glm-image、火山方舟等）。
2. 每张图用**一段完整的生图提示词**描述画面，风格统一为：**竖版 3:4、适合手机信息流、高级配色、扁平或轻拟物插画、大量留白、主体清晰**；避免密集小字（模型难以渲染清晰文字）。若画面有人物，须写明**东亚中国人形象与中国生活场景**，避免欧美面孔。
3. 提示词可用中文或英文，单段不超过 800 字。

## 输出格式（必须严格遵守）

只输出多段卡片块，每段格式如下（不要包在 markdown 代码块里）：

<<<CARD>>>
（此处写本张图的完整生图提示词）
<<<END>>>

重复 <<<CARD>>> … <<<END>>>，段数与规划张数一致。
`;

export function loadBaoyuXhsImagesRule(
	plugin: Plugin,
	settings: MdToPlatformSettings,
): string {
	const dir = resolveRulesDir(plugin, settings);
	const p = path.join(dir, BAOYU_RULE_FILE);
	if (fs.existsSync(p)) {
		return fs.readFileSync(p, "utf8");
	}
	return DEFAULT_BAOYU_XHS_IMAGES_RULE;
}
