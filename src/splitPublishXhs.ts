/** 解析 LLM 输出中的 <<<PUBLISH_XHS>>> / <<<XHS_CONTENT>>> 分块 */
export function splitPublishXhs(text: string): {
	publishXhs: string;
	xhsContent: string;
} {
	const m1 = text.indexOf("<<<PUBLISH_XHS>>>");
	const m2 = text.indexOf("<<<XHS_CONTENT>>>");
	if (m1 === -1 || m2 === -1) {
		return {
			publishXhs:
				"# 标题候选\n\n（模型未按标记输出，请手动从下方整理）\n\n" + text.slice(0, 2000),
			xhsContent: text,
		};
	}
	const block1 = text.slice(m1 + "<<<PUBLISH_XHS>>>".length, m2).trim();
	const block2 = text.slice(m2 + "<<<XHS_CONTENT>>>".length).trim();
	return { publishXhs: block1 || "（空）", xhsContent: block2 || "（空）" };
}
