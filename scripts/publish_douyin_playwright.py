#!/usr/bin/env python3
"""
使用 Playwright 在抖音创作服务平台上传并发布视频（本机 Chrome + CDP，与 mdtp_playwright_core 一致）。

需提前在目标 profile 的浏览器中登录 https://creator.douyin.com 。

操作路径与填写顺序参考开源项目
https://github.com/dreammis/social-auto-upload （`uploader/douyin_uploader`：内容上传页、作品描述区块）。

环境变量:
  MDT_DOUYIN_VIDEO      本机 MP4 绝对路径（必填）
  MDT_DOUYIN_TITLE      标题
  MDT_DOUYIN_BODY      作品描述/正文（可含 #话题）
  MDT_DOUYIN_TAGS      逗号分隔额外话题，可选；会追加到正文的 # 后
  MDT_DRY_RUN=1         不打开浏览器
  MDT_VAULT_ROOT        与 Obsidian 一致
  MDT_DOUYIN_PLAYWRIGHT_PROFILE  未设时用 MDT_VIDEO_PLAYWRIGHT_PROFILE，再未设则 default
  MDT_DOUYIN_URL  可覆盖发布页；默认与 social-auto-upload 一致为
                    https://creator.douyin.com/creator-micro/content/upload
                    （可改为带 ?enter_from=dou_web 等追踪参数）
  MDT_DOUYIN_LOGIN_WAIT_SEC  若落在登录页，等待扫码/登录的最长时间（默认 600）
  MDT_DOUYIN_PROCESS_WAIT_SEC  选片后等上传/转码、底部「发布」可点的最长秒数（默认 600）
  MDT_DOUYIN_SCHEDULE  默认 1：在「发布设置」中选「定时发布」至次日/当天 8:30；0=「立即发布」
  MDT_DOUYIN_SCHEDULE_HOUR / MDT_DOUYIN_SCHEDULE_MINUTE  默认定时 8:30

产品侧约定（与插件一致）:
  · 作品标题 = video_config 抖音标题
  · 作品简介与 #话题 = 小红书正文 + 话题（插件注入 MDT_DOUYIN_BODY）
  · 不操作：官方活动、封面、合集、章节
  · 发布设置：不同时发布、谁可以看=公开、保存权限=不允许、定时发布至 8:30、最后点红色「发布」
  通用: MDT_PLAYWRIGHT_HEADED, MDT_PLAYWRIGHT_MANUAL_CLICK, MDT_DEBUG

页面可能改版，失败时 MDT_DEBUG=1 可配合截图 mdtp/playwright_douyin_last_error.png
"""

from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import mdtp_playwright_core as pwc  # noqa: E402

# 与 social-auto-upload 一致：/creator-micro/content/upload（?enter_from= 可自选）
_DEFAULT_DOUYIN_URL = "https://creator.douyin.com/creator-micro/content/upload"


def _mod_key() -> str:
    import platform

    return "Meta" if platform.system() == "Darwin" else "Control"


def _douyin_fill_via_work_desc_block(page: Any, title: str, body: str) -> bool:
    """
    按 social-auto-upload 路径：在「作品描述」卡片内找标题 input 与可编辑区。
    成功则返回 True（标题在抖音侧常限约 30 字，与上游一致对 title 切片）。
    """
    try:
        desc_section = (
            page.get_by_text("作品描述", exact=True)
            .locator("xpath=ancestor::div[2]")
            .locator("xpath=following-sibling::div[1]")
        )
        if desc_section.count() == 0:
            return False
        title_input = desc_section.locator('input[type="text"]').first
        title_input.wait_for(state="visible", timeout=10000)
        title_input.fill((title or "")[:30])
        editor = desc_section.locator('.zone-container[contenteditable="true"]').first
        if editor.count() == 0:
            return False
        editor.wait_for(state="visible", timeout=10000)
        editor.click()
        pwc.human_ms(200, 400)
        m = _mod_key()
        page.keyboard.press(f"{m}+KeyA")
        page.keyboard.press("Delete")
        if body:
            page.keyboard.type(body, delay=4)
        return True
    except Exception:
        return False


def _douyin_fill_placeholder_ui(page: Any, title: str, body: str) -> bool:
    """新版权块：「填写作品标题」+「添加作品简介」等 placeholder。"""
    t_ok = False
    try:
        for pat in (r"填写作品标题|获得更多流量", r"作品标题|标题"):
            loc = page.get_by_placeholder(re.compile(pat, re.I))
            if loc.count() > 0:
                loc.first.fill((title or "")[:30], timeout=8000)
                t_ok = True
                break
    except Exception:
        pass
    b_ok = False
    if not (body or "").strip():
        return t_ok
    try:
        ph = page.get_by_placeholder(re.compile("添加作品简介|作品简介|简介", re.I))
        if ph.count() > 0:
            ph.first.click(timeout=8000)
            pwc.human_ms(200, 400)
            m = _mod_key()
            page.keyboard.press(f"{m}+KeyA")
            page.keyboard.press("Delete")
            page.keyboard.type(body, delay=4, timeout=180000)
            b_ok = True
    except Exception:
        pass
    return bool(t_ok and b_ok)


def _douyin_target_url() -> str:
    u = (os.environ.get("MDT_DOUYIN_URL") or "").strip()
    if u:
        return u
    u2 = (os.environ.get("MDT_DOUYIN_START_URL") or "").strip()
    if u2:
        return u2
    return _DEFAULT_DOUYIN_URL


def _tags_from_env() -> list[str]:
    raw = (os.environ.get("MDT_DOUYIN_TAGS") or "").strip()
    if not raw:
        return []
    return [t.strip() for t in re.split(r"[,，;；]", raw) if t.strip()]


def _profile_name() -> str:
    for k in ("MDT_DOUYIN_PLAYWRIGHT_PROFILE", "MDT_VIDEO_PLAYWRIGHT_PROFILE"):
        s = (os.environ.get(k) or "").strip()
        if s:
            return s
    return "default"


def _try_set_input_files_on(root: Any, vpath: str) -> bool:
    """root 为 Page 或 Frame；成功则返回 True。隐藏 input 也可用 set_input_files。"""
    for sel in (
        "input[type=file][accept*=\"video\" i]",
        "input[type=file]",
    ):
        loc = root.locator(sel)
        if loc.count() == 0:
            continue
        el = loc.first
        try:
            el.wait_for(state="attached", timeout=10000)
            el.set_input_files(vpath, timeout=15000)
            return True
        except Exception:
            continue
    return False


def _douyin_attach_video_file(page: Any, vpath: str) -> bool:
    """
    上传页常为 SPA：file 可能在 iframe、或需先点「上传」才挂到 DOM。
    依次尝试：各 frame → 主文档多选择器 → 点常见上传文案 → expect_file_chooser。
    """
    # 1) 子 frame（创作台常把上传区放在 iframe）
    for fr in page.frames:
        if fr is page.main_frame:
            continue
        if _try_set_input_files_on(fr, vpath):
            return True

    # 2) 主文档直接 set
    if _try_set_input_files_on(page, vpath):
        return True

    # 3) 先点「上传/选择」类区域，再试
    for label in (
        "上传视频",
        "视频上传",
        "本地上传",
        "点击上传",
        "选择视频",
        "添加视频",
    ):
        try:
            t = page.get_by_text(re.compile(label), exact=False)
            if t.count() == 0:
                continue
            t.first.click(timeout=4000)
            pwc.human_ms(800, 1600)
            for fr in page.frames:
                if _try_set_input_files_on(fr, vpath):
                    return True
            if _try_set_input_files_on(page, vpath):
                return True
        except Exception:
            continue

    # 4) 系统文件选择框（无常驻 input 时，点击会触发 file chooser）
    try:
        with page.expect_file_chooser(timeout=25000) as fc_info:
            clicked = False
            t = page.get_by_text(
                re.compile("本地上传|选择视频|上传视频|点击上传|添加视频|选择文件"),
                exact=False,
            )
            if t.count() > 0:
                t.first.click(timeout=8000, force=True)
                clicked = True
            if not clicked:
                b = page.get_by_role("button", name=re.compile("上传|选择"))
                if b.count() > 0:
                    b.first.click(timeout=8000, force=True)
                    clicked = True
            if not clicked:
                for sel in ('[class*="upload" i]', '[class*="drop" i]'):
                    u = page.locator(sel)
                    if u.count() > 0:
                        u.first.click(timeout=5000, force=True)
                        clicked = True
                        break
        fc_info.value.set_files(vpath)
        return True
    except Exception as e:
        if (os.environ.get("MDT_DEBUG", "").strip() == "1"):
            pwc.log(f"file_chooser: {e}")

    return False


def _wait_for_spa_douyin(page: Any) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass
    pwc.human_ms(2000, 4000)
    # 等任意上传相关节点出现，避免马上找 file
    for _i in range(30):
        if (
            page.locator("input[type=file]").count() > 0
            or page.get_by_text(re.compile("上传|视频|选择"), exact=False).count() > 0
        ):
            return
        pwc.human_ms(400, 800)


def _float_env(name: str, default: float, lo: float, hi: float) -> float:
    try:
        v = float((os.environ.get(name) or str(default)).strip() or default)
    except ValueError:
        v = default
    return max(lo, min(hi, v))


def _douyin_wait_for_login(page: Any) -> int:
    """若在登录页，阻塞等待用户登录（与视频号一致策略）。"""
    u = page.url.lower()
    if not any(x in u for x in ("login", "passport", "ssologin")):
        return 0
    sec = _float_env("MDT_DOUYIN_LOGIN_WAIT_SEC", 600.0, 60.0, 3600.0)
    pwc.log(f"  当前为抖音登录页，请在窗口内完成登录（最长约 {int(sec)} 秒）…")
    deadline = time.monotonic() + sec
    while time.monotonic() < deadline:
        u2 = page.url.lower()
        if not any(x in u2 for x in ("login", "passport", "ssologin")):
            pwc.log("  已离开登录页。")
            return 0
        pwc.human_ms(2000, 3500)
    pwc.err("抖音登录等待超时。")
    return 2


def _douyin_footer_primary_publish_button(page: Any) -> Any:
    """
    发布设置最底部主操作红色「发布」。
    「发布时间」里的「立即发布」是单选项，不是底部主按钮；优先与「暂存离开」同条工具栏。
    """
    try:
        bar = page.locator("div").filter(has_text="暂存离开").first
        if bar.count() > 0:
            inner = bar.locator('button:has-text("发布")')
            if inner.count() > 0:
                return inner
    except Exception:
        pass
    try:
        return page.get_by_role("button", name="发布", exact=True).last
    except Exception:
        pass
    return page.locator('button:has-text("发布")').last


def _wait_douyin_publish_button_ready(page: Any) -> Any:
    """
    上传/转码完成后，底部「发布」会由灰变可点；轮询直至可点或超时。
    返回可定位到底部主按钮的 Locator（可能 count=0）。
    """
    max_sec = _float_env("MDT_DOUYIN_PROCESS_WAIT_SEC", 600.0, 30.0, 3600.0)
    deadline = time.monotonic() + max_sec
    last_log = 0.0
    while time.monotonic() < deadline:
        try:
            pub = _douyin_footer_primary_publish_button(page)
            p0 = pub.first
            try:
                en = p0.is_enabled()
            except Exception:
                en = True
            if en:
                pwc.log("  底部「发布」已可点击。")
                return pub
        except Exception:
            pass
        now = time.monotonic()
        if now - last_log > 12:
            pwc.log("  等待转码/处理完成，直至底部「发布」按钮亮起…")
            last_log = now
        pwc.human_ms(2000, 4000)
    pwc.log("  等待已超时，仍将尝试点击底部「发布」（可加大 MDT_DOUYIN_PROCESS_WAIT_SEC）。")
    return _douyin_footer_primary_publish_button(page)


def _douyin_scroll_footer_publish_into_view(page: Any) -> None:
    try:
        _douyin_footer_primary_publish_button(page).first.scroll_into_view_if_needed(
            timeout=12000
        )
    except Exception:
        try:
            page.get_by_text("发布设置", exact=False).first.scroll_into_view_if_needed(
                timeout=8000
            )
        except Exception:
            pass
    pwc.human_ms(300, 600)


def _douyin_scroll_to_bottom_and_check_terms(page: Any) -> None:
    """
    滚到底部；若出现「阅读并同意」等协议，尽量勾选。不碰合集/封面/活动区。
    """
    try:
        page.evaluate(
            "window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))"
        )
    except Exception:
        pass
    pwc.human_ms(500, 900)
    try:
        for _ in range(3):
            page.mouse.wheel(0, 2000)
            pwc.human_ms(200, 400)
    except Exception:
        pass
    try:
        labs = page.get_by_text(re.compile(r"阅读.*同意|已阅读"))
        n = labs.count()
        for i in range(min(n, 5)):
            try:
                lab = labs.nth(i)
                row = lab.locator("xpath=ancestor::label[1] | ancestor::div[1]")
                cb = row.locator('input[type="checkbox"]')
                if cb.count() > 0 and not cb.first.is_checked():
                    cb.first.click(timeout=2000, force=True)
            except Exception:
                continue
    except Exception:
        pass


def _douyin_target_closed(e: Exception) -> bool:
    n = type(e).__name__
    return "TargetClosed" in n or "BrowserClosed" in n


def _douyin_scroll_to_publish_settings(page: Any) -> None:
    try:
        t = page.get_by_text("发布设置", exact=False)
        if t.count() > 0:
            t.first.scroll_into_view_if_needed(timeout=12000)
            pwc.human_ms(400, 900)
            return
    except Exception:
        pass
    try:
        page.evaluate(
            "window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))"
        )
    except Exception:
        pass
    pwc.human_ms(500, 1000)
    try:
        page.mouse.wheel(0, 4000)
    except Exception:
        pass
    pwc.human_ms(400, 800)


def _douyin_env_schedule_enabled() -> bool:
    raw = (os.environ.get("MDT_DOUYIN_SCHEDULE") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "immediate", "即时")


def _douyin_schedule_hour_minute() -> tuple[int, int]:
    try:
        h = int((os.environ.get("MDT_DOUYIN_SCHEDULE_HOUR") or "8").strip() or 8)
    except ValueError:
        h = 8
    try:
        m = int((os.environ.get("MDT_DOUYIN_SCHEDULE_MINUTE") or "30").strip() or 30)
    except ValueError:
        m = 30
    return max(0, min(23, h)), max(0, min(59, m))


def _douyin_next_schedule_datetime() -> datetime:
    h, m = _douyin_schedule_hour_minute()
    now = datetime.now()
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target


def _douyin_click_not_simultaneous_publish(page: Any) -> None:
    """同时发布 → 选「不同时发布」（优先在「同时发布」一行内点，避免误点）。"""
    try:
        row = page.locator("div,li,tr").filter(has_text="同时发布").first
        if row.count() > 0:
            opt = row.get_by_text("不同时发布", exact=False)
            if opt.count() > 0:
                opt.first.click(timeout=8000)
                pwc.log("  已选「不同时发布」。")
                pwc.human_ms(400, 800)
                return
    except Exception:
        pass
    for fn in (
        lambda: page.get_by_text("不同时发布", exact=True).first.click(timeout=6000),
        lambda: page.locator('label:has-text("不同时发布")').locator("input").first.click(
            timeout=5000, force=True
        ),
    ):
        try:
            fn()
            pwc.log("  已选「不同时发布」。")
            pwc.human_ms(400, 800)
            return
        except Exception:
            continue


def _douyin_ensure_public_audience(page: Any) -> None:
    """谁可以看 → 公开。"""
    try:
        row = page.locator("div,li,tr").filter(has_text="谁可以看").first
        if row.count() > 0:
            opt = row.get_by_text("公开", exact=True)
            if opt.count() > 0:
                opt.first.click(timeout=8000)
                pwc.log("  已选「谁可以看」= 公开。")
                pwc.human_ms(300, 600)
                return
    except Exception:
        pass
    for fn in (
        lambda: page.get_by_role("radio", name=re.compile("^公开$")).first.click(
            timeout=6000
        ),
        lambda: page.locator('label:has-text("公开")').filter(
            has=page.locator('input[type="radio"]')
        ).first.click(timeout=6000, force=True),
    ):
        try:
            fn()
            pwc.log("  已选「公开」。")
            pwc.human_ms(300, 600)
            return
        except Exception:
            continue


def _douyin_save_permission_disallow(page: Any) -> None:
    """保存权限 → 不允许。"""
    try:
        row = page.locator("div,li,tr").filter(has_text="保存权限").first
        if row.count() > 0:
            opt = row.get_by_text("不允许", exact=True)
            if opt.count() > 0:
                opt.first.click(timeout=8000)
                pwc.log("  已选保存权限「不允许」。")
                pwc.human_ms(300, 600)
                return
    except Exception:
        pass
    for fn in (
        lambda: page.get_by_role("radio", name=re.compile("^不允许$")).first.click(
            timeout=6000
        ),
        lambda: page.locator('label:has-text("不允许")').filter(
            has=page.locator('input[type="radio"]')
        ).last.click(timeout=6000, force=True),
    ):
        try:
            fn()
            pwc.log("  已选保存权限「不允许」。")
            pwc.human_ms(300, 600)
            return
        except Exception:
            continue


def _douyin_set_scheduled_publish_time(page: Any, when: datetime) -> None:
    """发布时间 → 定时发布 + 日期时间（与 social-auto-upload semi-input 一致）。"""
    clicked = False
    try:
        row = page.locator("div,li,tr").filter(has_text="发布时间").first
        if row.count() > 0:
            opt = row.get_by_text("定时发布", exact=False)
            if opt.count() > 0:
                opt.first.click(timeout=8000)
                clicked = True
                pwc.human_ms(600, 1200)
    except Exception:
        pass
    if not clicked:
        for fn in (
            lambda: page.locator("[class^='radio']:has-text('定时发布')").first.click(
                timeout=8000
            ),
            lambda: page.get_by_text("定时发布", exact=True).last.click(timeout=8000),
            lambda: page.get_by_role("radio", name=re.compile("定时发布")).last.click(
                timeout=8000
            ),
        ):
            try:
                fn()
                pwc.human_ms(600, 1200)
                clicked = True
                break
            except Exception:
                continue
    if not clicked:
        pwc.log("  未点到「定时发布」（可手选）。")
        return
    hr = when.strftime("%Y-%m-%d %H:%M")
    try:
        dt_in = page.locator(
            '.semi-input[placeholder="日期和时间"], '
            '[class*="semi-input"][placeholder*="日期"], input[placeholder*="日期和时间"]'
        ).first
        dt_in.wait_for(state="visible", timeout=20000)
        dt_in.click(timeout=5000)
        pwc.human_ms(300, 600)
        mk = _mod_key()
        page.keyboard.press(f"{mk}+KeyA")
        page.keyboard.type(hr, delay=40)
        page.keyboard.press("Enter")
        pwc.human_ms(400, 800)
        pwc.log(f"  已尝试定时: {hr}")
    except Exception as e:
        pwc.log(f"  定时输入（可手改）: {e}")


def _douyin_apply_publish_settings(page: Any) -> None:
    _douyin_scroll_to_publish_settings(page)
    _douyin_click_not_simultaneous_publish(page)
    _douyin_ensure_public_audience(page)
    _douyin_save_permission_disallow(page)
    if _douyin_env_schedule_enabled():
        when = _douyin_next_schedule_datetime()
        pwc.log(
            f"  定时至: {when.strftime('%Y-%m-%d %H:%M')}（MDT_DOUYIN_SCHEDULE=0 可改为立即发）",
        )
        _douyin_set_scheduled_publish_time(page, when)
    else:
        try:
            page.locator("[class^='radio']:has-text('立即发布')").first.click(
                timeout=6000
            )
            pwc.log("  已选「立即发布」。")
        except Exception:
            try:
                page.get_by_text("立即发布", exact=True).first.click(timeout=6000)
            except Exception:
                pass
    pwc.human_ms(600, 1200)


def _douyin_wait_video_processed(page: Any) -> None:
    """尽量等上传完成后再点「发布」（出现「重新上传」等标志）。"""
    max_sec = _float_env("MDT_DOUYIN_PROCESS_WAIT_SEC", 600.0, 30.0, 3600.0)
    deadline = time.monotonic() + max_sec
    last_log = 0.0
    while time.monotonic() < deadline:
        try:
            if page.get_by_text("重新上传", exact=False).count() > 0:
                pwc.log("  检测到「重新上传」，上传应已完成。")
                return
        except Exception:
            pass
        try:
            if page.locator("div:has-text(\"重新上传\")").count() > 0:
                return
        except Exception:
            pass
        now = time.monotonic()
        if now - last_log > 14:
            pwc.log("  等待视频上传/处理…")
            last_log = now
        pwc.human_ms(1800, 2800)


def _douyin_maybe_confirm_dialogs(page: Any) -> None:
    """
    若出现**独立弹窗**上的「确认/确定」（勿用逐字符 for，否则会点「发」「布」等单字）。
    """
    pwc.human_ms(1500, 2500)
    confirm = re.compile(r"^(确认|确定|知道了|同意|继续发布|我知道了)$")
    for _ in range(4):
        try:
            b = page.get_by_role("button", name=confirm)
            n = b.count()
            if n == 0:
                break
            clicked = False
            for i in range(min(n, 6)):
                try:
                    bi = b.nth(i)
                    if bi.is_visible():
                        bi.click(timeout=6000)
                        pwc.log("  已点弹窗内确认/同意类按钮。")
                        clicked = True
                        pwc.human_ms(1000, 2000)
                        break
                except Exception as e:
                    if _douyin_target_closed(e):
                        return
            if not clicked:
                break
        except Exception as e:
            if _douyin_target_closed(e):
                return
            break


def _publish_douyin(page: Any) -> int:
    vpath = (os.environ.get("MDT_DOUYIN_VIDEO") or "").strip()
    title = (os.environ.get("MDT_DOUYIN_TITLE") or "").strip()
    body = (os.environ.get("MDT_DOUYIN_BODY") or "").strip()
    if not vpath or not os.path.isfile(vpath):
        pwc.err("MDT_DOUYIN_VIDEO 无效或不是文件。")
        return 1
    if not title:
        pwc.err("需要 MDT_DOUYIN_TITLE。")
        return 1
    if not body:
        body = title
    ext_tags = _tags_from_env()
    if ext_tags and not re.search(r"#\S", body):
        body = body.rstrip() + "\n" + " ".join(f"#{t}" for t in ext_tags)

    target = _douyin_target_url()
    pwc.log(f"  打开发布页: {target}")
    try:
        page.set_viewport_size({"width": 1440, "height": 900})
    except Exception:
        pass
    page.goto(target, wait_until="load", timeout=90000)
    pwc.human_ms(1500, 3000)
    ulow = page.url.lower()
    if "login" in ulow or "passport" in ulow or "ssologin" in ulow:
        li = _douyin_wait_for_login(page)
        if li != 0:
            return li

    _wait_for_spa_douyin(page)
    if not _douyin_attach_video_file(page, vpath):
        pwc.err(
            "未找到可用的视频上传控件（已尝试 iframe、多类按钮与 file chooser）。"
            " 请确认已登录；可设 MDT_DOUYIN_URL= 为创作中心能直接点「上传」的地址；"
            " 或 MDT_PLAYWRIGHT_MANUAL_CLICK=1 先手动点出上传区再重试。",
        )
        return 3
    pwc.log(f"  已选择视频: {os.path.basename(vpath)}")

    for _i in range(100):
        n_in = page.locator('input[placeholder*="标题" i], input[placeholder*="作品" i]').count()
        n_ph = page.get_by_placeholder(re.compile(r"填写作品标题|更多流量|添加作品简介")).count()
        n_ta = page.locator("textarea").count()
        if n_in > 0 or n_ta > 0 or n_ph > 0:
            break
        pwc.human_ms(800, 1500)
    pwc.human_ms(2000, 4000)

    # ① 基础信息：作品标题 + 作品简介/话题（插件侧已按小红书正文+# 注入 MDT_DOUYIN_BODY）
    ok_fill = _douyin_fill_placeholder_ui(page, title, body)
    if not ok_fill:
        ok_fill = _douyin_fill_via_work_desc_block(page, title, body)
    if not ok_fill:
        pwc.log("  新版权与「作品描述」块未成功，回退到通用 placeholder/textarea。")
        filled = False
        for sub in ("标题", "作品", "填写"):
            loc = page.locator(f"input[placeholder*=\"{sub}\" i]")
            if loc.count() > 0:
                try:
                    loc.first.fill((title or "")[:30], timeout=5000)
                    filled = True
                    break
                except Exception:
                    pass
        if not filled:
            try:
                page.get_by_placeholder(re.compile("标题|作品|获得更多流量")).fill(
                    (title or "")[:30], timeout=5000
                )
            except Exception:
                pwc.log("  未自动找到标题框，可手动或半自动。")
        if body:
            pwc.human_ms(500, 1000)
            try:
                ta = page.locator("textarea")
                if ta.count() > 0:
                    t0 = ta.first
                    t0.wait_for(state="attached", timeout=15000)
                    t0.fill(body, timeout=15000)
                else:
                    ed = page.locator('[contenteditable="true"]')
                    if ed.count() > 0:
                        ed.first.click()
                        pwc.human_ms(200, 400)
                        page.keyboard.type(body, delay=4)
            except Exception as e:
                pwc.log(f"  简介未自动填写（可手补）: {e}")
    else:
        pwc.log("  已填写作品标题与简介（新 UI 或「作品描述」卡片）。")

    if pwc.manual_click_from_env():
        pwc.log("已按半自动：未点击发布。")
        return 0

    # ② 不操作：官方活动、设置封面、合集、视频章节（脚本不点击对应区域）
    # ③ 等视频上传/处理
    pwc.log("  等待上传与处理（识别「重新上传」等）…")
    _douyin_wait_video_processed(page)

    # ④ 发布设置：同时发布/可见性/保存权限/定时
    pwc.log("  配置「发布设置」…")
    _douyin_apply_publish_settings(page)

    # ⑤ 协议等（若存在）+ 将底部主「发布」滚入视口
    _douyin_scroll_to_bottom_and_check_terms(page)
    _douyin_scroll_footer_publish_into_view(page)

    pub = _wait_douyin_publish_button_ready(page)
    if pub.count() == 0:
        pwc.err("未找到底部主「发布」按钮。若视频仍在转码，可调大 MDT_DOUYIN_PROCESS_WAIT_SEC 后重试。")
        return 3
    try:
        pub.first.scroll_into_view_if_needed()
        pwc.human_ms(800, 1500)
        try:
            pub.first.click(timeout=20000)
        except Exception:
            pub.first.click(timeout=20000, force=True)
    except Exception as e:
        if _douyin_target_closed(e):
            pwc.log("  页面已关闭（若作品已发出可忽略）。")
            return 0
        pwc.err(f"点击发布失败: {e}")
        return 3
    try:
        _douyin_maybe_confirm_dialogs(page)
    except Exception as e:
        if _douyin_target_closed(e):
            pwc.log("  发布流程中页面已关闭（请至抖音确认是否已发出）。")
            return 0
        raise
    pwc.log("  已操作发布/确认；请在抖音 App/网页端核对作品已发出。")
    return 0


def main() -> int:
    if os.environ.get("MDT_DRY_RUN", "").strip() == "1":
        pwc.log("🔍 dry-run: 不启动浏览器。")
        t0 = os.environ.get("MDT_DOUYIN_TITLE", "")
        pwc.log(
            f"  video={os.environ.get('MDT_DOUYIN_VIDEO', '')!r}  title={t0!r} …"
        )
        return 0
    try:
        import importlib  # noqa: F401

        importlib.import_module("playwright")
    except ImportError:
        pwc.err("未安装 Playwright。请在 venv: pip install playwright && python -m playwright install chromium")
        return 1

    def _run() -> int:
        pw: Any = None
        br: Any = None
        ctx: Any = None
        page: Any = None
        rc = 1
        try:
            res = pwc.get_playwright_page("douyin_playwright", _profile_name())
            pw, br, ctx, page, _ = res
            rc = _publish_douyin(page)
        except Exception as e:
            pwc.excepthook_screenshot(page, "douyin", e)
            rc = 1
        finally:
            k = pwc.keep_open_on_fail_from_env() and rc != 0
            pwc.close_playwright_session(pw, br, ctx, keep_open=k, rc=rc)
        return rc

    return pwc.run_in_playwright_isolated_thread(_run)


if __name__ == "__main__":
    sys.exit(main())
