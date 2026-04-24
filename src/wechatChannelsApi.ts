/**
 * 微信视频号 / 小店相关：视频分片上传（init + chunk）
 * 与公众号共用 access_token（client_credential）。
 * 路径以微信开放平台/视频号后台文档为准，可在设置中修改。
 */

import { createHash } from "crypto";
import { requestUrl } from "obsidian";

const WX_API_ORIGIN = "https://api.weixin.qq.com";

function wxNetError(step: string, err: unknown): Error {
	const msg = err instanceof Error ? err.message : String(err);
	return new Error(`微信视频号上传 ${step}：${msg}`);
}

export function md5Hex(buffer: Buffer): string {
	return createHash("md5").update(buffer).digest("hex");
}

/** multipart：仅含一个字段 json（字符串） */
function buildMultipartJsonOnly(
	boundary: string,
	jsonFieldName: string,
	jsonString: string,
): ArrayBuffer {
	const crlf = "\r\n";
	const part =
		`--${boundary}${crlf}` +
		`Content-Disposition: form-data; name="${jsonFieldName}"${crlf}${crlf}` +
		jsonString +
		crlf +
		`--${boundary}--${crlf}`;
	return Buffer.from(part, "utf8").buffer;
}

/** multipart：id、seq、media_type 为文本字段，data 为二进制 */
function buildMultipartChunk(
	boundary: string,
	fields: { id: string; seq: number; media_type: number },
	data: Buffer,
): ArrayBuffer {
	const crlf = "\r\n";
	const parts: Buffer[] = [];

	function addTextField(name: string, value: string): void {
		parts.push(
			Buffer.from(
				`--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`,
				"utf8",
			),
		);
	}

	addTextField("id", fields.id);
	addTextField("seq", String(fields.seq));
	addTextField("media_type", String(fields.media_type));

	const head =
		`--${boundary}${crlf}` +
		`Content-Disposition: form-data; name="data"; filename="chunk.bin"${crlf}` +
		`Content-Type: application/octet-stream${crlf}${crlf}`;
	parts.push(Buffer.from(head, "utf8"));
	parts.push(data);
	parts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`, "utf8"));

	return Buffer.concat(parts).buffer;
}

export interface ChannelsVideoInitParams {
	upload_type?: number;
	scene?: number;
	file_size: number;
	file_name: string;
	file_md5: string;
}

export interface ChannelsVideoInitResult {
	upload_id?: string;
	id?: string;
	errcode?: number;
	errmsg?: string;
	[key: string]: unknown;
}

/** POST init，表单字段 json */
export async function channelsVideoUploadInit(
	accessToken: string,
	pathSuffix: string,
	params: ChannelsVideoInitParams,
): Promise<ChannelsVideoInitResult> {
	const path = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
	const url = `${WX_API_ORIGIN}${path}?access_token=${encodeURIComponent(accessToken)}`;
	const boundary = `mdtpch${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
	const jsonPayload = JSON.stringify({
		upload_type: params.upload_type ?? 1,
		scene: params.scene ?? 1,
		file_size: params.file_size,
		file_name: params.file_name,
		file_md5: params.file_md5,
	});
	const body = buildMultipartJsonOnly(boundary, "json", jsonPayload);

	let res;
	try {
		res = await requestUrl({
			url,
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body,
			throw: false,
		});
	} catch (e) {
		throw wxNetError("init", e);
	}

	return res.json as ChannelsVideoInitResult;
}

export interface ChannelsVideoChunkResult {
	errcode?: number;
	errmsg?: string;
	[key: string]: unknown;
}

/** POST chunk：id、seq、media_type、data */
export async function channelsVideoUploadChunk(
	accessToken: string,
	pathSuffix: string,
	uploadId: string,
	seq: number,
	chunk: Buffer,
	mediaType: number,
): Promise<ChannelsVideoChunkResult> {
	const path = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
	const url = `${WX_API_ORIGIN}${path}?access_token=${encodeURIComponent(accessToken)}`;
	const boundary = `mdtpch${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
	const body = buildMultipartChunk(boundary, {
		id: uploadId,
		seq,
		media_type: mediaType,
	}, chunk);

	let res;
	try {
		res = await requestUrl({
			url,
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body,
			throw: false,
		});
	} catch (e) {
		throw wxNetError(`chunk seq=${seq}`, e);
	}

	return res.json as ChannelsVideoChunkResult;
}

/**
 * 完整流程：init → 按块上传。返回最后一次 chunk 的响应（或 init 失败时抛出）。
 */
export async function channelsVideoUploadFull(params: {
	accessToken: string;
	initPath: string;
	chunkPath: string;
	fileBuffer: Buffer;
	fileName: string;
	chunkSize: number;
	mediaType?: number;
	onProgress?: (done: number, total: number) => void;
}): Promise<{ uploadId: string; lastChunk: ChannelsVideoChunkResult }> {
	const {
		accessToken,
		initPath,
		chunkPath,
		fileBuffer,
		fileName,
		chunkSize,
		mediaType = 1,
		onProgress,
	} = params;

	const hash = md5Hex(fileBuffer);
	const init = await channelsVideoUploadInit(accessToken, initPath, {
		file_size: fileBuffer.length,
		file_name: fileName,
		file_md5: hash,
	});

	if (init.errcode && init.errcode !== 0) {
		throw new Error(init.errmsg || `init errcode=${init.errcode}`);
	}

	const uploadId = (init.upload_id ?? init.id) as string | undefined;
	if (!uploadId || typeof uploadId !== "string") {
		throw new Error(
			`init 未返回 upload_id：${JSON.stringify(init)}`,
		);
	}

	const totalChunks = Math.ceil(fileBuffer.length / chunkSize) || 1;
	let last: ChannelsVideoChunkResult = {};

	for (let seq = 0; seq < totalChunks; seq++) {
		const start = seq * chunkSize;
		const chunk = fileBuffer.subarray(start, start + chunkSize);
		last = await channelsVideoUploadChunk(
			accessToken,
			chunkPath,
			uploadId,
			seq,
			chunk,
			mediaType,
		);
		if (last.errcode && last.errcode !== 0) {
			throw new Error(
				last.errmsg || `chunk seq=${seq} errcode=${last.errcode}`,
			);
		}
		onProgress?.(seq + 1, totalChunks);
	}

	return { uploadId, lastChunk: last };
}
