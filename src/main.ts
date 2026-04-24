import {
	Menu,
	Notice,
	Plugin,
	MarkdownView,
	WorkspaceLeaf,
	TFile,
	setTooltip,
} from "obsidian";
import type { MarkdownFileInfo } from "obsidian";
import {
	DEFAULT_SETTINGS,
	MdToPlatformSettingTab,
	type MdToPlatformSettings,
} from "./settings";
import type { MdToPlatformPlugin as IMdToPlatformPlugin } from "./pluginTypes";
import { cleanupOldCacheDirs, getPluginCacheRoot } from "./cache";
import { normalizeWechatTheme } from "./wechatHtml";
import { normalizeWechatCoverBgPreset } from "./wechatCoverThumb";
import { normalizeXhsTheme } from "./xhsThemes";
import { attachMdtpEditorTip } from "./ui/editorMdtpTip";
import { openSeedanceTaskModal } from "./ui/seedanceTaskModal";
import { openWechatChannelsVideoModal } from "./ui/wechatChannelsVideoModal";

const LOG_PREFIX = "[md-to-platform]";

/** 工具栏图标须为 Obsidian 内置 Lucide 名称（勿用 pencil，与默认「编辑」易混） */
const ICON_EXPAND = "wand-2";
const ICON_WECHAT = "send";
const ICON_XHS = "image";
/** 公众号长文 → 小红书卡片图（独立流程） */
const ICON_GZH_TO_XHS = "layout-grid";
/** Baoyu 风：长文 → LLM 拆页 + CogView 出图（参考 baoyu-xhs-images 思路） */
const ICON_BAOYU = "sparkles";
/** 微信视频号：库内 mp4 分片上传 */
const ICON_CHANNELS_VIDEO = "video";

type PipelineKind =
	| "expand"
	| "wechat"
	| "xhs"
	| "xhsRender"
	| "gzhToXhsCards"
	| "baoyuXhsImages";

/** 悬停提示（中文）：说明各按钮用途 */
const PIPELINE_HOVER_ZH: Record<PipelineKind, string> = {
	expand:
		"扩写：两次 AI 调用，生成公众号稿与小紅书三份 Markdown（不改当前笔记）；终稿在 Published 或同目录",
	wechat:
		"公众号：读 publish_gzh，可选生图换 `[配图：…]` / `【配图提示词】` 块，上传素材并建草稿",
	xhs:
		"小红书：读取 xhs_content 导出卡片 PNG；若已配置发布命令且开启「外部发布」，再执行脚本（需 publish_xhs）",
	xhsRender:
		"仅渲染：只根据 xhs_content 导出卡片图，不执行外部发布脚本",
	gzhToXhsCards:
		"文→卡：从长文（或 publish_gzh）生成小红书两份 md，并导出 html 卡片图",
	baoyuXhsImages:
		"葆玉图：长文由 AI 拆成多段生图提示词，再用 CogView 逐张出信息流风格配图",
};

export default class MdToPlatformPlugin extends Plugin implements IMdToPlatformPlugin {
	settings: MdToPlatformSettings = { ...DEFAULT_SETTINGS };
	private decoratedViews = new WeakSet<MarkdownView>();

	async onload(): Promise<void> {
		try {
			await this.loadSettings();
			console.info(`${LOG_PREFIX} 已加载 v${this.manifest.version}`);

			this.addSettingTab(new MdToPlatformSettingTab(this.app, this));

			// 底部状态栏文字链接：不依赖左侧功能区是否显示，桌面端始终可见
			this.mountStatusBar();

			// 扩写/公众号/小红书/文→卡/葆玉图 已在 Markdown 标题栏与右键菜单提供，不再占左侧功能区；仅「视频号」无标题栏入口，保留一条 ribbon
			const chVideo = this.addRibbonIcon(ICON_CHANNELS_VIDEO, "视频号", () => {
				openWechatChannelsVideoModal(this.app, this);
			});
			setTooltip(
				chVideo,
				"视频号：将库内 .mp4 以 init + 分片 chunk 上传至 api.weixin.qq.com（与公众号共用 AppID/Secret）",
				{ placement: "right" },
			);

			this.registerEvent(
				this.app.workspace.on("editor-menu", (menu, _editor, info: MarkdownFileInfo) => {
					const file = info.file;
					if (!file) return;
					this.addMenuPipelineItems(menu, file);
				}),
			);

			// 文件列表里对 .md 右键
			this.registerEvent(
				this.app.workspace.on("file-menu", (menu, file) => {
					if (!(file instanceof TFile) || file.extension !== "md") return;
					this.addMenuPipelineItems(menu, file);
				}),
			);

			const refreshToolbar = (reason: string) => {
				this.logDbg("refreshToolbar", reason);
				try {
					this.decorateActiveMarkdownViewFirst();
					this.decorateOpenMarkdownViews();
				} catch (e) {
					console.error(`${LOG_PREFIX} refreshToolbar 异常`, reason, e);
				}
			};

			this.registerEvent(
				this.app.workspace.on("active-leaf-change", () =>
					refreshToolbar("active-leaf-change"),
				),
			);
			this.registerEvent(
				this.app.workspace.on("layout-change", () => refreshToolbar("layout-change")),
			);
			this.registerEvent(
				this.app.workspace.on("file-open", () => refreshToolbar("file-open")),
			);

			this.app.workspace.onLayoutReady(() => {
				this.logDbg("onLayoutReady");
				refreshToolbar("onLayoutReady");
				this.scheduleCleanup();
				window.setTimeout(() => refreshToolbar("delayed-0ms"), 0);
				window.setTimeout(() => refreshToolbar("delayed-200ms"), 200);
				window.setTimeout(() => refreshToolbar("delayed-1000ms"), 1000);
			});

			this.addCommand({
				id: "mdtp-expand",
				name: "MDTP：扩写",
				editorCallback: (_e, ctx) =>
					void this.dispatchPipeline("expand", ctx.file),
			});
			this.addCommand({
				id: "mdtp-publish-wechat",
				name: "MDTP：发布公众号草稿",
				editorCallback: (_e, ctx) =>
					void this.dispatchPipeline("wechat", ctx.file),
			});
			this.addCommand({
				id: "mdtp-render-xhs",
				name: "MDTP：仅渲染小红书卡片图",
				editorCallback: (_e, ctx) =>
					void this.dispatchPipeline("xhsRender", ctx.file),
			});
			this.addCommand({
				id: "mdtp-publish-xhs",
				name: "MDTP：发布小红书（渲染+可选脚本）",
				editorCallback: (_e, ctx) =>
					void this.dispatchPipeline("xhs", ctx.file),
			});
			this.addCommand({
				id: "mdtp-gzh-to-xhs-cards",
				name: "MDTP：公众号文→小红书图文（生成 md + 导出卡片图）",
				editorCallback: (_e, ctx) =>
					void this.dispatchPipeline("gzhToXhsCards", ctx.file),
			});
			this.addCommand({
				id: "mdtp-baoyu-xhs-images",
				name: "MDTP：Baoyu 风配图（长文→CogView 多图）",
				editorCallback: (_e, ctx) =>
					void this.dispatchPipeline("baoyuXhsImages", ctx.file),
			});
			this.addCommand({
				id: "mdtp-seedance-video-task",
				name: "MDTP：提交 Seedance 视频任务（火山方舟）",
				callback: () => {
					openSeedanceTaskModal(this.app, () => this.settings);
				},
			});
			this.addCommand({
				id: "mdtp-wechat-channels-video-upload",
				name: "MDTP：视频号视频分片上传（init + chunk）",
				callback: () => {
					openWechatChannelsVideoModal(this.app, this);
				},
			});

			this.registerInterval(
				window.setInterval(
					() => this.scheduleCleanup(),
					this.settings.cacheCleanupIntervalMinutes * 60_000,
				),
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`${LOG_PREFIX} onload 失败`, e);
			new Notice(
				`MDTP 插件初始化失败：${msg}。请打开开发者工具 Console 查看详情。`,
				15000,
			);
		}
	}

	/** 动态 import pipeline，避免 html-to-image 等在加载阶段拖垮整个插件导致「没有任何按钮」 */
	private async dispatchPipeline(
		kind: PipelineKind,
		file: TFile | null,
	): Promise<void> {
		if (!file) {
			new Notice("请先打开或选中一篇 Markdown 笔记（当前没有活动文件）");
			this.logDbg("dispatchPipeline: 无 file");
			return;
		}
		this.logDbg("dispatchPipeline", kind, file.path);
		try {
			switch (kind) {
				case "expand": {
					const { runExpandPipeline } = await import("./pipelines/expand");
					await runExpandPipeline(this, file);
					break;
				}
				case "wechat": {
					const { runPublishWechatPipeline } = await import(
						"./pipelines/publishWechat",
					);
					await runPublishWechatPipeline(this, file);
					break;
				}
				case "xhs": {
					const { runPublishXhsPipeline } = await import("./pipelines/publishXhs");
					await runPublishXhsPipeline(this, file);
					break;
				}
				case "xhsRender": {
					const { runRenderXhsPipeline } = await import("./pipelines/renderXhs");
					await runRenderXhsPipeline(this, file);
					break;
				}
				case "gzhToXhsCards": {
					const { runGzhArticleToXhsCardsPipeline } = await import(
						"./pipelines/gzhToXhsCards",
					);
					await runGzhArticleToXhsCardsPipeline(this, file);
					break;
				}
				case "baoyuXhsImages": {
					const { runBaoyuXhsImagesPipeline } = await import(
						"./pipelines/baoyuXhsImages",
					);
					await runBaoyuXhsImagesPipeline(this, file);
					break;
				}
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`MDTP：${msg}`, 12000);
			console.error(`${LOG_PREFIX} pipeline 错误`, kind, file.path, e);
		}
	}

	private addMenuPipelineItems(menu: Menu, file: TFile): void {
		menu.addItem((item) =>
			item
				.setTitle("MDTP：扩写")
				.setIcon(ICON_EXPAND)
				.onClick(() => void this.dispatchPipeline("expand", file)),
		);
		menu.addItem((item) =>
			item
				.setTitle("MDTP：公众号草稿")
				.setIcon(ICON_WECHAT)
				.onClick(() => void this.dispatchPipeline("wechat", file)),
		);
		menu.addItem((item) =>
			item
				.setTitle("MDTP：小红书")
				.setIcon(ICON_XHS)
				.onClick(() => void this.dispatchPipeline("xhs", file)),
		);
		menu.addItem((item) =>
			item
				.setTitle("MDTP：公众号→小红书图文")
				.setIcon(ICON_GZH_TO_XHS)
				.onClick(() => void this.dispatchPipeline("gzhToXhsCards", file)),
		);
		menu.addItem((item) =>
			item
				.setTitle("MDTP：Baoyu 风配图（CogView）")
				.setIcon(ICON_BAOYU)
				.onClick(() => void this.dispatchPipeline("baoyuXhsImages", file)),
		);
	}

	private mountStatusBar(): void {
		const bar = this.addStatusBarItem();
		while (bar.firstChild) bar.removeChild(bar.firstChild);
		bar.classList.add("mdtp-statusbar");
		bar.style.setProperty("flex-shrink", "0");
		// 单行仅占少量宽度：避免「MDTP + 多个链接」把状态栏撑满导致右侧字数等被裁切
		const trigger = document.createElement("a");
		trigger.href = "#";
		trigger.className = "mdtp-sb-link";
		trigger.textContent = "MDTP ▾";
		setTooltip(trigger, "MD to Platform：点击展开扩写、公众号、小红书等", {
			placement: "top",
		});
		trigger.style.cssText =
			"cursor:pointer;text-decoration:underline;margin:0 6px;color:var(--interactive-accent);white-space:nowrap;";
		trigger.addEventListener("click", (ev) => {
			ev.preventDefault();
			const menu = new Menu();
			const add = (title: string, kind: PipelineKind) => {
				menu.addItem((item) =>
					item.setTitle(title).onClick(() => {
						void this.dispatchPipeline(kind, this.app.workspace.getActiveFile());
					}),
				);
			};
			add("扩写", "expand");
			add("公众号", "wechat");
			add("小红书", "xhs");
			add("文→卡", "gzhToXhsCards");
			add("葆玉图", "baoyuXhsImages");
			menu.showAtMouseEvent(ev);
		});
		bar.appendChild(trigger);

		const parent = bar.parentElement;
		if (parent) parent.prepend(bar);
	}

	private logDbg(message: string, ...rest: unknown[]): void {
		if (!this.settings.debugLog) return;
		console.log(LOG_PREFIX, message, ...rest);
	}

	private decorateActiveMarkdownViewFirst(): void {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) {
			this.logDbg("当前活动视图为 MarkdownView", active.file?.path);
			this.decorateMarkdownViewIfNeeded(active);
		} else {
			this.logDbg("当前活动视图不是 MarkdownView");
		}
	}

	private decorateOpenMarkdownViews(): void {
		let leafCount = 0;
		let mdCount = 0;
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			leafCount++;
			const v = leaf.view;
			if (v instanceof MarkdownView) {
				mdCount++;
				this.decorateMarkdownViewIfNeeded(v);
			}
		});
		this.logDbg("iterateAllLeaves", { leafCount, mdCount });
	}

	private decorateMarkdownViewIfNeeded(view: MarkdownView): void {
		if (this.decoratedViews.has(view)) {
			this.logDbg("已挂接过按钮，跳过", view.file?.path);
			return;
		}

		const pathLabel = view.file?.path ?? "(无绑定文件)";

		try {
			const tip = (el: HTMLElement, kind: PipelineKind) => {
				setTooltip(el, PIPELINE_HOVER_ZH[kind], { placement: "bottom" });
			};
			tip(
				view.addAction(ICON_EXPAND, "扩写", () => {
					void this.dispatchPipeline("expand", view.file);
				}),
				"expand",
			);
			tip(
				view.addAction(ICON_WECHAT, "公众号", () => {
					void this.dispatchPipeline("wechat", view.file);
				}),
				"wechat",
			);
			tip(
				view.addAction(ICON_XHS, "小红书", () => {
					void this.dispatchPipeline("xhs", view.file);
				}),
				"xhs",
			);
			tip(
				view.addAction(ICON_GZH_TO_XHS, "文→卡", () => {
					void this.dispatchPipeline("gzhToXhsCards", view.file);
				}),
				"gzhToXhsCards",
			);
			tip(
				view.addAction(ICON_BAOYU, "葆玉图", () => {
					void this.dispatchPipeline("baoyuXhsImages", view.file);
				}),
				"baoyuXhsImages",
			);
			attachMdtpEditorTip(this, view);
			this.decoratedViews.add(view);
			this.logDbg("工具栏按钮已挂接", pathLabel);
		} catch (e) {
			console.error(
				`${LOG_PREFIX} addAction 失败（标题栏可能无按钮，请用窗口底部 MDTP 链接）`,
				pathLabel,
				e,
			);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MdToPlatformSettings>,
		);
		delete (this.settings as Record<string, unknown>).expandHumanizeZh;
		this.settings.wechatTheme = normalizeWechatTheme(this.settings.wechatTheme);
		this.settings.wechatCoverBgPreset = normalizeWechatCoverBgPreset(
			this.settings.wechatCoverBgPreset,
		);
		const coverFont = this.settings.wechatCoverTitleFontPx;
		if (!Number.isFinite(coverFont) || coverFont < 0) {
			this.settings.wechatCoverTitleFontPx = 0;
		} else if (coverFont > 0) {
			this.settings.wechatCoverTitleFontPx = Math.min(
				64,
				Math.max(24, Math.round(coverFont)),
			);
		}
		this.settings.xhsTheme = normalizeXhsTheme(this.settings.xhsTheme);
		if (typeof this.settings.xhsCoverEnabled !== "boolean") {
			this.settings.xhsCoverEnabled = DEFAULT_SETTINGS.xhsCoverEnabled;
		}
		if (typeof this.settings.xhsUseLXGWWenKai !== "boolean") {
			this.settings.xhsUseLXGWWenKai = DEFAULT_SETTINGS.xhsUseLXGWWenKai;
		}
		if (typeof this.settings.xhsFontTtfPath !== "string") {
			this.settings.xhsFontTtfPath = DEFAULT_SETTINGS.xhsFontTtfPath;
		}
		const egc = Number(this.settings.expandGzhTargetChars);
		this.settings.expandGzhTargetChars = Number.isFinite(egc)
			? Math.min(20000, Math.max(400, Math.round(egc)))
			: DEFAULT_SETTINGS.expandGzhTargetChars;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private scheduleCleanup(): void {
		const root = getPluginCacheRoot(this);
		const ttl = this.settings.cacheTtlHours * 3600_000;
		cleanupOldCacheDirs(root, ttl);
	}
}
