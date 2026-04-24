// @ts-expect-error markdown-it 未导出子路径类型
import StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type { MarkdownIt } from "markdown-it";

const EMPHASIS_MARKERS = new Set([0x2a, 0x5f, 0x7e]);

function isCjkLetter(charCode: number): boolean {
	if (!charCode || charCode < 0) return false;
	return (
		(charCode >= 0x3400 && charCode <= 0x4dbf) ||
		(charCode >= 0x4e00 && charCode <= 0x9fff) ||
		(charCode >= 0xf900 && charCode <= 0xfaff) ||
		(charCode >= 0xff01 && charCode <= 0xff60) ||
		(charCode >= 0xff61 && charCode <= 0xff9f) ||
		(charCode >= 0xffa0 && charCode <= 0xffdc)
	);
}

function isCjkPunctuation(charCode: number): boolean {
	if (!charCode || charCode < 0) return false;
	return (
		(charCode >= 0x3000 && charCode <= 0x303f) ||
		(charCode >= 0xff01 && charCode <= 0xff0f) ||
		(charCode >= 0xff1a && charCode <= 0xff20) ||
		(charCode >= 0xff3b && charCode <= 0xff40) ||
		(charCode >= 0xff5b && charCode <= 0xff65) ||
		(charCode >= 0xfe10 && charCode <= 0xfe1f) ||
		(charCode >= 0xfe30 && charCode <= 0xfe6f)
	);
}

let scanDelimsPatched = false;

/**
 * 与 [huasheng_editor](https://github.com/alchaincyf/huasheng_editor) 一致：改善中文下加粗与标点配合。
 * 全局只补丁一次 StateInline。
 */
export function patchMarkdownScannerForHuasheng(md: MarkdownIt): void {
	if (scanDelimsPatched) return;
	const utils = md.utils;
	const fallbackChars = "「『《〈（【〔〖［｛﹁﹃﹙﹛﹝“‘（";
	const fallbackSet = new Set(
		[...fallbackChars].map((ch) => ch.codePointAt(0)!),
	);
	let unicodeRegex: RegExp | null = null;
	try {
		unicodeRegex = new RegExp("[\\p{Ps}\\p{Pi}]", "u");
	} catch {
		unicodeRegex = null;
	}
	const allowLeadingPunctuation = (charCode: number, marker: number): boolean => {
		if (!EMPHASIS_MARKERS.has(marker)) return false;
		if (unicodeRegex) {
			const char = String.fromCharCode(charCode);
			if (unicodeRegex.test(char)) return true;
		}
		return fallbackSet.has(charCode);
	};

	const originalScanDelims = StateInline.prototype.scanDelims;

	StateInline.prototype.scanDelims = function (
		this: InstanceType<typeof StateInline>,
		start: number,
		canSplitWord: boolean,
	) {
		const max = this.posMax;
		const marker = this.src.charCodeAt(start);
		if (!EMPHASIS_MARKERS.has(marker)) {
			return originalScanDelims.call(this, start, canSplitWord);
		}
		const lastChar = start > 0 ? this.src.charCodeAt(start - 1) : 0x20;
		let pos = start;
		while (pos < max && this.src.charCodeAt(pos) === marker) pos++;
		const count = pos - start;
		const nextChar = pos < max ? this.src.charCodeAt(pos) : 0x20;
		const isLastWhiteSpace = utils.isWhiteSpace(lastChar);
		const isNextWhiteSpace = utils.isWhiteSpace(nextChar);
		let isLastPunctChar =
			utils.isMdAsciiPunct(lastChar) || utils.isPunctChar(String.fromCharCode(lastChar));
		let isNextPunctChar =
			utils.isMdAsciiPunct(nextChar) || utils.isPunctChar(String.fromCharCode(nextChar));
		if (isNextPunctChar && allowLeadingPunctuation(nextChar, marker)) {
			isNextPunctChar = false;
		}
		if (marker === 0x5f) {
			if (!isLastWhiteSpace && !isLastPunctChar && isCjkLetter(lastChar)) {
				isLastPunctChar = true;
			}
			if (!isNextWhiteSpace && !isNextPunctChar && isCjkLetter(nextChar)) {
				isNextPunctChar = true;
			}
		}
		if (marker === 0x2a) {
			if (isLastPunctChar && isCjkPunctuation(lastChar) && !utils.isMdAsciiPunct(lastChar)) {
				isLastPunctChar = false;
			}
			if (isNextPunctChar && isCjkPunctuation(nextChar) && !utils.isMdAsciiPunct(nextChar)) {
				isNextPunctChar = false;
			}
		}
		const left_flanking =
			!isNextWhiteSpace && (!isNextPunctChar || isLastWhiteSpace || isLastPunctChar);
		const right_flanking =
			!isLastWhiteSpace && (!isLastPunctChar || isNextWhiteSpace || isNextPunctChar);
		const can_open = left_flanking && (canSplitWord || !right_flanking || isLastPunctChar);
		const can_close = right_flanking && (canSplitWord || !left_flanking || isNextPunctChar);
		return { can_open, can_close, length: count };
	};

	scanDelimsPatched = true;
}
