# 小红书卡片字体（可选）

导出卡片 PNG 时，若开启设置 **「卡片使用霞鹜文楷 GB」**，插件会在 **`插件根目录/fonts/`**（与 `main.js`、`manifest.json` 同级）查找字体：

- 优先：`LXGWWenKaiGB-Regular.ttf`
- 也支持：`LXGWWenKaiGB-Medium.ttf` 等同系列文件名；若目录里**只有一个** `.ttf`，会自动选用
- **注意**：字体须放在 **Obsidian 库里的插件目录** `.obsidian/plugins/md-to-platform/fonts/`，而不是只放在开发用 Git 仓库的 `fonts/`（若未把整个插件文件夹拷进库，仍会回退系统字体）

字体来源：[lxgw/LxgwWenkaiGB](https://github.com/lxgw/LxgwWenkaiGB)（SIL Open Font License 1.1，可自由商用）。详见仓库内 `OFL.txt`。

## 获取文件

在项目根目录执行：

```bash
npm run vendor:wenkai
```

会将上游 `fonts/TTF/LXGWWenKaiGB-Regular.ttf` 下载到本目录。打包发布插件时，请把该 TTF 一并放入插件根目录的 `fonts/` 中（与 `main.js` 同级），否则将回退为系统黑体栈。

也可手动从 [Releases](https://github.com/lxgw/LxgwWenkaiGB/releases) 下载 TTF，重命名为 `LXGWWenKaiGB-Regular.ttf` 放在此处。

## 自定义路径

设置中可填写 **TTF 绝对路径**，将优先于本目录文件。
