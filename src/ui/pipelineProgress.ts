/** 各 MDTP 管线共用的底部浮层：标题 + 分步说明 + 进度条 */

let styleInjected = false;

function ensureStyle(): void {
	if (styleInjected) return;
	styleInjected = true;
	const s = document.createElement("style");
	s.textContent = `
.mdtp-pipeline-progress-root {
	position: fixed;
	bottom: 22px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 99999;
	min-width: 300px;
	max-width: min(520px, 94vw);
	padding: 14px 16px;
	background: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
	border-radius: 10px;
	box-shadow: 0 8px 32px rgba(0,0,0,.18);
	font-size: 13px;
	line-height: 1.45;
	color: var(--text-normal);
}
.mdtp-pipeline-progress-title {
	font-weight: 600;
	margin-bottom: 8px;
	color: var(--text-normal);
}
.mdtp-pipeline-progress-label {
	margin-bottom: 10px;
	color: var(--text-muted);
	min-height: 2.6em;
}
.mdtp-pipeline-progress-track {
	height: 6px;
	background: var(--background-modifier-border);
	border-radius: 4px;
	overflow: hidden;
}
.mdtp-pipeline-progress-fill {
	height: 100%;
	width: 0%;
	background: var(--interactive-accent);
	border-radius: 4px;
	transition: width 0.35s ease, opacity 0.3s ease;
}
.mdtp-pipeline-progress-fill.mdtp-indeterminate {
	width: 100% !important;
	opacity: 0.4;
	animation: mdtp-breath 1.15s ease-in-out infinite;
}
@keyframes mdtp-breath {
	0%, 100% { opacity: 0.28; }
	50% { opacity: 0.55; }
}
`;
	document.head.appendChild(s);
}

export type PipelineProgressHandle = {
	setPhase: (label: string, ratio: number, indeterminate?: boolean) => void;
	close: () => void;
};

/** @param heading 浮层标题，如「MDTP 扩写进行中」 */
export function createPipelineProgressOverlay(heading: string): PipelineProgressHandle {
	ensureStyle();
	const root = document.createElement("div");
	root.className = "mdtp-pipeline-progress-root";
	root.setAttribute("aria-live", "polite");

	const title = document.createElement("div");
	title.className = "mdtp-pipeline-progress-title";
	title.textContent = heading;

	const label = document.createElement("div");
	label.className = "mdtp-pipeline-progress-label";
	label.textContent = "准备中…";

	const track = document.createElement("div");
	track.className = "mdtp-pipeline-progress-track";
	const fill = document.createElement("div");
	fill.className = "mdtp-pipeline-progress-fill";
	track.appendChild(fill);

	root.appendChild(title);
	root.appendChild(label);
	root.appendChild(track);
	document.body.appendChild(root);

	return {
		setPhase(text: string, ratio: number, indeterminate = false) {
			label.textContent = text;
			fill.classList.toggle("mdtp-indeterminate", indeterminate);
			if (indeterminate) {
				fill.style.width = "100%";
				fill.style.opacity = "";
			} else {
				fill.classList.remove("mdtp-indeterminate");
				fill.style.opacity = "1";
				const r = Math.max(0, Math.min(1, ratio));
				fill.style.width = `${r * 100}%`;
			}
		},
		close() {
			root.remove();
		},
	};
}
