import esbuild from "esbuild";
import process from "node:process";

const prod = process.argv[2] === "--watch" ? false : true;

const ctx = await esbuild.context({
	bundle: true,
	platform: "node",
	entryPoints: ["src/main.ts"],
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

if (process.argv[2] === "--watch") {
	await ctx.watch();
} else {
	await ctx.rebuild();
	await ctx.dispose();
}
