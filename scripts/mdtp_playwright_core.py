#!/usr/bin/env python3
"""
与 publish_*_playwright 脚本共用的：Chrome/CDP/持久化上下文启动、人形延时、截屏。

Profile 根路径：$MDT_VAULT_ROOT/.obsidian/mdtp/<profile_subdir>/<profile_name>/
行为环境变量（优先）：
  MDT_PLAYWRIGHT_HEADED  0=无头，1=有头；未设时回退 MDT_XHS_PLAYWRIGHT_HEADED（与旧小红书脚本兼容）
  MDT_VAULT_ROOT
  MDT_PLAYWRIGHT_USE_CDP  为 1 时才经 CDP 连接独立 Chrome；默认 0（仅用 launch_persistent + 同 user-data，避免
     `setDownloadBehavior` / 协议不兼容）。需「先手动开调试端口 Chrome」时再设 1。
  MDT_PLAYWRIGHT_CHROME_CHANNEL_FIRST  设为 1 时优先用系统 Chrome 通道（默认先内置 Chromium，减少崩溃）

整段 Playwright 在子线程执行（run_in_playwright_isolated_thread），避免 Obsidian 等环境下主线程 asyncio
与 Sync Playwright 冲突（It looks like you are using Playwright Sync API inside the asyncio loop）。
"""
from __future__ import annotations

import json
import os
import random
import re
import socket
import subprocess
import sys
import threading
import time
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any

_CDP_FILE = ".cdp_endpoint.json"


def log(msg: str) -> None:
    print(msg, flush=True)


def err(msg: str) -> None:
    print(f"❌ {msg}", flush=True, file=sys.stderr)


def human_ms(lo: int, hi: int) -> None:
    time.sleep(random.uniform(lo / 1000.0, hi / 1000.0))


def error_screenshot_path(suffix: str) -> Path:
    """suffix 如 'douyin' → mdtp/douyin_playwright_last_error.png"""
    root = (os.environ.get("MDT_VAULT_ROOT") or "").strip()
    if root:
        p = Path(root) / ".obsidian" / "mdtp" / f"playwright_{suffix}_last_error.png"
    else:
        p = Path(__file__).resolve().parent / f"playwright_{suffix}_last_error.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def headed_from_env() -> bool:
    v = (os.environ.get("MDT_PLAYWRIGHT_HEADED") or "").strip()
    if v in ("0", "1"):
        return v != "0"
    v2 = (os.environ.get("MDT_XHS_PLAYWRIGHT_HEADED", "1") or "").strip()
    return v2 != "0"


def manual_click_from_env() -> bool:
    for k in ("MDT_PLAYWRIGHT_MANUAL_CLICK", "MDT_XHS_PLAYWRIGHT_MANUAL_CLICK"):
        v = (os.environ.get(k) or "").strip().lower()
        if v in ("1", "true", "yes", "on"):
            return True
    return False


def keep_open_on_fail_from_env() -> bool:
    for k in ("MDT_PLAYWRIGHT_KEEP_OPEN", "MDT_XHS_PLAYWRIGHT_KEEP_OPEN"):
        v = (os.environ.get(k) or "1").strip().lower()
        if v in ("0", "false", "no", "off"):
            return False
    return True


def use_cdp_from_env() -> bool:
    """默认 False：不连 CDP，避免 Chrome 与 Playwright 版本组合触发的 setDownloadBehavior 等错误。"""
    return (os.environ.get("MDT_PLAYWRIGHT_USE_CDP") or "").strip() == "1"


def run_in_playwright_isolated_thread(fn: Callable[[], int]) -> int:
    """
    在独立线程执行整段 sync Playwright，避免主线程上已有 asyncio 事件循环（Electron/嵌套）导致
    sync_playwright().start() 直接失败。
    """
    err_box: list[BaseException | None] = [None]
    code_box: list[int] = [0]

    def work() -> None:
        try:
            code_box[0] = int(fn())
        except BaseException as e:
            err_box[0] = e

    t = threading.Thread(target=work, name="mdtp-playwright", daemon=True)
    t.start()
    t.join()
    if err_box[0] is not None:
        raise err_box[0]
    return code_box[0]


def find_chrome() -> str:
    if sys.platform == "darwin":
        p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        if os.path.isfile(p):
            return p
    elif sys.platform == "win32":
        for base in (os.environ.get("PROGRAMFILES", ""), os.environ.get("PROGRAMFILES(X86)", "")):
            p = os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")
            if os.path.isfile(p):
                return p
    else:
        import shutil

        for name in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
            w = shutil.which(name)
            if w:
                return w
    raise FileNotFoundError("未找到 Google Chrome。请安装 Chrome，或让 Playwright 使用内置 Chromium。")


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _is_port_listening(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            s.connect(("127.0.0.1", port))
            return True
    except OSError:
        return False


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _ep_path(profile_dir: Path) -> Path:
    return profile_dir / _CDP_FILE


def _read_ep(profile_dir: Path) -> dict | None:
    ep = _ep_path(profile_dir)
    if not ep.is_file():
        return None
    try:
        return json.loads(ep.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_ep(profile_dir: Path, port: int, pid: int) -> None:
    _ep_path(profile_dir).write_text(
        json.dumps({"port": port, "pid": pid}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _remove_ep(profile_dir: Path) -> None:
    try:
        _ep_path(profile_dir).unlink(missing_ok=True)
    except OSError:
        pass


def _clear_singleton_locks(profile_dir: Path) -> None:
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        p = profile_dir / name
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


def resolve_mdtp_profile_dir(profile_subdir: str, profile_name: str) -> Path:
    """例如 profile_subdir=xhs_playwright, profile_name=default"""
    name = (profile_name or "default").strip() or "default"
    name = re.sub(r"[/\\]", "", name) or "default"
    vault = (os.environ.get("MDT_VAULT_ROOT") or "").strip()
    if vault:
        return Path(vault) / ".obsidian" / "mdtp" / profile_subdir / name
    return Path.home() / ".mdtp" / profile_subdir / name


def _launch_standalone_chrome(profile_dir: Path, headless: bool) -> int:
    chrome = find_chrome()
    _clear_singleton_locks(profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)
    port = _find_free_port()
    args = [
        chrome,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if headless:
        args.append("--headless=new")
    log(f"正在启动独立 Chrome，调试端口 {port}…")
    proc = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    for _ in range(50):
        if _is_port_listening(port):
            _write_ep(profile_dir, port, proc.pid)
            return port
        time.sleep(0.1)
    _write_ep(profile_dir, port, proc.pid)
    return port


def _persistent_launch_args(headless: bool) -> list[str]:
    """尽量稳定：内置 Chromium 与 Playwright 驱动版本一致；外置卷 profile 下 Chrome 通道偶发 SIGTRAP。"""
    args = [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
    ]
    if headless:
        args.append("--disable-gpu")
    return args


def _launch_persistent_fallback(profile_dir: Path, headless: bool) -> tuple[Any, Any, Any, Any]:
    from playwright.sync_api import sync_playwright  # type: ignore

    profile_dir.mkdir(parents=True, exist_ok=True)
    pw = sync_playwright().start()
    chrome_first = (os.environ.get("MDT_PLAYWRIGHT_CHROME_CHANNEL_FIRST") or "").strip() == "1"
    modes: list[tuple[str, dict[str, Any]]]
    if chrome_first:
        modes = [
            ("Chrome 通道", {"channel": "chrome"}),
            ("内置 Chromium", {}),
        ]
    else:
        # 默认先内置 Chromium（与 driver 同构建），再尝试系统 Chrome；避免 Target closed / SIGTRAP
        modes = [
            ("内置 Chromium", {}),
            ("Chrome 通道", {"channel": "chrome"}),
        ]

    log("回退为 Playwright 持久化浏览器…")
    ctx = None
    last_exc: Exception | None = None
    for round_i in range(2):
        _clear_singleton_locks(profile_dir)
        if round_i > 0:
            log("  再次清理 profile 锁并重试启动…")
            time.sleep(1.5)
        for label, extra in modes:
            try:
                log(f"  尝试：{label}")
                ctx = pw.chromium.launch_persistent_context(
                    str(profile_dir),
                    headless=headless,
                    viewport={"width": 1280, "height": 900},
                    locale="zh-CN",
                    timezone_id="Asia/Shanghai",
                    args=_persistent_launch_args(headless),
                    **extra,
                )
                log(f"  已启动（{label}）。")
                break
            except Exception as e:
                last_exc = e
                log(f"  {label} 失败：{e}")
        if ctx is not None:
            break

    if ctx is None:
        err(
            "持久化浏览器启动失败。可尝试：① 关闭占用同一 profile 的 Chrome；"
            "② 将 MDT_VAULT_ROOT 换到本机磁盘（外置卷上 profile 易触发崩溃）；"
            "③ 设 MDT_PLAYWRIGHT_CHROME_CHANNEL_FIRST=1 优先系统 Chrome；"
            "④ python -m playwright install chromium"
        )
        raise (
            last_exc
            if last_exc
            else RuntimeError("launch_persistent_context failed")
        )
    try:
        from playwright_stealth import Stealth  # type: ignore

        Stealth().apply_stealth_sync(ctx)
    except Exception:
        pass
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    return pw, None, ctx, page


def get_playwright_page_persistent_only(
    profile_subdir: str,
    profile_name: str,
) -> tuple[Any, Any, Any, Any, Path]:
    """
    不经 CDP，仅用 `launch_persistent_context` + 同 user-data 目录；登录态在 profile 内持久化。
    """
    profile_dir = resolve_mdtp_profile_dir(profile_subdir, profile_name)
    profile_dir.mkdir(parents=True, exist_ok=True)
    _remove_ep(profile_dir)
    headless = not headed_from_env()
    pw, _, ctx, page = _launch_persistent_fallback(profile_dir, headless)
    return pw, None, ctx, page, profile_dir


def get_playwright_page(
    profile_subdir: str,
    profile_name: str,
) -> tuple[Any, Any, Any, Any, Path]:
    """
    返回 (playwright, cdp_browser, persistent_ctx, page, profile_dir)。

    默认不启用 CDP（见 use_cdp_from_env）；为 True 时保留「独立 Chrome 调试端口 + connect_over_cdp」旧路径。
    """
    if not use_cdp_from_env():
        return get_playwright_page_persistent_only(profile_subdir, profile_name)

    from playwright.sync_api import sync_playwright  # type: ignore

    profile_dir = resolve_mdtp_profile_dir(profile_subdir, profile_name)
    profile_dir.mkdir(parents=True, exist_ok=True)
    headless = not headed_from_env()

    data = _read_ep(profile_dir)
    if data and "port" in data:
        port = int(data["port"])
        pid = int(data.get("pid", 0))
        if (not pid or _is_pid_alive(pid)) and _is_port_listening(port):
            try:
                pw = sync_playwright().start()
                br = pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                ctx0 = br.contexts[0] if br.contexts else br.new_context()
                page = ctx0.pages[0] if ctx0.pages else ctx0.new_page()
                try:
                    from playwright_stealth import Stealth  # type: ignore

                    Stealth().apply_stealth_sync(ctx0)
                except Exception:
                    pass
                return pw, br, None, page, profile_dir
            except Exception as e:
                log(f"CDP 连接失败，将回退为持久化上下文：{e}")
                _remove_ep(profile_dir)
        else:
            _remove_ep(profile_dir)
    try:
        port = _launch_standalone_chrome(profile_dir, headless)
        time.sleep(0.3)
        pw = sync_playwright().start()
        br = pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        ctx0 = br.contexts[0] if br.contexts else br.new_context()
        page = ctx0.pages[0] if ctx0.pages else ctx0.new_page()
        try:
            from playwright_stealth import Stealth  # type: ignore

            Stealth().apply_stealth_sync(ctx0)
        except Exception:
            pass
        return pw, br, None, page, profile_dir
    except Exception as e1:
        log(f"CDP+独立 Chrome 不可用（{e1}），回退 Playwright 管理持久化上下文…")
        _remove_ep(profile_dir)
    return get_playwright_page_persistent_only(profile_subdir, profile_name)


def close_playwright_session(
    pw: Any,
    br: Any,
    ctx: Any,
    *,
    keep_open: bool,
    rc: int,
) -> None:
    if keep_open and rc != 0:
        log(
            "已按 MDT_PLAYWRIGHT_KEEP_OPEN 等保留连接，便于在浏览器中手动处理。"
        )
        return
    try:
        if ctx is not None:
            ctx.close()
    except Exception:
        pass
    if pw is not None:
        try:
            pw.stop()
        except Exception:
            pass


def safe_screenshot(page: Any, pth: Path) -> None:
    try:
        page.screenshot(path=str(pth))
        err(f"已保存错误截图: {pth}")
    except Exception:
        pass


def excepthook_screenshot(
    page: Any | None, screenshot_suffix: str, exc: BaseException
) -> None:
    err(str(exc))
    if os.environ.get("MDT_DEBUG", "").strip() == "1":
        traceback.print_exc()
    if page is not None:
        safe_screenshot(page, error_screenshot_path(screenshot_suffix))
