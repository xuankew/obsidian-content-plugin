import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { WECHAT_THEME_OPTIONS, normalizeWechatTheme } from "./wechatHtml";
import {
	WECHAT_COVER_BG_PRESETS,
	normalizeWechatCoverBgPreset,
} from "./wechatCoverThumb";
import { XHS_THEME_OPTIONS, normalizeXhsTheme } from "./xhsThemes";
import { getXhsEnvStatus, ensureXhsVenvInstalled } from "./xhsEnv";
import {
	parseVideoTtsUserConfigJson,
	patchVideoTtsUserConfig,
	toVideoTtsConfigJsonString,
} from "./videoTtsUserConfig";

/** 折叠区块：不设置 open，默认收起 */
function mdtpSettingsSection(
	parent: HTMLElement,
	summary: string,
	description: string,
): HTMLElement {
	const d = parent.createEl("details", { cls: "mdtp-settings-details" });
	d.createEl("summary", { text: summary, cls: "mdtp-settings-summary" });
	if (description) {
		d.createEl("p", { cls: "setting-item-description", text: description });
	}
	return d;
}

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
	/**
	 * 供外部发布脚本使用（如 Playwright 登录态）。插件通过环境变量 MDT_XHS_COOKIE 传入，勿提交到仓库。
	 */
	xhsCookie: string;
	/**
	 * 为 true 时向子进程传 MDT_XHS_AS_PRIVATE=1，供自定义脚本设仅自己可见；插件本身不调用小红书官方 API。
	 */
	xhsPublishAsPrivate: boolean;
	/**
	 * 「发布小红书」渲染完成后，将 card_*.png 同步为公众号草稿中的图片消息（newspic），与公众号长文图文草稿不同。
	 */
	xhsWechatNewspicDraft: boolean;
	/**
	 * 未填写「发布命令」时，若开启则自动使用插件目录下 `scripts/publish_xhs_redbook.py`（需本机 Python 3 与 pip 依赖）。
	 */
	xhsUseBundledRedbookPublish: boolean;
	/**
	 * 无自定义命令且启用「内置发布脚本」时：`api` 使用 `publish_xhs_redbook.py`（依赖 Cookie/签名）；
	 * `playwright` 使用 `publish_xhs_playwright.py`（浏览器登录态，不依赖 MDT_XHS_COOKIE）。
	 */
	xhsPublishMode: "api" | "playwright";
	/** Playwright 是否显示浏览器窗口（有头） */
	xhsPlaywrightHeaded: boolean;
	/** 发布失败时尽量保留浏览器/连接，便于手动处理 */
	xhsPlaywrightKeepOpenOnError: boolean;
	/** 自动填表后由用户自己点击发布（半自动） */
	xhsPlaywrightManualFinalClick: boolean;
	/** 持久化用户数据子目录名，见 `.obsidian/mdtp/xhs_playwright/<name>` */
	xhsPlaywrightProfileName: string;
	/**
	 * 用于执行 `publish_xhs_redbook.py` 的 Python 可执行文件绝对路径（如 Apple Silicon 常填 `/opt/homebrew/bin/python3`）。
	 * 留空则自动尝试该路径、再退回 `python3`；图形界面启动的 Obsidian 常找不到你在终端里 pip 装包的那个解释器，填此可一次对齐。
	 */
	xhsPythonPath: string;
	/** 发布小红书前若依赖未装，自动尝试创建 venv 并安装（联网 pip） */
	xhsAutoInstallDeps: boolean;
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
	/** 扩写第 3 步：按 gzh_to_vedio.md 生成 video_script.md + video_config.json */
	videoScriptEnabled: boolean;
	/** 目标口播时长（秒），写入 user 提示与 JSON 元信息 */
	videoTargetSeconds: number;
	/** 默认账号展示名，可与 video_config 中 accountInfo 合并 */
	videoAccountInfo: string;
	/** TTS：edge=Edge 免费神经音；listenhub=ListenHub（需 API，脚本内对接） */
	videoTtsEngine: "edge" | "listenhub";
	/** JSON：含 edge.listenhub 等子配置，与计划中的结构一致 */
	videoTtsConfigJson: string;
	/** 本机 ffmpeg 可执行文件绝对路径；留空则从 PATH 查找 */
	videoFfmpegPath: string;
	/** 执行 render_video.py 的 python；留空则回退「小红书 Python」或系统 python3 */
	videoPythonPath: string;
	/**
	 * 合成成功后：用本机 Playwright 打开抖音创作平台并上传/发布 `douyin.mp4`（需 venv 已装 playwright 且浏览器已登录；见 `.obsidian/mdtp/douyin_playwright`）。
	 */
	videoUploadDouyin: boolean;
	/**
	 * 与抖音/视频号共用的 **profile 子目录名**（`…/mdtp/douyin_playwright/<名>` 与 `channels_playwright/<名>`；小红书仍用「小红书」里单独子目录）。
	 */
	videoPlaywrightProfileName: string;
	videoUploadXiaohongshu: boolean;
	videoUploadGongzhonghao: boolean;
	/** 合成成功后：Playwright 打开视频号「发表」页并上传 `shipinhao.mp4`（与公众号分片上传命令不同）。 */
	videoUploadShipinhao: boolean;
	/** 合成时叠加背景音乐；关则仅口播+静默段 */
	videoBgmEnabled: boolean;
	/**
	 * 背景音乐文件：绝对路径，或相对**插件根目录**（如 resource/mp3/歌名.mp3）。
	 * 留空则使用插件内 `resource/mp3/65歌曲.mp3`（若存在）。
	 */
	videoBgmPath: string;
	/**
	 * 混音时 BGM 的线性音量系数（口播/静默为 1.0）。推荐约 0.10–0.20，值越小越不抢主声。
	 */
	videoBgmVolume: number;
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
	xhsCookie: "",
	xhsPublishAsPrivate: true,
	xhsWechatNewspicDraft: false,
	xhsUseBundledRedbookPublish: true,
	xhsPublishMode: "api",
	xhsPlaywrightHeaded: true,
	xhsPlaywrightKeepOpenOnError: true,
	xhsPlaywrightManualFinalClick: false,
	xhsPlaywrightProfileName: "default",
	xhsPythonPath: "",
	xhsAutoInstallDeps: true,
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
	videoScriptEnabled: true,
	videoTargetSeconds: 30,
	videoAccountInfo: "玄柯父母说",
	videoTtsEngine: "edge",
	videoTtsConfigJson: toVideoTtsConfigJsonString(
		{
			engine: "edge",
			edge: { voice: "zh-CN-YunxiNeural" },
			listenhub: {
				apiKey: "",
				voice: "CN-Man-Beijing-V2",
				model: "flowtts",
			},
		},
		true,
	),
	videoFfmpegPath: "",
	videoPythonPath: "",
	videoUploadDouyin: false,
	videoPlaywrightProfileName: "default",
	videoUploadXiaohongshu: false,
	videoUploadGongzhonghao: false,
	videoUploadShipinhao: false,
	videoBgmEnabled: true,
	videoBgmPath: "",
	videoBgmVolume: 0.14,
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
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "各分区默认折叠。建议按编号顺序展开：0 环境变量与 Python → 1 工作流 → 2 短视频 → 3 模型与 key → 4 公众号 → 5 小红书 → 6 规则与调试。",
		});

		const xhsCmd = this.plugin.settings.xhsHelperCommand.trim();
		/** 非 Python 自定义命令时不必展示 venv 与一键安装，减少干扰 */
		const xhsShowPythonVenv =
			!xhsCmd || /python|\.py(\s|$)|pip|xhs_venv|\/venv\//i.test(xhsCmd);
		const s0Env = mdtpSettingsSection(
			containerEl,
			"0 · 环境变量与 Python",
			"解释器、库内 venv、一键安装 xhs / Playwright / 短视频（edge-tts、Pillow 等），与「发布小红书」与「生成短视频」共用。FFmpeg 需本机安装，或在「2 · 短视频」中配置路径。",
		);
		if (xhsShowPythonVenv) {
			new Setting(s0Env)
				.setName("Python 解释器（写内置或 .py 发布命令、合成短视频时）")
				.setDesc(
					"使用内置 xhs/Playwright 脚本或 `…publish_xhs_….py`、及未单独指定「视频合成 Python」时填写可执行 `python3` 绝对路径。`npm run bundle:xhs-embed` 时插件可自动 PYTHONPATH。留空时 mac 会试 Homebrew 路径；若已用下方一键安装，会优先用库内 xhs_venv。",
				)
				.addText((t) =>
					t
						.setPlaceholder("…/xhs_venv/bin/python3")
						.setValue(this.plugin.settings.xhsPythonPath)
						.onChange(async (v) => {
							this.plugin.settings.xhsPythonPath = v.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(s0Env)
				.setName("发布/合成前自动安装依赖")
				.setDesc(
					"首次在库内建 `.obsidian/mdtp/xhs_venv` 并 pip 安装 xhs、playwright、短视频（edge-tts、Pillow）等；Playwright 还会尝试下载 Chromium。关则用手动「安装/修复」。",
				)
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.xhsAutoInstallDeps)
						.onChange(async (v) => {
							this.plugin.settings.xhsAutoInstallDeps = v;
							await this.plugin.saveSettings();
						}),
				);

			const envInfo = s0Env.createEl("p", {
				cls: "setting-item-description",
				text: "发布与短视频 Python 环境：正在检测…",
			});
			void (async () => {
				try {
					const st = await getXhsEnvStatus(
						this.plugin,
						this.plugin.settings.xhsPythonPath,
					);
					const py =
						st.python?.ok
							? `${st.python.executable}（${st.python.version}）`
							: "未检测到可用 Python 3";
					const venv = st.hasVenv ? "已创建" : "未创建";
					const xhsOk = st.canImportXhs ? "OK" : "缺少 xhs";
					const pwOk = st.canImportPlaywright ? "OK" : "未装 playwright";
					const vidOk = st.canImportVideoDeps ? "OK" : "未装短视频 pip 包";
					envInfo.textContent =
						`发布与短视频环境：Python=${py}；venv=${venv}（${st.venvDir}）；xhs=${xhsOk}；playwright=${pwOk}；短视频=${vidOk}`;
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					envInfo.textContent = `发布与短视频环境：检测失败：${msg}`;
				}
			})();

			new Setting(s0Env)
				.setName("一键安装/修复（xhs + playwright + 短视频）")
				.setDesc(
					"联网。含 edge-tts、Pillow；FFmpeg 需本机已装并在 PATH 或「2 · 短视频」里配置。完成后可再试「发布小红书」与短视频合成。",
				)
				.addButton((b) =>
					b.setButtonText("安装/修复").onClick(async () => {
						new Notice("开始安装/修复 xhs、playwright 与短视频 pip 包…", 6000);
						try {
							await ensureXhsVenvInstalled(
								this.plugin,
								this.plugin.settings.xhsPythonPath,
								{
									onLog: (s) => console.info("[md-to-platform] xhs env", s),
								},
							);
							new Notice(
								"依赖已安装/修复：xhs/Playwright/短视频（pip），可在「发布小红书」与短视频流程中使用",
								8000,
							);
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							new Notice(`安装失败：${msg}（详见 Console）`, 12000);
							console.error("[md-to-platform] xhs env install failed", e);
						} finally {
							this.display();
						}
					}),
				);
		}

		const s1Workflow = mdtpSettingsSection(
			containerEl,
			"1 · 写作目录与工作流",
			"控制 Sandbox / Published 等库内布局，影响扩写与终稿落盘。",
		);
		new Setting(s1Workflow)
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

		new Setting(s1Workflow)
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

		new Setting(s1Workflow)
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

		new Setting(s1Workflow)
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

		{
			const vd = mdtpSettingsSection(
				containerEl,
				"2 · 短视频：扩写脚本、TTS、本地合成与上传",
				"扩写第 3 次按 rules/gzh_to_vedio.md 写 video_script / video_config（含各平台 `publish_title` / `publish_description`）。「生成短视频」输出各平台 mp4 与 `video_publish_copies.md`。下方开启后会在本机用 **Playwright + 已登录浏览器** 依次打开发布页（非微信 API）；公众号视频仍预留。视频号 **API 分片上传** 见命令「MDTP：视频号视频分片上传」。需 venv 中的 playwright、本机 ffmpeg。",
			);
			new Setting(vd)
				.setName("抖音/视频号 Playwright 子目录名")
				.setDesc(
					"用于 `…/mdtp/douyin_playwright/<名>` 与 `channels_playwright/<名>` 的登录态；与小红书「Playwright 子目录」独立。",
				)
				.addText((t) =>
					t
						.setPlaceholder("default")
						.setValue(this.plugin.settings.videoPlaywrightProfileName)
						.onChange(async (v) => {
							this.plugin.settings.videoPlaywrightProfileName =
								v.replace(/[/\\]/g, "").trim() || "default";
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("合成完成后：Playwright 发布到抖音")
				.setDesc("上传同目录 `douyin.mp4`，标题/描述取自 `video_config` 对应字段。需事先在 Chrome 中登录抖音创作平台。默认关。")
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.videoUploadDouyin)
						.onChange(async (v) => {
							this.plugin.settings.videoUploadDouyin = v;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("合成完成后：上传视频到小红书")
				.setDesc(
					"Playwright 上传 `xiaohongshu.mp4` 到「上传视频」；文案同 `video_config` 中小红书区。需已装 playwright 且创作平台已登录。默认关。",
				)
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.videoUploadXiaohongshu)
						.onChange(async (v) => {
							this.plugin.settings.videoUploadXiaohongshu = v;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("合成完成后：上传视频到公众号")
				.setDesc("预留（公众号视频素材 API 未接好前不生效）。默认关。")
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.videoUploadGongzhonghao)
						.onChange(async (v) => {
							this.plugin.settings.videoUploadGongzhonghao = v;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("合成完成后：Playwright 发布到视频号")
				.setDesc(
					"网页「发表」流程上传 `shipinhao.mp4`（与需 AppID/Secret 的**分片上传命令**是两条路）。需浏览器已登录 channels.weixin.qq.com。默认关。",
				)
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.videoUploadShipinhao)
						.onChange(async (v) => {
							this.plugin.settings.videoUploadShipinhao = v;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("扩写时同步生成视频脚本")
				.setDesc("会多一次 LLM 与规则文件；关闭则只生成公众号 + 小红书 md。")
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.videoScriptEnabled)
						.onChange(async (v) => {
							this.plugin.settings.videoScriptEnabled = v;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("目标口播时长（秒）")
				.setDesc("写入提示词，口播以约此长度为参考。")
				.addText((t) =>
					t
						.setValue(String(this.plugin.settings.videoTargetSeconds))
						.onChange(async (v) => {
							const n = parseInt(v.trim(), 10);
							this.plugin.settings.videoTargetSeconds =
								Number.isFinite(n) && n >= 10 && n <= 120 ? n : 30;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("默认账号展示名")
				.setDesc("若模型未写 accountInfo，会合并为 video_config 默认值。")
				.addText((t) =>
					t
						.setValue(this.plugin.settings.videoAccountInfo)
						.onChange(async (v) => {
							this.plugin.settings.videoAccountInfo = v.trim() || "账号";
							await this.plugin.saveSettings();
						}),
				);
			(() => {
				const tts0 = parseVideoTtsUserConfigJson(
					this.plugin.settings.videoTtsConfigJson,
				);
				new Setting(vd)
					.setName("TTS 引擎（实际使用）")
					.setDesc(
						"决定合成短视频时用 edge-tts 还是 ListenHub。ListenHub 使用官方 OpenAPI `POST /v1/tts`（需在下方填写 API Key）。JSON 里 `engine` 会与此项同步。",
					)
					.addDropdown((d) =>
						d
							.addOption("edge", "edge-tts（免费、需外网）")
							.addOption("listenhub", "ListenHub（API Key + 模型）")
							.setValue(
								this.plugin.settings.videoTtsEngine === "listenhub"
									? "listenhub"
									: "edge",
							)
							.onChange(async (v) => {
								const engine: "edge" | "listenhub" =
									v === "listenhub" ? "listenhub" : "edge";
								this.plugin.settings.videoTtsEngine = engine;
								this.plugin.settings.videoTtsConfigJson =
									patchVideoTtsUserConfig(
										this.plugin.settings.videoTtsConfigJson,
										{ engine },
									);
								await this.plugin.saveSettings();
								this.display();
							}),
					);
				new Setting(vd)
					.setName("Edge-tts：神经语音 / voice")
					.setDesc("对应配置 JSON 中 `edge.voice`（如 zh-CN-YunxiNeural）。")
					.addText((t) => {
						t.setPlaceholder("zh-CN-YunxiNeural")
							.setValue(tts0.edge.voice)
							.onChange(async (v) => {
								this.plugin.settings.videoTtsConfigJson =
									patchVideoTtsUserConfig(
										this.plugin.settings.videoTtsConfigJson,
										{ edgeVoice: v },
									);
								await this.plugin.saveSettings();
							});
					});
				new Setting(vd)
					.setName("ListenHub：API Key")
					.setDesc("对应 `listenhub.apiKey`；勿将密钥写入公开笔记或仓库。")
					.addText((t) => {
						t.inputEl.type = "password";
						t.setPlaceholder("lh_sk_…")
							.setValue(tts0.listenhub.apiKey)
							.onChange(async (v) => {
								this.plugin.settings.videoTtsConfigJson =
									patchVideoTtsUserConfig(
										this.plugin.settings.videoTtsConfigJson,
										{ listenhubApiKey: v },
									);
								await this.plugin.saveSettings();
							});
					});
				new Setting(vd)
					.setName("ListenHub：语音 / voice")
					.setDesc("如 CN-Man-Beijing-V2，对应 `listenhub.voice`。")
					.addText((t) => {
						t.setPlaceholder("CN-Man-Beijing-V2")
							.setValue(tts0.listenhub.voice)
							.onChange(async (v) => {
								this.plugin.settings.videoTtsConfigJson =
									patchVideoTtsUserConfig(
										this.plugin.settings.videoTtsConfigJson,
										{ listenhubVoice: v },
									);
								await this.plugin.saveSettings();
							});
					});
				new Setting(vd)
					.setName("ListenHub：模型 / model")
					.setDesc("如 flowtts，对应 `listenhub.model`；以服务商文档为准。")
					.addText((t) => {
						t.setPlaceholder("flowtts")
							.setValue(tts0.listenhub.model)
							.onChange(async (v) => {
								this.plugin.settings.videoTtsConfigJson =
									patchVideoTtsUserConfig(
										this.plugin.settings.videoTtsConfigJson,
										{ listenhubModel: v },
									);
								await this.plugin.saveSettings();
							});
					});
				const adv = vd.createEl("details", { cls: "mdtp-settings-details" });
				adv.createEl("summary", {
					text: "高级：完整 TTS 配置（JSON）",
					cls: "mdtp-settings-summary",
				});
				adv.createEl("p", {
					cls: "setting-item-description",
					text: "与上方表单项是同一份数据。可整段粘贴你已有的配置；保存后会校验并规范化。`engine` 与「TTS 引擎」一致。",
				});
				new Setting(adv)
					.setName("JSON 原文")
					.addTextArea((ta) => {
						ta.setValue(this.plugin.settings.videoTtsConfigJson).onChange(
							async (v) => {
								const raw = v;
								try {
									JSON.parse(raw);
								} catch {
									new Notice("TTS 配置不是合法 JSON，已放弃保存", 5000);
									return;
								}
								const c = parseVideoTtsUserConfigJson(raw);
								this.plugin.settings.videoTtsEngine = c.engine;
								this.plugin.settings.videoTtsConfigJson =
									toVideoTtsConfigJsonString(c, true);
								await this.plugin.saveSettings();
								this.display();
							},
						);
						ta.inputEl.rows = 10;
						ta.inputEl.style.width = "100%";
					});
			})();
			new Setting(vd)
				.setName("FFmpeg 路径（可选）")
				.setDesc(
					"可填**可执行文件**绝对路径（如 …/bin/ffmpeg）或**目录**（该目录下需有 ffmpeg；若有 ffprobe 会优先用来测时长，否则脚本会改用 ffmpeg 解析）。留空时依次试 PATH 与常见 Homebrew 路径。",
				)
				.addText((t) =>
					t
						.setPlaceholder("/opt/homebrew/bin/ffmpeg")
						.setValue(this.plugin.settings.videoFfmpegPath)
						.onChange(async (v) => {
							this.plugin.settings.videoFfmpegPath = v.trim();
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("视频合成 Python（可选）")
				.setDesc(
					"执行 scripts/render_video.py。留空时顺序为：库内 xhs_venv（与「0 · 一键安装/修复」相同，需含 Pillow；存在则优先生效）→「0 · 小红书 Python」→ 系统 python3。若本机与 venv 各有一套解释器，建议留空以使用 venv。",
				)
				.addText((t) =>
					t
						.setPlaceholder("与 xhs_venv 或本机一致")
						.setValue(this.plugin.settings.videoPythonPath)
						.onChange(async (v) => {
							this.plugin.settings.videoPythonPath = v.trim();
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("叠加背景音乐")
				.setDesc(
					"开启后与口播、片头片尾无声段混音；人声音量优先，BGM 为衬底。文件不存在时自动跳过。",
				)
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.videoBgmEnabled)
						.onChange(async (v) => {
							this.plugin.settings.videoBgmEnabled = v;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vd)
				.setName("背景音乐文件（可选）")
				.setDesc(
					"绝对路径，或相对插件根目录，如 `resource/mp3/65歌曲.mp3`。留空则默认使用同目录下 `65歌曲.mp3`（你放入 resource/mp3 的 mp3 可在此填写文件名）。",
				)
				.addText((t) => {
					t.setPlaceholder("留空=resource/mp3/65歌曲.mp3")
						.setValue(this.plugin.settings.videoBgmPath)
						.onChange(async (v) => {
							this.plugin.settings.videoBgmPath = v;
							await this.plugin.saveSettings();
						});
				});
			new Setting(vd)
				.setName("背景音量（衬底，相对口播 1.0）")
				.setDesc("推荐 0.10～0.20；越大伴奏越明显，越小越不抢人说话。")
				.addText((t) =>
					t
						.setPlaceholder("0.14")
						.setValue(String(this.plugin.settings.videoBgmVolume))
						.onChange(async (v) => {
							const n = parseFloat(v.trim().replace(/,/g, "."));
							this.plugin.settings.videoBgmVolume =
								Number.isFinite(n) && n > 0
									? Math.min(0.45, Math.max(0.04, n))
									: DEFAULT_SETTINGS.videoBgmVolume;
							await this.plugin.saveSettings();
						}),
				);
		}

		const s3Llm = mdtpSettingsSection(
			containerEl,
			"3 · LLM、插图、Seedance 与缓存",
			"文本扩写、生图、Seedance 视频任务与 .cache 自动清理。",
		);
		new Setting(s3Llm)
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

		new Setting(s3Llm)
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

		new Setting(s3Llm)
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

		new Setting(s3Llm)
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
			new Setting(s3Llm)
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

			new Setting(s3Llm)
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

			new Setting(s3Llm)
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

			new Setting(s3Llm)
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

			new Setting(s3Llm)
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

		s3Llm.createEl("h4", { text: "Seedance 视频（火山方舟）" });
		new Setting(s3Llm)
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

		new Setting(s3Llm)
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

		new Setting(s3Llm)
			.setName("文本模型")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.textModel)
					.onChange(async (v) => {
						this.plugin.settings.textModel = v.trim() || "deepseek-chat";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(s3Llm)
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
			new Setting(s3Llm)
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

		{
			const cacheDetails = s3Llm.createEl("details", {
				cls: "mdtp-settings-details",
			});
			cacheDetails.createEl("summary", {
				text: "缓存与自动清理（可选）",
				cls: "mdtp-settings-summary",
			});
			new Setting(cacheDetails)
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

			new Setting(cacheDetails)
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
		}

		const s4Gzh = mdtpSettingsSection(
			containerEl,
			"4 · 公众号（长文、封面、视频号分片）",
			"AppID/Secret 与草稿、素材；分片参数与「上传短视频到视频号」共用 token。",
		);
		new Setting(s4Gzh)
			.setName("AppID")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.wechatAppId)
					.onChange(async (v) => {
						this.plugin.settings.wechatAppId = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(s4Gzh)
			.setName("AppSecret")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.wechatAppSecret)
					.onChange(async (v) => {
						this.plugin.settings.wechatAppSecret = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(s4Gzh)
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

		new Setting(s4Gzh)
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

		new Setting(s4Gzh)
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

		new Setting(s4Gzh)
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

		{
			const vDetails = s4Gzh.createEl("details", { cls: "mdtp-settings-details" });
			vDetails.createEl("summary", {
				text: "视频号 · 分片上传（专家参数，一般无需展开）",
				cls: "mdtp-settings-summary",
			});
			vDetails.createEl("p", {
				cls: "setting-item-description",
				text: "access_token 与上方公众号共用同一组 AppID / AppSecret。本插件仅实现文档中的 init 与 chunk。",
			});
			new Setting(vDetails)
				.setName("init 接口路径")
				.setDesc(
					"相对 https://api.weixin.qq.com ；与文档不一致时可改。默认已按常见 channels_ec 地址填写。",
				)
				.addText((t) =>
					t
						.setValue(this.plugin.settings.channelsVideoInitPath)
						.onChange(async (v) => {
							this.plugin.settings.channelsVideoInitPath = v.trim() || "/";
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vDetails)
				.setName("chunk 接口路径")
				.addText((t) =>
					t
						.setValue(this.plugin.settings.channelsVideoChunkPath)
						.onChange(async (v) => {
							this.plugin.settings.channelsVideoChunkPath = v.trim() || "/";
							await this.plugin.saveSettings();
						}),
				);
			new Setting(vDetails)
				.setName("分片大小（字节）")
				.setDesc("默认 1048576（1MB）")
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
			new Setting(vDetails)
				.setName("chunk 的 media_type")
				.setDesc("默认 1")
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
		}

		const s5Xhs = mdtpSettingsSection(
			containerEl,
			"5 · 小红书（卡片与发布）",
			"主题、版式、发布与 Playwright。Python/venv/一键安装见「0 · 环境变量与 Python」。",
		);
		const xhsUseBundled = !xhsCmd && this.plugin.settings.xhsUseBundledRedbookPublish;
		const xhsPw = xhsUseBundled && this.plugin.settings.xhsPublishMode === "playwright";
		/** 内置 Playwright 不读 MDT_XHS_COOKIE；API 与自定义命令仍可能用到 */
		const xhsShowCookie = !xhsPw;

		s5Xhs.createEl("p", {
			cls: "setting-item-description",
			text: "导出卡片仅依赖 xhs_content.md。常用：先选「卡片主题」与封面，需要发布时再开下方发布相关项。",
		});

		new Setting(s5Xhs)
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

		new Setting(s5Xhs)
			.setName("同时生成封面 cover.png")
			.setDesc(
				"标题取自 publish_xhs.md「标题1：」等，无则取首张卡片首行。与正文卡同时存在时，上传顺序建议先封面。",
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.xhsCoverEnabled).onChange(async (v) => {
					this.plugin.settings.xhsCoverEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		{
			const xhsLayout = s5Xhs.createEl("details", { cls: "mdtp-settings-details" });
			xhsLayout.createEl("summary", {
				text: "版式、分隔线、字体与尺寸（不常改可保持折叠）",
				cls: "mdtp-settings-summary",
			});
			new Setting(xhsLayout)
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

			new Setting(xhsLayout)
				.setName("卡片使用霞鹜文楷 GB")
				.setDesc(
					"插件目录 fonts/ 或 npm run vendor:wenkai；缺失时回退系统黑体。可填下方 TTF 绝对路径。",
				)
				.addToggle((tg) =>
					tg.setValue(this.plugin.settings.xhsUseLXGWWenKai).onChange(async (v) => {
						this.plugin.settings.xhsUseLXGWWenKai = v;
						await this.plugin.saveSettings();
					}),
				);

			new Setting(xhsLayout)
				.setName("卡片字体 TTF 路径（可选）")
				.setDesc("留空用默认 fonts/LXGWWenKaiGB-Regular.ttf。")
				.addText((t) =>
					t
						.setPlaceholder("/path/to/LXGWWenKaiGB-Regular.ttf")
						.setValue(this.plugin.settings.xhsFontTtfPath)
						.onChange(async (v) => {
							this.plugin.settings.xhsFontTtfPath = v.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(xhsLayout)
				.setName("宽度 / 高度 / DPR")
				.setDesc(
					"常见 3:4（如 1080×1440）。DPR>1 会放大成品像素，易与平台建议不一致，一般保持 1。",
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

			new Setting(xhsLayout)
				.setName("动态高度")
				.setDesc("按内容增高，上限为下一项。")
				.addToggle((tg) =>
					tg.setValue(this.plugin.settings.xhsDynamicHeight).onChange(async (v) => {
						this.plugin.settings.xhsDynamicHeight = v;
						await this.plugin.saveSettings();
					}),
				);

			new Setting(xhsLayout)
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

			new Setting(xhsLayout)
				.setName("卡片图保存到笔记同目录")
				.setDesc(
					"开启后写入「当前笔记目录/子文件夹」；未开启工作流时有用。已开启工作流时成品路径由工作流决定。",
				)
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.xhsSaveCardsNextToNote)
						.onChange(async (v) => {
							this.plugin.settings.xhsSaveCardsNextToNote = v;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(xhsLayout)
				.setName("同目录下子文件夹名")
				.setDesc("仅当上一项开启时生效。勿使用 `..`。")
				.addText((t) =>
					t
						.setPlaceholder("xhs_cards")
						.setValue(this.plugin.settings.xhsSaveCardsSubfolder)
						.onChange(async (v) => {
							this.plugin.settings.xhsSaveCardsSubfolder = v.trim() || "xhs_cards";
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(s5Xhs)
			.setName("同步到公众号：图片消息草稿（newspic 贴图）")
			.setDesc("需已配公众号 AppID/Secret。与长文「图文」草稿不是同一类。")
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.xhsWechatNewspicDraft)
					.onChange(async (v) => {
						this.plugin.settings.xhsWechatNewspicDraft = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(s5Xhs)
			.setName("渲染后跑发布流程（到小红书/脚本）")
			.setDesc("关闭则只出 PNG（及可选上一步公众号贴图），不跑发布脚本。开启后需能定位 publish_xhs.md 再执行子进程。")
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.xhsPublishEnabled).onChange(async (v) => {
					this.plugin.settings.xhsPublishEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(s5Xhs)
			.setName("发布命令（留空=走下方内置或仅出图）")
			.setDesc(
				"非空时**完全**使用你的命令，忽略「内置方式」与「无命令时用内置」；仍会注入 MDT_* 环境变量。",
			)
			.addText((t) =>
				t
					.setPlaceholder("留空=使用内置或仅导出")
					.setValue(this.plugin.settings.xhsHelperCommand)
					.onChange(async (v) => {
						this.plugin.settings.xhsHelperCommand = v.trim();
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (xhsCmd) {
			s5Xhs.createEl("p", {
				cls: "setting-item-description",
				text: !xhsShowPythonVenv
					? "已填自定义发布命令（未识别为 Python/内置脚本）：不展示本区「无命令用内置、内置方式、Playwright」；子进程环境变量仍按设置注入。venv/一键安装见「0 · 环境变量与 Python」。"
					: "已填自定义发布命令：不展示「无命令用内置、内置方式、Playwright」等；仍会注入 MDT_*。",
			});
		}

		if (!xhsCmd) {
			new Setting(s5Xhs)
				.setName("无自定义命令时：使用内置 Python 发布脚本")
				.setDesc("关闭时若未填命令，则渲染完只得到 PNG。开启且留空时由「内置方式」二选一。")
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.xhsUseBundledRedbookPublish)
						.onChange(async (v) => {
							this.plugin.settings.xhsUseBundledRedbookPublish = v;
							await this.plugin.saveSettings();
							this.display();
						}),
				);
		}

		if (xhsUseBundled) {
			new Setting(s5Xhs)
				.setName("内置发布方式")
				.setDesc(
					"API：需 Cookie 与 `xhs` 包。Playwright：依赖浏览器里已登录，不读 Cookie 字段。",
				)
				.addDropdown((dd) =>
					dd
						.addOption("api", "API（redbook 签名）")
						.addOption("playwright", "Playwright（可见浏览器）")
						.setValue(
							this.plugin.settings.xhsPublishMode === "playwright"
								? "playwright"
								: "api",
						)
						.onChange(async (v) => {
							this.plugin.settings.xhsPublishMode =
								v === "playwright" ? "playwright" : "api";
							await this.plugin.saveSettings();
							this.display();
						}),
				);
		}

		if (xhsPw) {
			new Setting(s5Xhs)
				.setName("Playwright：显示浏览器")
				.setDesc("无头模式不便登录与排错，一般保持开。")
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.xhsPlaywrightHeaded)
						.onChange(async (v) => {
							this.plugin.settings.xhsPlaywrightHeaded = v;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(s5Xhs)
				.setName("Playwright：失败时保留浏览器")
				.setDesc(
					"便于手动处理。成功后会正常关闭。错误截图见 库/.obsidian/mdtp/xhs_playwright_last_error.png。",
				)
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.xhsPlaywrightKeepOpenOnError)
						.onChange(async (v) => {
							this.plugin.settings.xhsPlaywrightKeepOpenOnError = v;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(s5Xhs)
				.setName("Playwright：半自动（只填到表单，发布键由您点）")
				.setDesc("适合发布前再检查文案。")
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.xhsPlaywrightManualFinalClick)
						.onChange(async (v) => {
							this.plugin.settings.xhsPlaywrightManualFinalClick = v;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(s5Xhs)
				.setName("Playwright：浏览器数据子目录名")
				.setDesc("位于 库/.obsidian/mdtp/xhs_playwright/<名称>，用于持久登录。默认 default 即可。")
				.addText((t) =>
					t
						.setPlaceholder("default")
						.setValue(this.plugin.settings.xhsPlaywrightProfileName)
						.onChange(async (v) => {
							const s = v.trim().replace(/[/\\]/g, "") || "default";
							this.plugin.settings.xhsPlaywrightProfileName = s;
							await this.plugin.saveSettings();
						}),
				);
		}

		if (xhsShowCookie) {
			new Setting(s5Xhs)
				.setName("小红书 Cookie（API/自定义命令用）")
				.setDesc(
					"经 MDT_XHS_COOKIE 传入子进程。内置 Playwright 不读此字段。勿泄露配置。",
				)
				.addText((t) =>
					t
						.setPlaceholder("从浏览器登录后复制")
						.setValue(this.plugin.settings.xhsCookie)
						.onChange(async (v) => {
							this.plugin.settings.xhsCookie = v;
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(s5Xhs)
			.setName("传入脚本：以「仅自己可见」发布")
			.setDesc("会设 MDT_XHS_AS_PRIVATE，是否生效以脚本为准。")
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.xhsPublishAsPrivate)
					.onChange(async (v) => {
						this.plugin.settings.xhsPublishAsPrivate = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(s5Xhs)
			.setName("Dry-run（脚本只做校验/预演）")
			.setDesc("向子进程传 MDT_DRY_RUN=1；真实清理 Sandbox 仅在非 dry 且成功时进行。")
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.xhsHelperDryRun).onChange(async (v) => {
					this.plugin.settings.xhsHelperDryRun = v;
					await this.plugin.saveSettings();
				}),
			);

		const s6Rules = mdtpSettingsSection(
			containerEl,
			"6 · 规则与调试",
			"扩写字数、规则目录、调试日志、编辑器提示。",
		);
		s6Rules.createEl("h4", {
			cls: "mdtp-settings-subhead",
			text: "调试与界面",
		});
		new Setting(s6Rules)
			.setName("控制台调试日志")
			.setDesc(
				"开启后在本库「开发者工具 → Console」可看到 [md-to-platform] 详细日志。",
			)
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.debugLog).onChange(async (v) => {
					this.plugin.settings.debugLog = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(s6Rules)
			.setName("在编辑窗格左下角显示 MDTP 提示条")
			.setDesc("简要说明各入口与要点；可点 × 临时关闭。放在左侧减少遮挡。")
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.showEditorMdtpTips).onChange(async (v) => {
					this.plugin.settings.showEditorMdtpTips = v;
					await this.plugin.saveSettings();
				}),
			);

		s6Rules.createEl("h4", { cls: "mdtp-settings-subhead", text: "扩写与规则文件" });
		new Setting(s6Rules)
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

		new Setting(s6Rules)
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
