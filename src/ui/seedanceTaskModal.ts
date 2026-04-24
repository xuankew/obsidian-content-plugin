import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import type { MdToPlatformSettings } from "../settings";
import {
	buildSeedanceContentTextAndReferenceImage,
	submitSeedanceGenerationTask,
} from "../llm/providers/volcengineSeedance";

type GetSettings = () => MdToPlatformSettings;

/**
 * 提交 Seedance 图生视频任务：多行提示词 + 可选库内参考图路径。
 */
export class SeedanceTaskModal extends Modal {
	private getSettings: GetSettings;

	constructor(app: App, getSettings: GetSettings) {
		super(app);
		this.getSettings = getSettings;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Seedance 视频任务" });

		contentEl.createEl("p", {
			text: "调用 POST /api/v3/contents/generations/tasks。需已在设置中填写火山方舟 API Key。参考图为可选；若填写须为库内图片路径（如 attachments/ref.png）。",
			cls: "setting-item-description",
		});

		contentEl.createEl("label", { text: "视频提示词（text）", cls: "mdtp-seedance-label" });
		const ta = contentEl.createEl("textarea", {
			cls: "mdtp-seedance-prompt",
			attr: { rows: 10 },
		});
		ta.style.width = "100%";
		ta.style.minHeight = "160px";
		ta.style.marginTop = "6px";
		ta.style.fontFamily = "var(--font-monospace)";

		contentEl.createEl("label", {
			text: "参考图路径（可选，库内相对路径）",
			cls: "mdtp-seedance-label",
		});
		const imgPath = contentEl.createEl("input", {
			type: "text",
			cls: "mdtp-seedance-path",
			attr: { placeholder: "例如 images/ref.png" },
		});
		imgPath.style.width = "100%";
		imgPath.style.marginTop = "6px";

		const row = contentEl.createDiv({ cls: "modal-button-container" });
		row.style.marginTop = "1em";
		const submit = row.createEl("button", { text: "提交任务" });
		submit.addEventListener("click", () => {
			void this.handleSubmit(ta.value, imgPath.value);
		});
		const cancel = row.createEl("button", { text: "取消" });
		cancel.addEventListener("click", () => this.close());
	}

	private async handleSubmit(prompt: string, vaultImagePath: string): Promise<void> {
		const text = prompt.trim();
		if (!text) {
			new Notice("请填写视频提示词");
			return;
		}

		const s = this.getSettings();
		if (!s.volcengineArkApiKey.trim()) {
			new Notice("请先在设置中填写火山方舟 API Key");
			return;
		}

		const pathTrim = vaultImagePath.trim();
		let content: ReturnType<typeof buildSeedanceContentTextAndReferenceImage>;

		if (pathTrim.length > 0) {
			const norm = normalizePath(pathTrim);
			const f = this.app.vault.getAbstractFileByPath(norm);
			if (!(f instanceof TFile)) {
				new Notice(`未找到文件：${norm}`);
				return;
			}
			const ext = f.extension.toLowerCase();
			if (!["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
				new Notice("参考图请使用 png / jpg / webp / gif");
				return;
			}
			const ab = await this.app.vault.readBinary(f);
			const mime =
				ext === "png"
					? "image/png"
					: ext === "jpg" || ext === "jpeg"
						? "image/jpeg"
						: ext === "webp"
							? "image/webp"
							: "image/gif";
			const b64 = Buffer.from(ab).toString("base64");
			const dataUrl = `data:${mime};base64,${b64}`;
			content = buildSeedanceContentTextAndReferenceImage(text, dataUrl);
		} else {
			content = [{ type: "text", text }];
		}

		try {
			const result = await submitSeedanceGenerationTask(s, { content });
			const pretty = JSON.stringify(result, null, 2);
			console.info("[md-to-platform] Seedance task response:\n", pretty);
			new Notice("Seedance 任务已提交，响应已写入控制台", 6000);
			this.close();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Seedance 失败：${msg}`, 12000);
		}
	}
}

export function openSeedanceTaskModal(
	app: App,
	getSettings: GetSettings,
): void {
	new SeedanceTaskModal(app, getSettings).open();
}
