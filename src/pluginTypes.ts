import type { Plugin } from "obsidian";
import type { MdToPlatformSettings } from "./settings";

/** 供 pipeline 使用，避免与 main 循环依赖 */
export type MdToPlatformPlugin = Plugin & {
	settings: MdToPlatformSettings;
};
