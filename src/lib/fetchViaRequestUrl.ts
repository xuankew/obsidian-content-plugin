import { requestUrl } from "obsidian";

const rawFetch =
	typeof globalThis.fetch === "function"
		? globalThis.fetch.bind(globalThis)
		: undefined;

function resolveUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return (input as Request).url;
}

async function normalizeBody(
	body: BodyInit | null | undefined,
): Promise<string | ArrayBuffer | undefined> {
	if (body == null) return undefined;
	if (typeof body === "string") return body;
	if (body instanceof ArrayBuffer) return body;
	if (ArrayBuffer.isView(body)) {
		const v = body as ArrayBufferView;
		return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
	}
	if (typeof Blob !== "undefined" && body instanceof Blob) return await body.arrayBuffer();
	if (body instanceof URLSearchParams) return body.toString();
	throw new Error("fetchViaRequestUrl: unsupported body type");
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> | undefined {
	if (!h) return undefined;
	const headers = new Headers(h);
	const o: Record<string, string> = {};
	headers.forEach((v, k) => {
		o[k] = v;
	});
	return Object.keys(o).length ? o : undefined;
}

/**
 * 与 fetch 兼容：HTTP(S) 走 Obsidian requestUrl，避免 Electron 渲染进程对跨域请求报 Failed to fetch。
 * 非 http(s)（如 data:、obsidian://）仍用原生 fetch。
 */
export async function fetchViaRequestUrl(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const url = resolveUrl(input);
	if (!/^https?:\/\//i.test(url)) {
		if (!rawFetch) throw new Error("fetch is not available");
		return rawFetch(input, init);
	}

	const method = (init?.method ?? "GET").toUpperCase();
	const headerRec = headersToRecord(init?.headers);
	let body: string | ArrayBuffer | undefined;
	if (init?.body != null && method !== "GET" && method !== "HEAD") {
		body = await normalizeBody(init.body as BodyInit);
	}

	const req: {
		url: string;
		method: string;
		throw: boolean;
		headers?: Record<string, string>;
		body?: string | ArrayBuffer;
		contentType?: string;
	} = {
		url,
		method,
		throw: false,
	};

	if (body !== undefined) {
		req.body = body;
		let ct =
			headerRec?.["Content-Type"] ??
			headerRec?.["content-type"] ??
			(typeof body === "string" ? "text/plain;charset=UTF-8" : "application/octet-stream");
		req.contentType = ct;
		const rest = headerRec ? { ...headerRec } : undefined;
		if (rest) {
			delete rest["Content-Type"];
			delete rest["content-type"];
			if (Object.keys(rest).length) req.headers = rest;
		}
	} else if (headerRec) {
		req.headers = headerRec;
	}

	let res;
	try {
		res = await requestUrl(req);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`网络请求失败：${msg}`);
	}

	return new Response(res.arrayBuffer, {
		status: res.status,
		headers: res.headers,
	});
}
