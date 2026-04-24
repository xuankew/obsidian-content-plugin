/**
 * 微信公众号基础接口：access_token、上传图片、新增草稿
 * 文档：https://developers.weixin.qq.com/doc/offiaccount/
 *
 * 统一使用 Obsidian requestUrl，避免桌面端 fetch 对跨域/部分 HTTPS 出现 Failed to fetch。
 */

import { requestUrl } from "obsidian";

export interface WeChatTokenResponse {
	access_token?: string;
	expires_in?: number;
	errcode?: number;
	errmsg?: string;
}

function wxNetError(step: string, err: unknown): Error {
	const msg = err instanceof Error ? err.message : String(err);
	return new Error(
		`微信公众平台 ${step} 网络异常：${msg}。请检查本机网络、代理/VPN、防火墙是否拦截 api.weixin.qq.com；服务器 IP 需在公众号后台白名单。`,
	);
}

/** multipart/form-data，字段名 media（与微信上传接口一致） */
function buildMediaMultipartBody(
	boundary: string,
	filename: string,
	imageBuffer: Buffer,
): ArrayBuffer {
	const safeName = filename.replace(/"/g, "_").slice(0, 128) || "image.png";
	const head = `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
	const tail = `\r\n--${boundary}--\r\n`;
	const buf = Buffer.concat([
		Buffer.from(head, "utf8"),
		imageBuffer,
		Buffer.from(tail, "utf8"),
	]);
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function getAccessToken(appId: string, secret: string): Promise<string> {
	const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`;
	let res;
	try {
		res = await requestUrl({ url, throw: false });
	} catch (e) {
		throw wxNetError("获取 access_token", e);
	}
	const data = res.json as WeChatTokenResponse;
	if (data.access_token) return data.access_token;
	throw new Error(
		data.errmsg || `获取 access_token 失败 errcode=${data.errcode}`,
	);
}

/** 图文消息正文内图片上传，返回 URL */
export async function uploadImg(
	accessToken: string,
	imageBuffer: Buffer,
	filename: string,
): Promise<string> {
	const boundary = `mdtp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	const url = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`;
	let res;
	try {
		res = await requestUrl({
			url,
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body: buildMediaMultipartBody(boundary, filename, imageBuffer),
			throw: false,
		});
	} catch (e) {
		throw wxNetError("上传正文图片 uploadimg", e);
	}
	const data = res.json as { url?: string; errcode?: number; errmsg?: string };
	if (data.url) return data.url;
	throw new Error(data.errmsg || `uploadimg 失败 errcode=${data.errcode}`);
}

/** 永久素材：缩略图 thumb_media_id */
export async function addMaterialThumb(
	accessToken: string,
	imageBuffer: Buffer,
	filename: string,
): Promise<string> {
	const boundary = `mdtp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=thumb`;
	let res;
	try {
		res = await requestUrl({
			url,
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body: buildMediaMultipartBody(boundary, filename, imageBuffer),
			throw: false,
		});
	} catch (e) {
		throw wxNetError("上传封面素材 add_material(thumb)", e);
	}
	const data = res.json as { media_id?: string; errcode?: number; errmsg?: string };
	if (data.media_id) return data.media_id;

	const boundary2 = `mdtp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	const altUrl = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=image`;
	let res2;
	try {
		res2 = await requestUrl({
			url: altUrl,
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=${boundary2}`,
			},
			body: buildMediaMultipartBody(boundary2, filename, imageBuffer),
			throw: false,
		});
	} catch (e) {
		throw wxNetError("上传封面素材 add_material(image)", e);
	}
	const data2 = res2.json as { media_id?: string; errcode?: number; errmsg?: string };
	if (data2.media_id) return data2.media_id;
	throw new Error(data2.errmsg || data.errmsg || "add_material 失败");
}

export interface DraftArticle {
	title: string;
	author: string;
	digest: string;
	content: string;
	thumb_media_id: string;
}

export async function addDraft(
	accessToken: string,
	articles: DraftArticle[],
): Promise<{ media_id: string }> {
	const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`;
	const payload = JSON.stringify({ articles });
	let res;
	try {
		res = await requestUrl({
			url,
			method: "POST",
			contentType: "application/json",
			body: payload,
			throw: false,
		});
	} catch (e) {
		throw wxNetError("新增草稿 draft/add", e);
	}
	const data = res.json as {
		media_id?: string;
		errcode?: number;
		errmsg?: string;
	};
	if (data.media_id) return { media_id: data.media_id };
	throw new Error(data.errmsg || `draft/add 失败 errcode=${data.errcode}`);
}
