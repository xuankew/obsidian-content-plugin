import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";
import { runWechatChannelsVideoUploadWithNotice } from "../pipelines/wechatChannelsVideoUpload";

/**
 * 指定库内 .mp4 路径，调用微信视频号分片上传（init + chunk）。
 */
export class WechatChannelsVideoModal extends Modal {
	private plugin: MdToPlatformPlugin;

	constructor(app: App, plugin: MdToPlatformPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "视频号 · 视频分片上传" });

		contentEl.createEl("p", {
			text: "使用设置里公众号的 AppID / AppSecret 获取 access_token（client_credential）。填写库内相对路径，例如 attachments/demo.mp4。",
			cls: "setting-item-description",
		});

		contentEl.createEl("label", {
			text: "视频文件路径（库内相对路径）",
			cls: "mdtp-seedance-label",
		});
		const pathInput = contentEl.createEl("input", {
			type: "text",
			cls: "mdtp-seedance-path",
			attr: { placeholder: "例如 videos/clip.mp4" },
		});
		pathInput.style.width = "100%";
		pathInput.style.marginTop = "6px";

		const active = this.app.workspace.getActiveFile();
		if (active?.extension.toLowerCase() === "mp4") {
			pathInput.value = active.path;
		}

		const status = contentEl.createEl("p", {
			text: "",
			cls: "setting-item-description",
		});
		status.style.marginTop = "8px";

		const row = contentEl.createDiv({ cls: "modal-button-container" });
		row.style.marginTop = "1em";
		const submit = row.createEl("button", { text: "开始上传" });
		submit.addEventListener("click", () => {
			void this.handleSubmit(pathInput.value, status);
		});
		const cancel = row.createEl("button", { text: "取消" });
		cancel.addEventListener("click", () => this.close());
	}

	private async handleSubmit(
		vaultPath: string,
		statusEl: HTMLParagraphElement,
	): Promise<void> {
		const trimmed = vaultPath.trim();
		if (!trimmed) {
			new Notice("请填写视频文件路径");
			return;
		}

		const norm = normalizePath(trimmed);
		const f = this.app.vault.getAbstractFileByPath(norm);
		if (!(f instanceof TFile)) {
			new Notice(`未找到文件：${norm}`);
			return;
		}

		statusEl.setText("上传中…");
		try {
			await runWechatChannelsVideoUploadWithNotice(this.plugin, f, (done, total) => {
				statusEl.setText(`上传进度：${done} / ${total} 片`);
			});
			statusEl.setText("已完成（详见通知与控制台）");
			this.close();
		} catch {
			statusEl.setText("失败，见通知");
		}
	}
}

export function openWechatChannelsVideoModal(
	app: App,
	plugin: MdToPlatformPlugin,
): void {
	new WechatChannelsVideoModal(app, plugin).open();
}
