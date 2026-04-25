#!/usr/bin/env bash
# 为 md-to-platform 的小红书发布脚本创建独立 venv 并安装 xhs，避开 Homebrew Python 的 PEP 668 限制。
# 用法（在终端）：
#   cd "/本插件/目录"   # 与 scripts 同级的根目录
#   bash scripts/bootstrap_xhs_venv.sh
# 或指定解释器（须已安装，如 Homebrew 的 3.13）：
#   bash scripts/bootstrap_xhs_venv.sh /opt/homebrew/opt/python@3.13/bin/python3.13
# 成功后在 Obsidian：设置 → MD to Platform → 小红书 →「Python 解释器」填：
#   <本插件根目录>/scripts/xhs_venv/bin/python3

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/xhs_venv"
PYTHON_BIN="${1:-$(command -v python3.13 2>/dev/null || command -v python3 || true)}"

if [[ -z "${PYTHON_BIN}" ]] || ! command -v "${PYTHON_BIN}" &>/dev/null; then
	echo "错误: 未找到 Python3，请先安装或把解释器绝对路径作为第一个参数传入"
	exit 1
fi

echo "使用: ${PYTHON_BIN}"
"${PYTHON_BIN}" -m venv "${VENV_DIR}"
# shellcheck source=/dev/null
source "${VENV_DIR}/bin/activate"
python -m pip install -U pip
python -m pip install "xhs"

echo ""
echo "完成。请在 Obsidian「Python 解释器」中填写（任选其一，以实际存在者为准）："
if [[ -x "${VENV_DIR}/bin/python3" ]]; then
	echo "  ${VENV_DIR}/bin/python3"
fi
if [[ -x "${VENV_DIR}/bin/python" ]]; then
	echo "  ${VENV_DIR}/bin/python"
fi
