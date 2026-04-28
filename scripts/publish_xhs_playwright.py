#!/usr/bin/env python3
"""
md-to-platform：使用 Playwright 在浏览器中发布小红书图文（可选独立 Chrome + CDP 复用登录态）。

与 publish_xhs_redbook.py 共用 publish_xhs.md 解析与图片目录约定，由 Obsidian 注入环境变量后调用。

发布页入口与 https://github.com/dreammis/social-auto-upload 一致：视频
`.../publish/publish?from=homepage&target=video`，图文 `...&target=image`；可选
`MDT_XHS_PUBLISH_URL` 覆盖为单一地址（两种流程共用）。

环境变量（与 redbook 脚本对齐）:
  MDT_XHS_IMAGES_DIR, MDT_PUBLISH_XHS, MDT_DRY_RUN, MDT_VAULT_ROOT,
  MDT_XHS_AS_PRIVATE, MDT_DEBUG

**视频**（与图文二选一，优先 MDT_XHS_VIDEO_PATH 为有效文件时走视频流）:
  MDT_XHS_VIDEO_PATH  本机 MP4
  标题/正文可来自 MDT_XHS_VIDEO_TITLE、MDT_XHS_VIDEO_DESC、MDT_XHS_VIDEO_TAGS（逗号分隔）；
  或仍提供 MDT_PUBLISH_XHS 以解析与图文相同的「标题1：」、正文、末行 #话题

Playwright 专用:
  MDT_XHS_PLAYWRIGHT_PROFILE  子目录名，默认 default
  MDT_XHS_PLAYWRIGHT_HEADED   1=有头（默认），0=无头；或通用 MDT_PLAYWRIGHT_HEADED
  MDT_XHS_PLAYWRIGHT_MANUAL_CLICK  1=只填表不点发布
  MDT_XHS_PLAYWRIGHT_KEEP_OPEN  1=失败时保持浏览器不关
  MDT_XHS_LOGIN_WAIT_SEC  未登录时等待扫码/登录的最长秒数（默认 600），避免一打开登录页就结束
  MDT_XHS_PUBLISH_URL  可选，覆盖发布页 URL

**视频发布**（与抖音一致：正文+# 话题；不操作章节/合集/添加组件）:
  MDT_XHS_VIDEO_ORIGINAL=1   默认打开「原创声明」开关（0=不点）
  MDT_XHS_VIDEO_SCHEDULE=1   默认开「定时发布」至当天/次日早上（见下）
  MDT_XHS_SCHEDULE_HOUR      默认 9
  MDT_XHS_SCHEDULE_MINUTE    默认 0
  MDT_XHS_AS_PRIVATE=0       与「公开可见」一致时设 0（默认由设置注入；脚本在更多设置里确保公开）
  MDT_XHS_VIDEO_PROCESS_WAIT_SEC  上传后等界面稳定、至可点「发布」的最长秒数（默认 600）
"""

from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

# 同目录
_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import mdtp_playwright_core as pwc  # noqa: E402
import publish_xhs_redbook as mdtp  # noqa: E402

# 与 social-auto-upload uploader/xiaohongshu 一致，减少多一次切 tab / 路由漂移
XHS_PUBLISH_VIDEO_URL = (
    "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video"
)
XHS_PUBLISH_NOTE_URL = (
    "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image"
)
XHS_CREATOR_URL = "https://creator.xiaohongshu.com"
XHS_LOGIN_URL = "https://creator.xiaohongshu.com/login"

# 参考 xhs-auto-cy：中文字符/标点计 2，ASCII 计 1
_MAX_TITLE_WEIGHT = 38

_log = pwc.log
_err = pwc.err
_human_ms = pwc.human_ms


def _xhs_publish_entry_url(*, video: bool) -> str:
    o = (os.environ.get("MDT_XHS_PUBLISH_URL") or "").strip()
    if o:
        return o
    return XHS_PUBLISH_VIDEO_URL if video else XHS_PUBLISH_NOTE_URL


def _title_weight(s: str) -> int:
    w = 0
    for ch in s:
        w += 2 if ord(ch) > 127 else 1
    return w


def _trim_title_for_xhs(s: str) -> str:
    t = s.strip()
    while _title_weight(t) > _MAX_TITLE_WEIGHT and t:
        t = t[:-1]
    return t


def _parse_playwright_title_desc(pub_text: str) -> tuple[str, str]:
    """
    正文描述与 mdtp.parse_publish_xhs_mdtp 一致。
    标题在网页端可更长，优先取「标题1：」全宽纯文本，再回退 mdtp 的短标题。
    """
    t1 = re.search(r"标题\s*[1１一]\s*[：:]\s*(.+?)(?:\n|$)", pub_text)
    if t1:
        title = mdtp._to_plain_title_for_xhs_api(t1.group(1).strip())
    else:
        title, _ = mdtp.parse_publish_xhs_mdtp(pub_text)
    title = _trim_title_for_xhs(title)
    _, desc = mdtp.parse_publish_xhs_mdtp(pub_text)
    return title, desc


def _extract_topics_from_content(content: str) -> tuple[str, list[str]]:
    """末行全为 #tag 时抽出话题并从正文删除该行（对齐 xhs-auto-cy）。"""
    lines = content.rstrip().split("\n")
    if not lines:
        return content, []
    last = lines[-1].strip()
    tags = re.findall(r"#(\S+)", last)
    rem = re.sub(r"#\S+", "", last).strip()
    if tags and not rem:
        return "\n".join(lines[:-1]).rstrip(), tags
    return content, []


def _mod_key() -> str:
    import platform

    return "Meta" if platform.system() == "Darwin" else "Control"


def _xhs_desc_merge_tags_like_douyin(body: str, extra_tags: list[str]) -> str:
    """正文 + #话题：与抖音侧一致；正文已含 # 则不再重复追加 env 话题。"""
    body = (body or "").strip()
    if not extra_tags or re.search(r"#\S", body):
        return body
    return body.rstrip() + "\n" + " ".join(f"#{t}" for t in extra_tags if t)


def _xhs_env_video_original() -> bool:
    return (os.environ.get("MDT_XHS_VIDEO_ORIGINAL") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _xhs_env_video_schedule() -> bool:
    return (os.environ.get("MDT_XHS_VIDEO_SCHEDULE") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _xhs_schedule_hour_minute() -> tuple[int, int]:
    try:
        h = int((os.environ.get("MDT_XHS_SCHEDULE_HOUR") or "9").strip() or 9)
    except ValueError:
        h = 9
    try:
        m = int((os.environ.get("MDT_XHS_SCHEDULE_MINUTE") or "0").strip() or 0)
    except ValueError:
        m = 0
    return max(0, min(23, h)), max(0, min(59, m))


def _xhs_next_schedule_datetime() -> datetime:
    h, m = _xhs_schedule_hour_minute()
    now = datetime.now()
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target


def _xhs_video_process_wait_sec() -> float:
    try:
        v = float(
            (os.environ.get("MDT_XHS_VIDEO_PROCESS_WAIT_SEC") or "600").strip() or 600.0
        )
    except ValueError:
        v = 600.0
    return max(30.0, min(3600.0, v))


def _xhs_scroll_try(page: Any, *labels: str) -> None:
    for lab in labels:
        try:
            t = page.get_by_text(lab, exact=False).first
            t.scroll_into_view_if_needed(timeout=12000)
            _human_ms(400, 800)
            return
        except Exception:
            continue
    try:
        page.evaluate(
            "window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) * 0.45)"
        )
    except Exception:
        pass
    _human_ms(400, 600)


def _xhs_set_switch_on(page: Any, label: str) -> None:
    """在含 label 的行内找 [role=switch] 并拨到打开（原创声明 / 定时发布）。"""
    for _ in range(4):
        try:
            row = page.locator("div,li,section,tr").filter(has_text=label).first
            if row.count() == 0:
                row = page.get_by_text(label, exact=False).first.locator(
                    "xpath=ancestor::div[contains(@class,'item') or contains(@class,'row') or contains(@class,'cell')][1]"
                )
            row.scroll_into_view_if_needed(timeout=10000)
            sw = row.locator(
                '[role="switch"], button[role="switch"], [class*="switch"]'
            ).first
            if sw.count() == 0:
                break
            ac = (sw.get_attribute("aria-checked") or "").lower()
            data = (sw.get_attribute("data-state") or "").lower()
            if ac in ("true", "1") or data == "checked":
                _log(f"  「{label}」已为开。")
                return
            sw.click(timeout=6000, force=True)
            _human_ms(500, 1000)
        except Exception:
            break
    _log(f"  未能自动打开「{label}」开关（可手点）。")


def _xhs_ensure_public_visible(page: Any) -> None:
    """更多设置：「公开可见」选 公开。"""
    _xhs_scroll_try(page, "更多设置", "公开可见")
    try:
        row = page.locator("div,li,section").filter(has_text="公开可见").first
        if row.count() > 0:
            row.scroll_into_view_if_needed(timeout=10000)
            dd = row.locator(
                '[class*="select"], [class*="Dropdown"], [class*="trigger"]'
            ).first
            if dd.count() > 0:
                dd.click(timeout=5000)
                _human_ms(400, 800)
            pub = page.locator(
                '[role="option"]:has-text("公开"), li:has-text("公开"), div[role="option"]'
            ).filter(has_text=re.compile(r"^公开$"))
            if pub.count() > 0:
                pub.first.click(timeout=5000)
            else:
                row.get_by_text("公开", exact=True).first.click(timeout=5000)
            _log("  已选「公开可见」= 公开。")
            return
    except Exception as e:
        _log(f"  公开可见: {e}")
    _log("  未能自动展开「公开可见」（可能已是公开）。")


def _xhs_set_schedule_datetime_picker(page: Any, when: datetime) -> None:
    """定时发布开盖后填写时间（常见 input / semi / 原生选择器）。"""
    mk = _mod_key()
    s = when.strftime("%Y-%m-%d %H:%M")
    try:
        dt_in = page.locator(
            'input[placeholder*="时间"], input[placeholder*="日期"], '
            'input[placeholder*="选择"], [class*="semi-input"]'
        ).first
        if dt_in.count() > 0:
            dt_in.click(timeout=5000)
            _human_ms(300, 500)
            page.keyboard.press(f"{mk}+a")
            page.keyboard.type(s, delay=35)
            page.keyboard.press("Enter")
            _log(f"  已尝试定时: {s}")
            return
    except Exception as e:
        _log(f"  定时输入: {e}")


def _xhs_apply_video_extras(
    page: Any,
    private: bool,
) -> None:
    """
    不操作：添加章节、加入合集、添加组件等。
    操作：原创声明；非私密时「公开可见」；可选定时发布。
    """
    _human_ms(800, 1500)
    _xhs_scroll_try(page, "内容设置", "原创声明", "视频文件")
    if _xhs_env_video_original():
        _xhs_set_switch_on(page, "原创声明")

    if not private:
        _xhs_ensure_public_visible(page)

    if _xhs_env_video_schedule():
        _xhs_scroll_try(page, "更多设置", "定时发布")
        when = _xhs_next_schedule_datetime()
        _log(
            f"  定时发布至: {when.strftime('%Y-%m-%d %H:%M')}"
            f"（MDT_XHS_VIDEO_SCHEDULE=0 可关）"
        )
        _xhs_set_switch_on(page, "定时发布")
        _human_ms(600, 1200)
        _xhs_set_schedule_datetime_picker(page, when)
    _human_ms(500, 900)


def _xhs_wait_video_form_ready(
    page: Any,
    max_sec: float,
) -> None:
    deadline = time.monotonic() + max_sec
    while time.monotonic() < deadline:
        try:
            if page.get_by_text("重新上传", exact=False).count() > 0:
                if page.get_by_placeholder(re.compile(r"标题|更多赞|写个标题", re.I)).count() > 0:
                    return
        except Exception:
            pass
        if page.get_by_placeholder(re.compile(r"标题|更多赞|写个标题", re.I)).count() > 0:
            return
        _human_ms(1000, 1800)
    _log("  未严格等到「重新上传/标题」；继续尝试填表。")


def _xhs_find_publish_button(page: Any) -> Any:
    p = page.get_by_role("button", name=re.compile(r"^发布$"))
    if p.count() > 0:
        return p.first
    b = page.locator('button:has-text("发布")')
    return b.last if b.count() > 0 else b.first


def _get_page() -> tuple[Any, Any, Any, Any, Path]:
    name = (os.environ.get("MDT_XHS_PLAYWRIGHT_PROFILE") or "default").strip() or "default"
    return pwc.get_playwright_page("xhs_playwright", name)


def _check_logged_in(page: Any) -> bool:
    try:
        page.goto(XHS_CREATOR_URL, wait_until="domcontentloaded", timeout=30000)
        _human_ms(500, 1200)
        if "login" in page.url.lower():
            return False
        return True
    except Exception:
        return False


def _xhs_float_wait_sec(name: str, default: float) -> float:
    try:
        v = float((os.environ.get(name) or str(default)).strip() or default)
    except ValueError:
        v = default
    return max(60.0, min(3600.0, v))


def _xhs_wait_until_logged_in(page: Any) -> int:
    """
    已登录则 0；否则打开登录页并**等待**用户完成登录（不再立即 return 2 关浏览器）。
    """
    if _check_logged_in(page):
        return 0
    sec = _xhs_float_wait_sec("MDT_XHS_LOGIN_WAIT_SEC", 600.0)
    _log(
        f"未检测到已登录。请在弹出的窗口内完成扫码/登录（本脚本会等待最久约 {int(sec)} 秒，勿主动关闭）…",
    )
    try:
        page.goto(XHS_LOGIN_URL, wait_until="domcontentloaded", timeout=45000)
    except Exception:
        pass
    deadline = time.monotonic() + sec
    while time.monotonic() < deadline:
        try:
            page.goto(XHS_CREATOR_URL, wait_until="domcontentloaded", timeout=35000)
        except Exception:
            pass
        _human_ms(2000, 3500)
        u = page.url.lower()
        if "login" not in u and "ssologin" not in u:
            _log("已检测到已登录，继续发布流程。")
            return 0
        _log("  仍在等待登录…")
    _err("等待登录超时。可增大 MDT_XHS_LOGIN_WAIT_SEC 后重试。")
    return 2


def _input_topics(page: Any, topics: list[str]) -> None:
    m = _mod_key()
    for i, tag in enumerate(topics[:10]):
        ed = page.locator('[contenteditable="true"]')
        if ed.count() == 0:
            _log("未找到正文编辑器，跳过后续话题。")
            return
        ed.first.click()
        _human_ms(200, 400)
        page.keyboard.press(f"{m}+ArrowDown")
        _human_ms(200, 300)
        page.keyboard.press("End")
        _human_ms(200, 300)
        page.keyboard.type("#", delay=80)
        _human_ms(800, 1200)
        page.keyboard.type(tag, delay=40)
        _human_ms(2000, 3000)
        page.keyboard.press("Enter")
        _human_ms(1000, 1500)
        _log(f"  已尝试添加话题 {i+1}: #{tag}")


def _set_private(page: Any) -> None:
    _log("正在设置仅自己可见…")
    try:
        page.mouse.wheel(0, 800)
        _human_ms(300, 600)
    except Exception:
        pass
    public_btn = page.get_by_text("公开可见", exact=False)
    if public_btn.count() == 0:
        _log("未找到「公开可见」控件，请手动设置可见性。")
        return
    try:
        public_btn.first.scroll_into_view_if_needed(timeout=5000)
        _human_ms(200, 400)
        public_btn.first.click(force=True, timeout=5000)
        _human_ms(1000, 1500)
        private_opt = page.get_by_text("仅自己可见", exact=False)
        private_opt.first.wait_for(state="visible", timeout=5000)
        private_opt.first.click(force=True, timeout=5000)
        _human_ms(300, 600)
    except Exception as e:
        _log(f"自动设置仅自己可见失败：{e}")


def _publish_flow(page: Any, title: str, content: str, images: list[str], preview: bool, private: bool) -> int:
    page.goto(_xhs_publish_entry_url(video=False), wait_until="domcontentloaded", timeout=45000)
    _human_ms(1000, 2000)
    if "login" in page.url.lower():
        _err("需要登录创作服务平台。请在本机已打开的 Chrome 中扫码/登录后，再点一次「发布小红书」。")
        return 2

    img_tab = page.locator('.creator-tab:has-text("上传图文")')
    if img_tab.count() > 0:
        try:
            img_tab.first.evaluate("el => el.click()")
            _log("已切换到「上传图文」。")
        except Exception:
            pass
        _human_ms(500, 1000)

    fin = page.locator('input[type="file"]')
    try:
        fin.first.wait_for(state="attached", timeout=20000)
    except Exception:
        _err("发布页上未找到图片上传控件，可能页面已改版。")
        return 3

    for idx, img_path in enumerate(images):
        file_in = page.locator("input[type=file]")
        file_in.first.set_input_files(img_path)
        _log(f"  已上传 {idx+1}/{len(images)}: {os.path.basename(img_path)}")
        _human_ms(2000, 3500)

    ti = page.locator('[placeholder*="标题"]')
    if ti.count() > 0:
        ti.first.click()
        _human_ms(200, 400)
        page.keyboard.type(title, delay=25)
    else:
        _log("未找到标题框，可手动输入。")

    _human_ms(400, 800)
    body, topics = _extract_topics_from_content(content)
    ed = page.locator('[contenteditable="true"]')
    if ed.count() > 0:
        ed.first.click()
        _human_ms(200, 400)
        page.keyboard.type(body, delay=3)
    else:
        _log("未找到正文框，可手动输入。")

    if topics:
        _input_topics(page, topics)
    if private:
        _set_private(page)
    if preview or pwc.manual_click_from_env():
        _log("已填写表单（未点击发布，preview / 半自动 模式）。")
        return 0
    pub = page.get_by_role("button", name=re.compile("发布"))
    if pub.count() == 0:
        pub = page.locator('button:has-text("发布")')
    if pub.count() == 0:
        _err("未找到「发布」按钮。")
        return 4
    try:
        pub.first.evaluate("el => el.scrollIntoView()")
        _human_ms(300, 600)
        pub.first.click(timeout=10000)
    except Exception as e:
        _err(f"点击发布失败：{e}")
        return 4
    _human_ms(2000, 4000)
    ok = page.get_by_text("发布成功", exact=False)
    try:
        if ok.count() > 0 and ok.first.is_visible():
            _log("发布成功。")
            return 0
    except Exception:
        pass
    if "publish" not in page.url.lower():
        _log("页面已跳转，视为发布可能成功。")
        return 0
    _log("已点击发布，但未能确认成功弹窗。请到小红书检查草稿/笔记，或重试。")
    return 0


def _parse_tags_csv(s: str) -> list[str]:
    return [t.strip() for t in s.split(",") if t.strip()]


def _resolve_xhs_video_captions() -> tuple[str, str, list[str] | None, int]:
    """
    返回 (title, content_body, extra_topic_list_or_none, error_code).
    error_code 非 0 表示失败，title 可忽略。
    """
    pub_path = (os.environ.get("MDT_PUBLISH_XHS") or "").strip()
    et = (os.environ.get("MDT_XHS_VIDEO_TITLE") or "").strip()
    ed = (os.environ.get("MDT_XHS_VIDEO_DESC") or "").strip()
    tag_csv = (os.environ.get("MDT_XHS_VIDEO_TAGS") or "").strip()
    extra = _parse_tags_csv(tag_csv)
    if et and ed:
        return _trim_title_for_xhs(et), ed, extra, 0
    if pub_path and os.path.isfile(pub_path):
        try:
            pub_text = Path(pub_path).read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            _err(f"无法读取 MDT_PUBLISH_XHS: {e}")
            return "", "", None, 1
        title, desc = _parse_playwright_title_desc(pub_text)
        body, topics = _extract_topics_from_content(desc)
        return title, body, (topics or []) + extra, 0
    if et or ed:
        t = _trim_title_for_xhs(et or "笔记")
        b = ed or et or t
        return t, b, extra, 0
    _err("视频模式需 MDT_XHS_VIDEO_TITLE+MDT_XHS_VIDEO_DESC，或 MDT_PUBLISH_XHS。")
    return "", "", None, 1


def _publish_flow_video(
    page: Any,
    title: str,
    content: str,
    video_path: str,
    preview: bool,
    private: bool,
    extra_topics: list[str],
) -> int:
    page.goto(_xhs_publish_entry_url(video=True), wait_until="domcontentloaded", timeout=45000)
    _human_ms(1000, 2000)
    if "login" in page.url.lower():
        _err("需要登录创作服务平台。请登录后再试。")
        return 2

    vtab = page.get_by_text("上传视频", exact=False)
    if vtab.count() == 0:
        vtab = page.locator('.creator-tab:has-text("上传视频")')
    if vtab.count() > 0:
        try:
            vtab.first.evaluate("el => el.click()")
            _log("已切换到「上传视频」。")
        except Exception:
            pass
    _human_ms(500, 1000)

    fin = page.locator('input[type="file"]')
    try:
        fin.first.wait_for(state="attached", timeout=30000)
    except Exception:
        _err("发布页上未找到文件上传控件，可能页面已改版。")
        return 3
    fin.first.set_input_files(video_path)
    _log(f"  已上传视频: {os.path.basename(video_path)}")

    _xhs_wait_video_form_ready(page, _xhs_video_process_wait_sec())

    body_only, topics_line = _extract_topics_from_content(content)
    tags_merged: list[str] = []
    for t in list(extra_topics or []) + (topics_line or []):
        if t and t not in tags_merged:
            tags_merged.append(t)
    merged = _xhs_desc_merge_tags_like_douyin(
        body_only if topics_line else (content or "").strip(),
        tags_merged,
    )

    ti = page.locator(
        '[placeholder*="标题"], [placeholder*="写个标题"], [placeholder*="更多赞"]'
    )
    if ti.count() > 0:
        try:
            ti.first.wait_for(state="visible", timeout=20000)
            ti.first.click()
            _human_ms(200, 500)
            page.keyboard.press(f"{_mod_key()}+a")
            page.keyboard.type(title, delay=22)
        except Exception as e:
            _log(f"填标题时异常（可手补）：{e}")
    else:
        _log("未找到标题框，可手动输入。")

    _human_ms(400, 800)
    filled = False
    ph_body = page.get_by_placeholder(
        re.compile(r"输入正文|真诚|描述|正文", re.I)
    )
    try:
        if ph_body.count() > 0:
            ph_body.first.click(timeout=10000)
            _human_ms(200, 400)
            page.keyboard.press(f"{_mod_key()}+a")
            page.keyboard.press("Delete")
            page.keyboard.type(merged, delay=3, timeout=180000)
            filled = True
    except Exception as e:
        _log(f"  正文(placeholder): {e}")
    if not filled:
        ed = page.locator('[contenteditable="true"]')
        if ed.count() > 0:
            try:
                ed.first.click()
                _human_ms(200, 400)
                page.keyboard.type(merged, delay=3, timeout=180000)
            except Exception as e2:
                _log(f"  正文(contenteditable): {e2}")
        else:
            _log("未找到正文区，可手动输入。")

    _xhs_apply_video_extras(page, private=private)
    if private:
        _set_private(page)

    if preview or pwc.manual_click_from_env():
        _log("已填写表单（未点击发布，半自动/预览）。")
        return 0

    try:
        page.evaluate(
            "window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))"
        )
    except Exception:
        pass
    _human_ms(600, 1200)
    pub = _xhs_find_publish_button(page)
    try:
        pub.scroll_into_view_if_needed(timeout=12000)
    except Exception:
        pass
    _human_ms(300, 600)
    try:
        pub.click(timeout=15000)
    except Exception as e:
        _err(f"点击发布失败：{e}")
        return 4
    _human_ms(2000, 4000)
    _log("已操作发布；请在小红书确认（定时/审核以后台为准）。")
    return 0


def mdtp_playwright_from_env() -> int:
    vpath = (os.environ.get("MDT_XHS_VIDEO_PATH") or "").strip()
    is_video = bool(vpath) and os.path.isfile(vpath)

    img_dir = (os.environ.get("MDT_XHS_IMAGES_DIR") or "").strip()
    pub_path = (os.environ.get("MDT_PUBLISH_XHS") or "").strip()
    dry = os.environ.get("MDT_DRY_RUN", "").strip() == "1"
    is_private = os.environ.get("MDT_XHS_AS_PRIVATE", "1").strip() != "0"

    if is_video:
        t_r = _resolve_xhs_video_captions()
        title, desc, ex_topics, ecode = t_r[0], t_r[1], t_r[2], t_r[3]
        if ecode != 0:
            return 1
        ex_list = ex_topics or []
    else:
        if not img_dir or not os.path.isdir(img_dir):
            _err("缺少或无效 MDT_XHS_IMAGES_DIR")
            return 1
        if not pub_path or not os.path.isfile(pub_path):
            _err("缺少 MDT_PUBLISH_XHS 或文件不存在。")
            return 1
        try:
            pub_text = Path(pub_path).read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            _err(f"无法读取 MDT_PUBLISH_XHS: {e}")
            return 1
        title, desc = _parse_playwright_title_desc(pub_text)
        images = mdtp.list_mdtp_image_paths(img_dir)
        if not images:
            _err("目录中无 cover.png 或 card_*.png")
            return 1
        images = mdtp.validate_images(images)
        ex_list = []

    if dry:
        _log("🔍 MDT dry-run（Playwright 模式），不打开浏览器、不实际发布。")
        _log(f"  标题: {title}")
        _log(f"  描述(截断): {desc[:200]}…" if len(desc) > 200 else f"  描述: {desc}")
        if is_video:
            _log(f"  模式: 视频  {vpath}")
            _log(f"  额外汇总话题: {ex_list!r}")
        else:
            _log(f"  图片: {len(images)} 张")
        _log(f"  仅自己可见: {is_private}")
        return 0

    try:
        import importlib  # noqa: F401

        importlib.import_module("playwright")
    except ImportError:
        _err("未安装 Playwright。请在 venv 中执行: pip install playwright && python -m playwright install chromium")
        return 1

    def _play() -> int:
        pw: Any = None
        br: Any = None
        ctx: Any = None
        page: Any = None
        rc = 1
        try:
            res = _get_page()
            pw, br, ctx, page, _profile = res[0], res[1], res[2], res[3], res[4]

            li = _xhs_wait_until_logged_in(page)
            if li != 0:
                rc = li
            elif is_video:
                rc = _publish_flow_video(
                    page, title, desc, vpath, False, is_private, ex_list
                )
            else:
                rc = _publish_flow(
                    page, title, desc, images, preview=False, private=is_private
                )  # type: ignore[name-defined]
        except Exception as e:
            pwc.excepthook_screenshot(page, "xhs", e)
            rc = 1
        finally:
            keep = pwc.keep_open_on_fail_from_env() and rc != 0
            if keep:
                _log(
                    "已按 MDT_PLAYWRIGHT_KEEP_OPEN 等保留连接，便于在浏览器中手动处理。结束后可结束相关 Chrome/助手进程。"
                )
            pwc.close_playwright_session(pw, br, ctx, keep_open=keep, rc=rc)
        return rc

    return pwc.run_in_playwright_isolated_thread(_play)


if __name__ == "__main__":
    sys.exit(mdtp_playwright_from_env())
