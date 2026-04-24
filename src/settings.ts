import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { WECHAT_THEME_OPTIONS, normalizeWechatTheme } from "./wechatHtml";
import {
	WECHAT_COVER_BG_PRESETS,
	normalizeWechatCoverBgPreset,
} from "./wechatCoverThumb";
import { XHS_THEME_OPTIONS, normalizeXhsTheme } from "./xhsThemes";

export type LlmProvider = "deepseek" | "zhipu" | "openai-compatible";

/** 公众号 / Baoyu 等插图生成后端 */
export type ImageGenerationProvider = "zhipu" | "volcengineArk";

export interface MdToPlatformSettings {
	llmProvider: LlmProvider;
	apiKey: string;
	/** 仅用于 CogView 插图；留空则复用 API Key（智谱时） */
	imageApiKey: string;
	/** 插图 API：智谱 CogView 或火山方舟 Seedream 等 */
	imageProvider: ImageGenerationProvider;
	/** 火山方舟 API Key（Bearer），与智谱 Key 独立 */
	volcengineArkApiKey: string;
	/** 方舟接入点，默认北京 */
	volcengineArkBaseUrl: string;
	/** 生图模型 ID，如 doubao-seedream-5-0-260128 */
	volcengineImageModel: string;
	/** 如 1K、2K，以方舟文档为准 */
	volcengineImageSize: string;
	/** 智谱 glm-image 等生图尺寸，如 1280x1280 */
	zhipuImageSize: string;
	/** 是否加水印（方舟参数 watermark） */
	volcengineImageWatermark: boolean;
	/** Seedance 等视频生成模型 ID */
	seedanceModel: string;
	baseUrl: string;
	textModel: string;
	imageModel: string;
	cacheTtlHours: number;
	cacheCleanupIntervalMinutes: number;
	wechatAppId: string;
	wechatAppSecret: string;
	/** 视频号分片上传 init 路径（相对 api.weixin.qq.com） */
	channelsVideoInitPath: string;
	/** 视频号分片上传 chunk 路径 */
	channelsVideoChunkPath: string;
	/** 每片字节数，默认 1MB */
	channelsVideoChunkSize: number;
	/** chunk 表单 media_type，与微信文档一致 */
	channelsVideoChunkMediaType: number;
	/** 公众号正文排版，键与开源 [huasheng_editor](https://github.com/alchaincyf/huasheng_editor) 样式一致 */
	wechatTheme: string;
	/**
	 * 公众号草稿封面缩略图：titleCard=插件生成的纯色背景居中标题图；firstImage=首张正文插图。
	 */
	wechatThumbSource: "titleCard" | "firstImage";
	/** 纯色标题封面背景预设 id，见 WECHAT_COVER_BG_PRESETS */
	wechatCoverBgPreset: string;
	/** 封面标题字号；0=按标题长度自动，否则为固定像素（24–64） */
	wechatCoverTitleFontPx: number;
	xhsDelimiter: string;
	xhsTheme: string;
	/** 与 Auto-Redbook 一致额外导出 cover.png（标题来自 publish_xhs 的「标题1」等，缺省时用首张卡片首行） */
	xhsCoverEnabled: boolean;
	/**
	 * 卡片/封面 PNG 使用 [霞鹜文楷 GB](https://github.com/lxgw/LxgwWenkaiGB)（插件目录 fonts/LXGWWenKaiGB-Regular.ttf）。
	 * 无文件时自动回退系统字体栈。
	 */
	xhsUseLXGWWenKai: boolean;
	/** 非空则优先使用该 TTF 绝对路径，覆盖默认 fonts/LXGWWenKaiGB-Regular.ttf */
	xhsFontTtfPath: string;
	xhsWidth: number;
	xhsHeight: number;
	xhsDpr: number;
	xhsDynamicHeight: boolean;
	xhsMaxHeight: number;
	/** 为 true 时卡片 PNG 存到「当前笔记所在目录/子文件夹」；false 时用插件 .cache */
	xhsSaveCardsNextToNote: boolean;
	/** 相对「当前笔记所在目录」的子文件夹名，如 xhs_cards、小红书卡片 */
	xhsSaveCardsSubfolder: string;
	xhsPublishEnabled: boolean;
	xhsHelperCommand: string;
	xhsHelperDryRun: boolean;
	rulesDirOverride: string;
	/** 扩写公众号稿时期望的正文规模（汉字量级，±约 15%）；写入 user 提示，与 rules 共同约束模型 */
	expandGzhTargetChars: number;
	/** 为 true 时在开发者工具控制台输出详细步骤，便于排查按钮不显示等问题 */
	debugLog: boolean;
	/** 在 Markdown 编辑窗格右下角显示 MDTP 简要说明 */
	showEditorMdtpTips: boolean;
	/**
	 * 启用「06-写作」式目录：01-Inbox 写作 → 02-Sanbox 临时 → 03-Published/gzh|xhs 终稿。
	 * 关闭则仍写入笔记同目录（旧行为）。
	 */
	useWritingWorkflowLayout: boolean;
	/** 工作流根目录（库内相对路径），如 06-写作 */
	workflowVaultRoot: string;
	/** Sandbox 文件夹名，如 02-Sanbox */
	folderSandbox: string;
	/** 发布根下的子文件夹名，其下自动使用 gzh、xhs，如 03-Published */
	folderPublished: string;
}

export const DEFAULT_SETTINGS: MdToPlatformSettings = {
	llmProvider: "deepseek",
	apiKey: "",
	imageApiKey: "",
	imageProvider: "zhipu",
	volcengineArkApiKey: "",
	volcengineArkBaseUrl: "https://ark.cn-beijing.volces.com",
	volcengineImageModel: "doubao-seedream-5-0-260128",
	volcengineImageSize: "2K",
	zhipuImageSize: "1280x1280",
	volcengineImageWatermark: true,
	seedanceModel: "doubao-seedance-1-5-pro-251215",
	baseUrl: "",
	textModel: "deepseek-chat",
	imageModel: "glm-image",
	cacheTtlHours: 72,
	cacheCleanupIntervalMinutes: 60,
	wechatAppId: "",
	wechatAppSecret: "",
	channelsVideoInitPath:
		"/channels/ec/basics/img/v1/upload/img/v1/resource/channels_ec/basics/img/v1/upload/init",
	channelsVideoChunkPath:
		"/channels/ec/basics/img/v1/upload/img/v1/resource/channels_ec/basics/img/v1/upload/chunk",
	channelsVideoChunkSize: 1048576,
	channelsVideoChunkMediaType: 1,
	wechatTheme: "wechat-default",
	wechatThumbSource: "titleCard",
	wechatCoverBgPreset: "mint",
	wechatCoverTitleFontPx: 0,
	xhsDelimiter: "^---\\s*$",
	xhsTheme: "default",
	xhsCoverEnabled: true,
	xhsUseLXGWWenKai: true,
	xhsFontTtfPath: "",
	xhsWidth: 1080,
	xhsHeight: 1440,
	/** 小红书笔记图建议逻辑宽 1080；DPR>1 会使 PNG 像素宽变为 1080×DPR，易被判为尺寸不符 */
	xhsDpr: 1,
	xhsDynamicHeight: false,
	xhsMaxHeight: 2160,
	xhsSaveCardsNextToNote: true,
	xhsSaveCardsSubfolder: "xhs_cards",
	xhsPublishEnabled: false,
	xhsHelperCommand: "",
	xhsHelperDryRun: true,
	rulesDirOverride: "",
	expandGzhTargetChars: 2000,
	debugLog: false,
	showEditorMdtpTips: false,
	useWritingWorkflowLayout: true,
	workflowVaultRoot: "06-写作",
	folderSandbox: "02-Sanbox",
	folderPublished: "03-Published",
};

interface MdPluginForSettings extends Plugin {
	settings: MdToPlatformSettings;
	saveSettings(): Promise<void>;
}

export class MdToPlatformSettingTab extends PluginSettingTab {
	plugin: MdPluginForSettings;

	constructor(app: App, plugin: MdPluginForSettings) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "MD to Platform" });

		new Setting(containerEl)
			.setName("控制台调试日志")
			.setDesc(
				"开启后在本库打开「开发者工具 → Console」可看到 [md-to-platform] 前缀的详细日志（排查工具栏按钮是否挂接）",
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.debugLog).onChange(async (v) => {
					this.plugin.settings.debugLog = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("在 Markdown 窗格显示 MDTP 提示条")
			.setDesc(
				"开启后，在打开笔记的编辑区左下角显示简要说明（状态栏入口、扩写/公众号/小红书要点等）；可点 × 临时关闭本条。放在左侧以免遮挡编辑区右下角字数等状态。",
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.showEditorMdtpTips).onChange(async (v) => {
					this.plugin.settings.showEditorMdtpTips = v;
					await this.plugin.saveSettings();
				}),
			);

		containerEl.createEl("h3", { text: "写作目录工作流" });

		new Setting(containerEl)
			.setName("启用 Sandbox / Published 目录布局")
			.setDesc(
				"开启：扩写在 02-Sanbox 写入 tmp、在 03-Published/gzh 与 xhs 写入终稿；公众号推送成功后清理 Sandbox 内公众号 tmp；小红书出图成功后清理 Sandbox 内小红书 tmp。关闭：文件仍写在当前笔记同目录。",
			)
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.useWritingWorkflowLayout)
					.onChange(async (v) => {
						this.plugin.settings.useWritingWorkflowLayout = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("工作流根目录（库内路径）")
			.setDesc("例如 06-写作，其下包含 01-Inbox、Sandbox、Published 等")
			.addText((t) =>
				t
					.setPlaceholder("06-写作")
					.setValue(this.plugin.settings.workflowVaultRoot)
					.onChange(async (v) => {
						this.plugin.settings.workflowVaultRoot = v.trim() || "06-写作";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sandbox 文件夹名")
			.setDesc("临时文件目录，如 02-Sanbox")
			.addText((t) =>
				t
					.setPlaceholder("02-Sanbox")
					.setValue(this.plugin.settings.folderSandbox)
					.onChange(async (v) => {
						this.plugin.settings.folderSandbox = v.trim() || "02-Sanbox";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Published 根文件夹名")
			.setDesc("其下使用 gzh、xhs 子目录存放终稿，如 03-Published")
			.addText((t) =>
				t
					.setPlaceholder("03-Published")
					.setValue(this.plugin.settings.folderPublished)
					.onChange(async (v) => {
						this.plugin.settings.folderPublished = v.trim() || "03-Published";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("LLM 提供商")
			.setDesc("文本扩写与转换使用的 API")
			.addDropdown((d) =>
				d
					.addOption("deepseek", "DeepSeek")
					.addOption("zhipu", "智谱 GLM")
					.addOption("openai-compatible", "OpenAI 兼容（自定义 Base URL）")
					.setValue(this.plugin.settings.llmProvider)
					.onChange(async (v) => {
						this.plugin.settings.llmProvider = v as LlmProvider;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("API Key")
			.setDesc("DeepSeek / 智谱等密钥")
			.addText((t) =>
				t
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (v) => {
						this.plugin.settings.apiKey = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("插图专用 Key（可选）")
			.setDesc("文本用 DeepSeek 时，可填智谱 Key 用于 CogView")
			.addText((t) =>
				t
					.setPlaceholder("智谱 API Key")
					.setValue(this.plugin.settings.imageApiKey)
					.onChange(async (v) => {
						this.plugin.settings.imageApiKey = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("插图生成渠道")
			.setDesc(
				"智谱 CogView：沿用上方「插图专用 Key」与下方图片模型。火山方舟：使用 Seedream 等模型，需填方舟 API Key（与智谱独立）。",
			)
			.addDropdown((d) =>
				d
					.addOption("zhipu", "智谱 CogView")
					.addOption("volcengineArk", "火山方舟（Seedream 等）")
					.setValue(this.plugin.settings.imageProvider)
					.onChange(async (v) => {
						this.plugin.settings.imageProvider =
							v === "volcengineArk" ? "volcengineArk" : "zhipu";
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.imageProvider === "volcengineArk") {
			new Setting(containerEl)
				.setName("火山方舟 API Key")
				.setDesc("Bearer Token，控制台创建接入点后复制；与智谱 Key 无关")
				.addText((t) =>
					t
						.setPlaceholder("方舟 API Key")
						.setValue(this.plugin.settings.volcengineArkApiKey)
						.onChange(async (v) => {
							this.plugin.settings.volcengineArkApiKey = v.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("方舟接入域名")
				.setDesc("默认 https://ark.cn-beijing.volces.com ，与其它区域以文档为准")
				.addText((t) =>
					t
						.setPlaceholder("https://ark.cn-beijing.volces.com")
						.setValue(this.plugin.settings.volcengineArkBaseUrl)
						.onChange(async (v) => {
							this.plugin.settings.volcengineArkBaseUrl = v.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("方舟生图模型 ID")
				.addText((t) =>
					t
						.setPlaceholder("doubao-seedream-5-0-260128")
						.setValue(this.plugin.settings.volcengineImageModel)
						.onChange(async (v) => {
							this.plugin.settings.volcengineImageModel =
								v.trim() || "doubao-seedream-5-0-260128";
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("生图尺寸（size）")
				.setDesc("如 1K、2K，以当前模型在方舟文档中的可选值为准")
				.addText((t) =>
					t
						.setPlaceholder("2K")
						.setValue(this.plugin.settings.volcengineImageSize)
						.onChange(async (v) => {
							this.plugin.settings.volcengineImageSize = v.trim() || "2K";
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("方舟生图水印")
				.setDesc("对应请求体字段 watermark")
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.volcengineImageWatermark)
						.onChange(async (v) => {
							this.plugin.settings.volcengineImageWatermark = v;
							await this.plugin.saveSettings();
						}),
				);
		}

		containerEl.createEl("h3", { text: "Seedance 视频（火山方舟）" });
		new Setting(containerEl)
			.setName("Seedance 模型 ID")
			.setDesc(
				"用于「提交 Seedance 视频任务」命令；与插图 Seedream 模型独立。需已配置上方火山方舟 API Key（插图渠道选方舟时填写的同一 Key 即可）。",
			)
			.addText((t) =>
				t
					.setPlaceholder("doubao-seedance-1-5-pro-251215")
					.setValue(this.plugin.settings.seedanceModel)
					.onChange(async (v) => {
						this.plugin.settings.seedanceModel =
							v.trim() || "doubao-seedance-1-5-pro-251215";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("自定义 Base URL（可选）")
			.setDesc("OpenAI 兼容模式必填；其他留空用默认端点")
			.addText((t) =>
				t
					.setPlaceholder("https://api.openai.com/v1")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (v) => {
						this.plugin.settings.baseUrl = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("文本模型")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.textModel)
					.onChange(async (v) => {
						this.plugin.settings.textModel = v.trim() || "deepseek-chat";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("图片模型（智谱生图）")
			.setDesc(
				this.plugin.settings.imageProvider === "volcengineArk"
					? "当前插图渠道为火山方舟时此项不使用；见下方方舟模型 ID"
					: "智谱 open.bigmodel.cn v4 images/generations，默认 glm-image",
			)
			.addText((t) =>
				t
					.setPlaceholder("glm-image")
					.setValue(this.plugin.settings.imageModel)
					.onChange(async (v) => {
						this.plugin.settings.imageModel = v.trim() || "glm-image";
						await this.plugin.saveSettings();
					}),
			);

		if (this.plugin.settings.imageProvider === "zhipu") {
			new Setting(containerEl)
				.setName("智谱生图尺寸（size）")
				.setDesc("glm-image 等模型使用的宽高，如 1280x1280，以智谱文档为准")
				.addText((t) =>
					t
						.setPlaceholder("1280x1280")
						.setValue(this.plugin.settings.zhipuImageSize)
						.onChange(async (v) => {
							this.plugin.settings.zhipuImageSize = v.trim() || "1280x1280";
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName("缓存过期（小时）")
			.setDesc("超过此时长的 .cache 子目录会被清理")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.cacheTtlHours))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						this.plugin.settings.cacheTtlHours = Number.isFinite(n) && n > 0 ? n : 72;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("自动清理间隔（分钟）")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.cacheCleanupIntervalMinutes))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						this.plugin.settings.cacheCleanupIntervalMinutes =
							Number.isFinite(n) && n > 0 ? n : 60;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "公众号" });

		new Setting(containerEl)
			.setName("AppID")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.wechatAppId)
					.onChange(async (v) => {
						this.plugin.settings.wechatAppId = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("AppSecret")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.wechatAppSecret)
					.onChange(async (v) => {
						this.plugin.settings.wechatAppSecret = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("排版主题")
			.setDesc(
				"内置 [花生编辑器](https://github.com/alchaincyf/huasheng_editor) 同源样式（全内联 CSS，多图自动转表格排版）。微信后台对字体、渐变、阴影等支持不完整，若与本地预览略有差异属正常，可换主题多试。",
			)
			.addDropdown((d) => {
				for (const { id, name } of WECHAT_THEME_OPTIONS) {
					d.addOption(id, name);
				}
				return d
					.setValue(normalizeWechatTheme(this.plugin.settings.wechatTheme))
					.onChange(async (v) => {
						this.plugin.settings.wechatTheme = v;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("草稿封面缩略图")
			.setDesc(
				"纯色标题卡：柔和底色 + 居中标题文字。首张正文插图：有插图时使用第一张；无插图时与纯色卡相同，会用语义色卡作封面。",
			)
			.addDropdown((d) =>
				d
					.addOption("titleCard", "纯色背景 + 居中标题（推荐）")
					.addOption("firstImage", "使用首张正文插图")
					.setValue(this.plugin.settings.wechatThumbSource)
					.onChange(async (v) => {
						this.plugin.settings.wechatThumbSource =
							v === "firstImage" ? "firstImage" : "titleCard";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("纯色封面 · 背景色")
			.setDesc("仅在使用「纯色背景 + 居中标题」时生效。")
			.addDropdown((d) => {
				for (const p of WECHAT_COVER_BG_PRESETS) {
					d.addOption(p.id, `${p.name}（${p.bg}）`);
				}
				return d
					.setValue(
						normalizeWechatCoverBgPreset(this.plugin.settings.wechatCoverBgPreset),
					)
					.onChange(async (v) => {
						this.plugin.settings.wechatCoverBgPreset = v;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("纯色封面 · 标题字号（像素）")
			.setDesc("填 0 表示按标题长度自动；固定字号时建议 32–44，范围 24–64。")
			.addText((t) =>
				t
					.setPlaceholder("0")
					.setValue(
						this.plugin.settings.wechatCoverTitleFontPx === 0
							? ""
							: String(this.plugin.settings.wechatCoverTitleFontPx),
					)
					.onChange(async (v) => {
						const trimmed = v.trim();
						if (trimmed === "") {
							this.plugin.settings.wechatCoverTitleFontPx = 0;
						} else {
							const n = parseInt(trimmed, 10);
							if (!Number.isFinite(n) || n <= 0) {
								this.plugin.settings.wechatCoverTitleFontPx = 0;
							} else {
								this.plugin.settings.wechatCoverTitleFontPx = Math.min(
									64,
									Math.max(24, Math.round(n)),
								);
							}
						}
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h4", { text: "视频号 · 视频分片上传" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "access_token 与上方公众号共用同一组 AppID / AppSecret。本插件仅实现文档中的 init 与 chunk；若另有「完结/提交」类接口，需在拿到 upload_id 后按官方流程继续调用。",
		});
		new Setting(containerEl)
			.setName("init 接口路径")
			.setDesc(
				"相对 https://api.weixin.qq.com ，与开放平台文档一致时可修改。默认按常见 channels_ec 上传地址填写。",
			)
			.addText((t) =>
				t
					.setValue(this.plugin.settings.channelsVideoInitPath)
					.onChange(async (v) => {
						this.plugin.settings.channelsVideoInitPath = v.trim() || "/";
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("chunk 接口路径")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.channelsVideoChunkPath)
					.onChange(async (v) => {
						this.plugin.settings.channelsVideoChunkPath = v.trim() || "/";
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("分片大小（字节）")
			.setDesc("默认 1048576（1MB），过大可能被网关拒绝，以文档为准")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.channelsVideoChunkSize))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						this.plugin.settings.channelsVideoChunkSize =
							Number.isFinite(n) && n >= 65536 ? n : 1048576;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("chunk 的 media_type")
			.setDesc("与表单字段一致，默认 1")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.channelsVideoChunkMediaType))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						this.plugin.settings.channelsVideoChunkMediaType =
							Number.isFinite(n) ? n : 1;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "小红书" });

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "导出 PNG 只依赖 xhs_content.md；publish_xhs.md 仅在下方「发布命令」非空且开启「启用外部发布脚本」时使用。",
		});

		new Setting(containerEl)
			.setName("卡片分隔（正则）")
			.setDesc("默认匹配单独一行的 ---，用于拆分多张卡片正文")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.xhsDelimiter)
					.onChange(async (v) => {
						this.plugin.settings.xhsDelimiter = v.trim() || "^---\\s*$";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("卡片主题")
			.setDesc("8 套主题皮肤")
			.addDropdown((d) => {
				for (const { id, name } of XHS_THEME_OPTIONS) {
					d.addOption(id, name);
				}
				return d
					.setValue(normalizeXhsTheme(this.plugin.settings.xhsTheme))
					.onChange(async (v) => {
						this.plugin.settings.xhsTheme = v;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("同时生成封面 cover.png")
			.setDesc(
				"版式参考 Auto-Redbook「封面 + 正文卡」：标题取自 publish_xhs.md「标题1：」等，无则取首张卡片首行。上传时建议封面为第一图。",
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.xhsCoverEnabled).onChange(async (v) => {
					this.plugin.settings.xhsCoverEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("卡片使用霞鹜文楷 GB")
			.setDesc(
				"需在插件目录 fonts/LXGWWenKaiGB-Regular.ttf（可 npm run vendor:wenkai），或填写下方绝对路径。SIL OFL 1.1。缺失时回退系统黑体。",
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.xhsUseLXGWWenKai).onChange(async (v) => {
					this.plugin.settings.xhsUseLXGWWenKai = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("小红书卡片字体 TTF（可选）")
			.setDesc("留空则用插件 fonts/LXGWWenKaiGB-Regular.ttf；填写本机 .ttf 绝对路径可覆盖。")
			.addText((t) =>
				t
					.setPlaceholder("/path/to/LXGWWenKaiGB-Regular.ttf")
					.setValue(this.plugin.settings.xhsFontTtfPath)
					.onChange(async (v) => {
						this.plugin.settings.xhsFontTtfPath = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("宽度 / 高度 / DPR")
			.setDesc(
				"小红书常见推荐 3:4（如 1080×1440）。DPR 为导出像素倍率：设为 1 时 PNG 宽≈宽度；大于 1 会成比例变宽，易与平台建议尺寸不一致。",
			)
			.addText((t) => {
				t.setValue(String(this.plugin.settings.xhsWidth)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n > 0) {
						this.plugin.settings.xhsWidth = n;
						await this.plugin.saveSettings();
					}
				});
			})
			.addText((t) => {
				t.setValue(String(this.plugin.settings.xhsHeight)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n > 0) {
						this.plugin.settings.xhsHeight = n;
						await this.plugin.saveSettings();
					}
				});
			})
			.addText((t) => {
				t.setValue(String(this.plugin.settings.xhsDpr)).onChange(async (v) => {
					const n = parseFloat(v);
					if (Number.isFinite(n) && n > 0) {
						this.plugin.settings.xhsDpr = n;
						await this.plugin.saveSettings();
					}
				});
			});

		new Setting(containerEl)
			.setName("动态高度")
			.setDesc("按内容增高（上限见 maxHeight）")
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.xhsDynamicHeight).onChange(async (v) => {
					this.plugin.settings.xhsDynamicHeight = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("动态高度上限（px）")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.xhsMaxHeight))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						if (Number.isFinite(n) && n > 0) {
							this.plugin.settings.xhsMaxHeight = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("卡片图保存到笔记同目录")
			.setDesc(
				"开启：PNG 写入「当前笔记所在文件夹/下方子文件夹名」。关闭：仍写入插件 .cache（旧行为，便于外部脚本固定路径）",
			)
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.xhsSaveCardsNextToNote)
					.onChange(async (v) => {
						this.plugin.settings.xhsSaveCardsNextToNote = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("同目录下子文件夹名")
			.setDesc("仅当上一项开启时生效；勿使用 .. ；可用多级如 assets/xhs")
			.addText((t) =>
				t
					.setPlaceholder("xhs_cards")
					.setValue(this.plugin.settings.xhsSaveCardsSubfolder)
					.onChange(async (v) => {
						this.plugin.settings.xhsSaveCardsSubfolder = v.trim() || "xhs_cards";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("启用外部发布脚本")
			.setDesc(
				"开启且「发布命令」非空时，渲染完 PNG 后执行脚本，并需能定位 publish_xhs.md。仅导出图片可不开启。",
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.xhsPublishEnabled).onChange(async (v) => {
					this.plugin.settings.xhsPublishEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("发布命令")
			.setDesc(
				"例如：node /path/to/publish.js。会传 MDT_XHS_IMAGES_DIR、MDT_PUBLISH_XHS（publish_xhs.md 绝对路径）、MDT_VAULT_ROOT。留空则只生成 PNG，不执行脚本。",
			)
			.addText((t) =>
				t
					.setPlaceholder("node .../publish_xhs.js")
					.setValue(this.plugin.settings.xhsHelperCommand)
					.onChange(async (v) => {
						this.plugin.settings.xhsHelperCommand = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Dry-run（不实际发布）")
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.xhsHelperDryRun).onChange(async (v) => {
					this.plugin.settings.xhsHelperDryRun = v;
					await this.plugin.saveSettings();
				}),
			);

		containerEl.createEl("h3", { text: "规则文件" });

		new Setting(containerEl)
			.setName("公众号扩写目标字数（汉字）")
			.setDesc(
				"会写入扩写请求的 user 提示，与「公众号扩写规则.md」一起约束篇幅（模型仍可能偏差）。默认 2000；若规则文件里另有字数要求，以二者中更严格者为准。",
			)
			.addText((t) =>
				t
					.setPlaceholder("2000")
					.setValue(String(this.plugin.settings.expandGzhTargetChars))
					.onChange(async (v) => {
						const n = parseInt(v.trim(), 10);
						this.plugin.settings.expandGzhTargetChars = Number.isFinite(n)
							? Math.min(20000, Math.max(400, n))
							: DEFAULT_SETTINGS.expandGzhTargetChars;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("规则目录覆盖（可选）")
			.setDesc(
				"留空则使用「库/.obsidian/plugins/md-to-platform/rules」。可填绝对路径，或相对于库根的路径（如 rules 表示库内 rules 文件夹）",
			)
			.addText((t) =>
				t
					.setValue(this.plugin.settings.rulesDirOverride)
					.onChange(async (v) => {
						this.plugin.settings.rulesDirOverride = v.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
