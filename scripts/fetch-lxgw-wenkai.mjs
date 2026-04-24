/**
 * 下载霞鹜文楷 GB Regular 至 fonts/LXGWWenKaiGB-Regular.ttf
 * 上游：https://github.com/lxgw/LxgwWenkaiGB
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "fonts");
const dest = path.join(outDir, "LXGWWenKaiGB-Regular.ttf");
const url =
	"https://github.com/lxgw/LxgwWenkaiGB/raw/main/fonts/TTF/LXGWWenKaiGB-Regular.ttf";

function download(u, file) {
	return new Promise((resolve, reject) => {
		const req = https.get(
			u,
			{
				headers: { "User-Agent": "md-to-platform-vendor-script" },
			},
			(res) => {
				if (res.statusCode === 302 || res.statusCode === 301) {
					const loc = res.headers.location;
					if (!loc) {
						reject(new Error("Redirect without location"));
						return;
					}
					res.resume();
					download(loc, file).then(resolve, reject);
					return;
				}
				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode}`));
					return;
				}
				const w = fs.createWriteStream(file);
				res.pipe(w);
				w.on("finish", () => w.close((e) => (e ? reject(e) : resolve())));
			},
		);
		req.on("error", reject);
	});
}

fs.mkdirSync(outDir, { recursive: true });
console.log("Fetching", url);
await download(url, dest);
const st = fs.statSync(dest);
console.log("Wrote", dest, "bytes", st.size);
if (st.size < 50_000) {
	console.warn("File seems too small; check URL or network.");
	process.exit(1);
}
