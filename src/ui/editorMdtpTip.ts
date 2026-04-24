import { setIcon, setTooltip, type MarkdownView } from "obsidian";
import type { MdToPlatformPlugin } from "../pluginTypes";

let styleInjected = false;

function ensureStyle(): void {
	if (styleInjected) return;
	styleInjected = true;
	const s = document.createElement("style");
	s.textContent = `
.mdtp-editor-tip-wrap {
	position: absolute;
	left: 8px;
	top: 6px;
	z-index: 3;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
}
.mdtp-editor-tip-toggle {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	padding: 0;
	margin: 0;
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	background: var(--background-secondary);
	color: var(--text-muted);
	cursor: pointer;
	--icon-size: 16px;
}
.mdtp-editor-tip-toggle:hover {
	background: var(--background-modifier-hover);
	color: var(--text-normal);
	border-color: var(--interactive-accent);
}
.mdtp-editor-tip-toggle[aria-expanded="true"] {
	border-color: var(--interactive-accent);
	color: var(--interactive-accent);
}
.mdtp-editor-tip-panel {
	max-width: min(300px, 42vw);
	padding: 10px 12px 10px 12px;
	font-size: 11.5px;
	line-height: 1.45;
	color: var(--text-muted);
	background: var(--background-secondary);
	border: 1px solid var(--background-modifier-border);
	border-radius: 10px;
	box-shadow: 0 2px 12px rgba(0,0,0,.08);
	pointer-events: auto;
}
.mdtp-editor-tip-panel:not(.mdtp-editor-tip-panel--open) {
	display: none;
}
.mdtp-editor-tip-title {
	font-weight: 600;
	color: var(--text-normal);
	margin-bottom: 6px;
	font-size: 12px;
}
.mdtp-editor-tip-panel ul {
	margin: 0 0 0 1.1em;
	padding: 0;
}
.mdtp-editor-tip-panel li { margin: 0.25em 0; }
@media (max-width: 520px) {
	.mdtp-editor-tip-panel { max-width: calc(100% - 20px); font-size: 11px; }
}
`;
	document.head.appendChild(s);
}

const TIP_HTML = `
<div class="mdtp-editor-tip-title">MDTP 提示</div>
<ul>
<li>本页<strong>标题栏</strong>有扩写、公众号、小红书、文→卡、葆玉图 快捷操作；<strong>底部状态栏最左侧</strong>另有「MDTP」文字链接（同上）。</li>
<li><strong>扩写</strong>不会修改当前笔记正文；产物在 Published / Sandbox 或笔记同目录（见设置「写作目录工作流」）。</li>
<li><strong>公众号</strong>读 <code>publish_gzh.md</code>；有 <code>[配图：…]</code> 或 <code>【配图提示词】</code> 块时会生图，无则照样排版发草稿；<strong>小红书</strong>依赖 <code>xhs_content.md</code> 分段。</li>
<li>完整选项与 API：设置 → <strong>MD to Platform</strong>。</li>
</ul>
`;

/**
 * 在编辑区左上角放置一个小型提示图标，点击展开/折叠说明，避免长期遮挡编辑区与字数统计。
 */
export function attachMdtpEditorTip(
	plugin: MdToPlatformPlugin,
	view: MarkdownView,
): void {
	if (!plugin.settings.showEditorMdtpTips) return;
	const host = view.contentEl;
	if (host.querySelector(".mdtp-editor-tip-wrap")) return;

	ensureStyle();
	host.classList.add("mdtp-editor-tip-host");

	const wrap = document.createElement("div");
	wrap.className = "mdtp-editor-tip-wrap";

	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "mdtp-editor-tip-toggle";
	btn.setAttribute("aria-label", "显示或隐藏 MDTP 使用说明");
	btn.setAttribute("aria-expanded", "false");
	setIcon(btn, "info");
	setTooltip(btn, "点击显示 / 再次点击隐藏 MDTP 使用说明", { placement: "right" });

	const panel = document.createElement("div");
	panel.className = "mdtp-editor-tip-panel";
	panel.setAttribute("role", "region");
	panel.setAttribute("aria-label", "MDTP 使用说明");
	const body = document.createElement("div");
	body.innerHTML = TIP_HTML;
	panel.appendChild(body);

	const setOpen = (open: boolean) => {
		btn.setAttribute("aria-expanded", open ? "true" : "false");
		panel.classList.toggle("mdtp-editor-tip-panel--open", open);
	};

	btn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		setOpen(!panel.classList.contains("mdtp-editor-tip-panel--open"));
	});

	wrap.appendChild(btn);
	wrap.appendChild(panel);
	host.appendChild(wrap);
}
