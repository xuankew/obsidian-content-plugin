#!/usr/bin/env python3
"""
使用 Playwright 在微信视频号「发表」页上传并发布（本机已登录的 Chrome profile）。

需在该 profile 下已用微信登录 https://channels.weixin.qq.com/ 。

发表页 URL 与 https://github.com/dreammis/social-auto-upload 中
`TENCENT_UPLOAD_URL`（`.../platform/post/create`）一致。

环境变量:
  MDT_CHANNELS_VIDEO    本机 MP4（必填）
  MDT_CHANNELS_TITLE    短标题/描述
  MDT_CHANNELS_BODY     更长的介绍（可与标题合并为一段）
  MDT_CHANNELS_TAGS     话题，逗号分隔；与抖音一致：若正文中尚无 # 则自动追加到「视频描述」
  MDT_DRY_RUN=1
  MDT_CHANNELS_PLAYWRIGHT_PROFILE  同抖音；可回退 MDT_VIDEO_PLAYWRIGHT_PROFILE
  MDT_CHANNELS_LOGIN_WAIT_SEC  打开发表页后若在登录页，最长等待多少秒供扫码（默认 600，即 10 分钟）
  MDT_CHANNELS_SCHEDULE  设为 0 则「不定时」立即发；默认 1 = 定时到当天/次日 8:30（见下）
  MDT_CHANNELS_SCHEDULE_HOUR    默认 8
  MDT_CHANNELS_SCHEDULE_MINUTE  默认 30
  MDT_CHANNELS_PROCESS_WAIT_SEC  选片后等转码、直至「发表」可点的最长秒数（默认 600）

填写与 social-auto-upload `tencent_uploader` 一致思路：视频描述用富文本区、短标题单独填、等转码完成后再点
form 内「发表」。声明原创会尽量勾选；若出现「原创权益」弹窗（须勾《原创声明须知》再点弹窗内「声明原创」），脚本会尽量自动处理（非必出）。

与公众号「分片上传」不同：此处为**网页**发表流程，与浏览器登录态一致。

失败截图: .obsidian/mdtp/playwright_channels_last_error.png
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

_DEFAULT_CH_URL = "https://channels.weixin.qq.com/platform/post/create"


def _channels_start_url() -> str:
    return (os.environ.get("MDT_CHANNELS_URL") or "").strip() or _DEFAULT_CH_URL


def _profile_name() -> str:
    for k in ("MDT_CHANNELS_PLAYWRIGHT_PROFILE", "MDT_VIDEO_PLAYWRIGHT_PROFILE"):
        s = (os.environ.get(k) or "").strip()
        if s:
            return s
    return "default"


def _tags_csv() -> list[str]:
    raw = (os.environ.get("MDT_CHANNELS_TAGS") or "").strip()
    if not raw:
        return []
    return [t.strip() for t in re.split(r"[,，;；]", raw) if t.strip()]


def _mod_key() -> str:
    import platform

    return "Meta" if platform.system() == "Darwin" else "Control"


def _format_str_for_short_title(origin: str) -> str:
    """与 social-auto-upload 一致：6–16 字建议，过滤非法字符。"""
    allowed = "《》“”:+?%°"
    out: list[str] = []
    for char in origin or "":
        if char.isalnum() or char in allowed:
            out.append(char)
        elif char == ",":
            out.append(" ")
    s = "".join(out).strip()
    if len(s) > 16:
        s = s[:16]
    elif len(s) < 6:
        s = s + " " * (6 - len(s))
    return s


def _body_with_tags_like_douyin(body: str, tags: list[str]) -> str:
    """与抖音：正文 + #话题（正文中已有 # 时不再重复追加 env 话题）。"""
    body = (body or "").strip()
    if not tags or re.search(r"#\S", body):
        return body
    return body.rstrip() + "\n" + " ".join(f"#{t}" for t in tags)


def _env_schedule_enabled() -> bool:
    raw = (os.environ.get("MDT_CHANNELS_SCHEDULE") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off", "immediate", "即时")


def _schedule_hour_minute() -> tuple[int, int]:
    try:
        h = int((os.environ.get("MDT_CHANNELS_SCHEDULE_HOUR") or "8").strip() or 8)
    except ValueError:
        h = 8
    try:
        m = int((os.environ.get("MDT_CHANNELS_SCHEDULE_MINUTE") or "30").strip() or 30)
    except ValueError:
        m = 30
    h = max(0, min(23, h))
    m = max(0, min(59, m))
    return h, m


def _next_local_datetime_for_today_or_tomorrow(hour: int, minute: int) -> datetime:
    now = datetime.now()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target


def _channels_description_textarea(root: Any) -> Any | None:
    """
    视频号页面上常有多个 textarea（如商品链接），只取「视频描述」相关且可见的。
    """
    for sel in (
        'textarea[placeholder*="添加描述"]',
        'textarea[placeholder*="视频描述"]',
        'textarea[placeholder*="介绍"]',
    ):
        try:
            locs = root.locator(sel)
            if locs.count() == 0:
                continue
            locs.first.wait_for(state="visible", timeout=5000)
            return locs.first
        except Exception:
            continue
    try:
        block = root.locator("div").filter(has_text=re.compile("视频描述")).first
        if block.count() > 0:
            ta = block.locator("textarea").first
            if ta.count() > 0:
                return ta
            ed = block.locator('[contenteditable="true"]').first
            if ed.count() > 0:
                return ed
    except Exception:
        pass
    try:
        n = root.locator("textarea").count()
        for i in range(min(n, 30)):
            t = root.locator("textarea").nth(i)
            try:
                if not t.is_visible():
                    continue
                ph = (t.get_attribute("placeholder") or "").strip()
                if "商品" in ph or "批量" in ph:
                    continue
                if "链接" in ph and "描述" not in ph and "添加" not in ph:
                    continue
                return t
            except Exception:
                continue
    except Exception:
        pass
    return None


def _fill_channels_description(root: Any, page: Any, text: str) -> bool:
    """视频描述：与抖音一致为「正文 + #话题」；优先富文本 div.input-editor / placeholder「添加描述」。"""
    if not (text or "").strip():
        return True
    # Playwright Python：keyboard.type() 仅支持 delay，无 timeout 参数
    try:
        ph = root.get_by_placeholder(re.compile(r"添加描述", re.I))
        if ph.count() > 0:
            ph.first.wait_for(state="visible", timeout=20000)
            ph.first.click(timeout=8000)
            pwc.human_ms(200, 500)
            mk = _mod_key()
            page.keyboard.press(f"{mk}+KeyA")
            page.keyboard.press("Backspace")
            page.keyboard.type(text, delay=4)
            pwc.log("  已填写「视频描述」（placeholder 添加描述）。")
            return True
    except Exception as e:
        pwc.log(f"  placeholder 添加描述: {e}")
    try:
        ed = root.locator("div.input-editor").first
        ed.wait_for(state="visible", timeout=25000)
        ed.click(timeout=8000)
        pwc.human_ms(200, 500)
        mk = _mod_key()
        page.keyboard.press(f"{mk}+KeyA")
        page.keyboard.press("Backspace")
        page.keyboard.type(text, delay=4)
        pwc.log("  已填写「视频描述」（input-editor）。")
        return True
    except Exception as e:
        pwc.log(f"  input-editor 填写失败，尝试 textarea: {e}")
    try:
        ta = _channels_description_textarea(root)
        if ta is not None:
            ta.fill(text, timeout=120000)
            pwc.log("  已填写「视频描述」（textarea）。")
            return True
    except Exception as e2:
        pwc.log(f"  textarea fill: {e2}")
    try:
        ta2 = _channels_description_textarea(root)
        if ta2 is not None:
            ta2.click(timeout=5000)
            pwc.human_ms(200, 400)
            mk = _mod_key()
            page.keyboard.press(f"{mk}+KeyA")
            page.keyboard.press("Backspace")
            page.keyboard.type(text, delay=4)
            pwc.log("  已填写「视频描述」（textarea 键盘输入）。")
            return True
    except Exception as e3:
        pwc.err(f"视频描述无法自动填写: {e3}")
    return False


def _fill_channels_short_title(root: Any, title: str) -> bool:
    """短标题：与抖音标题同文案；平台建议 6–16 字（_format_str_for_short_title 已处理）。"""
    short = _format_str_for_short_title(title.strip() or "视频")
    try:
        alt = root.locator(
            'input[placeholder*="概括视频"], input[placeholder*="6-16"], '
            'input[placeholder*="字符"], input[placeholder*="短标题"]'
        )
        if alt.count() > 0:
            alt.first.wait_for(state="visible", timeout=15000)
            alt.first.fill(short, timeout=10000)
            pwc.log(f"  已填写「短标题」（placeholder）: {short!r}")
            return True
    except Exception as e:
        pwc.log(f"  短标题（placeholder）: {e}")
    try:
        box = root.locator("div").filter(has_text=re.compile("短标题")).locator(
            'input[type="text"]'
        )
        if box.count() > 0:
            box.first.fill(short, timeout=10000)
            pwc.log(f"  已填写「短标题」: {short!r}")
            return True
    except Exception as e2:
        pwc.log(f"  短标题（结构1）: {e2}")
    try:
        box2 = (
            root.get_by_text("短标题", exact=True)
            .locator("..")
            .locator("xpath=following-sibling::div")
            .locator('input[type="text"]')
        )
        if box2.count() > 0:
            box2.first.fill(short, timeout=10000)
            pwc.log(f"  已填写「短标题」（结构2）: {short!r}")
            return True
    except Exception as e3:
        pwc.err(f"短标题无法填写: {e3}")
    return False


def _channels_scroll_schedule_into_view(root: Any) -> None:
    """发表时间/定时常在页面下半区，先滚到可见再点。"""
    for hint in ("发表时间", "请选择发表时间", "定时", "文章定时"):
        try:
            t = root.get_by_text(hint, exact=False).first
            t.scroll_into_view_if_needed(timeout=10000)
            pwc.human_ms(200, 500)
            return
        except Exception:
            continue
    try:
        root.evaluate("window.scrollTo(0, Math.min(document.body.scrollHeight, 4800))")
    except Exception:
        pass
    pwc.human_ms(400, 800)


def _channels_click_timed_option(root: Any) -> bool:
    """
    选「定时」非「不定时」。注意：「不定时」也含子串「定时」，
    与 social-auto-upload 一致：优先在含「发表时间」的行里点**第二个** radio（一般为定时）。
    """
    _channels_scroll_schedule_into_view(root)
    if _channels_click_timed_radios_in_time_row(root):
        pwc.human_ms(500, 1000)
        return True
    # 上游：label.filter(has_text="定时").nth(1)（第一项常为「不定时」里的「定向」子匹配风险已排除）
    try:
        labs = root.locator("label").filter(has_text=re.compile("定时"))
        n = labs.count()
        if n >= 2:
            labs.nth(1).click(timeout=8000, force=True)
            pwc.human_ms(500, 1000)
            return True
    except Exception as e:
        pwc.log(f"  label.nth(1) 定时: {e}")
    try:
        rdo = root.get_by_role("radio", name=re.compile(r"^定时$"))
        if rdo.count() > 0:
            rdo.last.click(timeout=8000, force=True)
            pwc.human_ms(500, 1000)
            return True
    except Exception as e2:
        pwc.log(f"  radio: {e2}")
    try:
        root.get_by_text("定时", exact=True).last.click(timeout=5000, force=True)
        pwc.human_ms(400, 800)
        return True
    except Exception:
        pass
    return False


def _channels_click_timed_radios_in_time_row(root: Any) -> bool:
    """在含「发表时间」或「定时发表」区块内点第 2 个 radio，避免用「定时」子串误匹配到「不定时」的 label 文本层。"""
    for rowpat in (
        re.compile(r"发表时间"),
        re.compile(r"定时发表"),
        re.compile(r"视频.*定时|定时发布"),
    ):
        row = root.locator("div,section,tr,li,fieldset").filter(has_text=rowpat)
        if row.count() == 0:
            continue
        r0 = row.first
        try:
            r0.scroll_into_view_if_needed(timeout=10000)
        except Exception:
            pass
        rad = r0.locator('input[type="radio"]')
        n = rad.count()
        if n >= 2:
            rad.nth(1).click(timeout=8000, force=True)
            return True
    return False


def _channels_set_schedule_datetime_on_root(root: Any, page: Any, when: datetime) -> bool:
    """在单个 Page/Frame 内完成选定时 + 选日期 + 选时间。keyboard 用 page。"""
    mk = _mod_key()
    if not _channels_click_timed_option(root):
        return False
    pwc.human_ms(800, 1500)
    # social-auto-upload：input[placeholder="请选择发表时间"]
    try:
        dt_in = None
        for sel in (
            'input[placeholder="请选择发表时间"]',
            'input[placeholder*="发表时间"]',
            'input[placeholder*="日期"]',
        ):
            loc = root.locator(sel)
            if loc.count() > 0:
                dt_in = loc.first
                break
        if dt_in is not None:
            dt_in.wait_for(state="visible", timeout=20000)
            dt_in.click(timeout=5000)
            pwc.human_ms(400, 800)
            cur_m = when.strftime("%m月")
            try:
                pm = page.locator(
                    'span.weui-desktop-picker__panel__label:has-text("月")'
                ).first
                if pm.count() > 0 and cur_m not in (pm.inner_text() or ""):
                    page.locator("button.weui-desktop-btn__icon__right").first.click(
                        timeout=3000
                    )
                    pwc.human_ms(300, 600)
            except Exception:
                pass
            day_s = str(when.day)
            links = page.locator("table.weui-desktop-picker__table a")
            for i in range(min(links.count(), 40)):
                a = links.nth(i)
                try:
                    cls = a.get_attribute("class") or ""
                    if "weui-desktop-picker__disabled" in cls:
                        continue
                    if (a.inner_text() or "").strip() == day_s:
                        a.click(timeout=3000)
                        break
                except Exception:
                    continue
            pwc.human_ms(400, 800)
        else:
            pwc.log("  未找到「请选择发表时间」输入，跳过日历点日。")
    except Exception as e:
        pwc.log(f"  日期选择: {e}")
    try:
        tm = None
        for sel in (
            'input[placeholder="请选择时间"]',
            'input[placeholder*="时间"]',
        ):
            lo = root.locator(sel)
            if lo.count() > 0:
                tm = lo.first
                break
        if tm is not None:
            tm.wait_for(state="visible", timeout=15000)
            tm.click(timeout=5000)
            pwc.human_ms(200, 400)
            page.keyboard.press(f"{mk}+KeyA")
            page.keyboard.type(when.strftime("%H:%M"), delay=80)
            page.keyboard.press("Enter")
            pwc.human_ms(400, 800)
    except Exception as e:
        pwc.log(f"  时间输入: {e}")
    pwc.log(f"  已尝试定时: {when.strftime('%Y-%m-%d %H:%M')}")
    return True


def _channels_set_schedule_datetime(page: Any, when: datetime) -> bool:
    """
    在**主 document 与所有 frame** 中尝试定时段落（发布表单常在 iframe 内时，
    只在 page 上点会完全无效）。需先切到「定时」再点「请选择发表时间」选日期/时间。
    """
    for root in [page, *list(page.frames)]:
        try:
            if _channels_set_schedule_datetime_on_root(root, page, when):
                return True
        except Exception as e:
            pwc.log(f"  定时段: {e}")
    pwc.log(
        "  各 frame 均未完成定时；若需定时，请手选「定时」+ 日期时间，"
        "或确认 MDT_CHANNELS_SCHEDULE=1。",
    )
    return False


def _channels_check_declare_original(root: Any) -> None:
    """声明原创：多策略，与视频号实际文案「声明原创」一致。"""
    for fn in (
        lambda: root.get_by_label(re.compile("声明原创|作品将展示原创|视频为原创")).check(),
        lambda: root.get_by_text("声明原创", exact=False)
        .first.locator("xpath=ancestor::label[1]")
        .locator('input[type="checkbox"]')
        .set_checked(True, force=True),
        lambda: root.locator(
            'label:has-text("声明原创") input[type="checkbox"]'
        ).first.set_checked(True, force=True),
        lambda: root.locator(
            "div.declare-original-checkbox input.ant-checkbox-input"
        ).first.click(),
        lambda: root.locator(
            'span:has-text("声明原创")'
        )
        .first.locator("xpath=ancestor::label[1]")
        .locator('input[type="checkbox"]')
        .set_checked(True, force=True),
    ):
        try:
            fn()
            pwc.log("  已勾选「声明原创」。")
            pwc.human_ms(500, 1000)
            return
        except Exception:
            continue
    try:
        cbl = root.locator('[class*="original"] input[type="checkbox"]')
        if cbl.count() > 0 and cbl.first.is_visible():
            cbl.first.click(force=True, timeout=3000)
            pwc.log("  已点击声明原创复选框。")
    except Exception:
        pwc.log("  未自动勾选声明原创（可手动勾选后重试）。")


def _channels_handle_original_rights_modal(page: Any) -> None:
    """
    主流程勾选「声明原创」后，可能弹出「原创权益」模态：须勾「我已阅读并同意…」
    再点弹窗内高亮「声明原创」（与取消并列）；非每次必出，短等无则跳过。
    """
    pwc.human_ms(800, 1600)
    box = page.locator('[role="dialog"]').filter(has_text="原创权益")
    if box.count() == 0:
        try:
            box = page.locator("div").filter(
                has_text=re.compile("原创权益")
            ).filter(
                has=page.get_by_text("原创声明须知", exact=False)
            )
        except Exception:
            pass
    if box.count() == 0:
        return
    try:
        m = box.first
        m.wait_for(state="visible", timeout=5000)
    except Exception:
        return
    pwc.log("  检测到「原创权益」弹窗，勾选协议并确认…")
    try:
        ag = m.get_by_text(re.compile(r"我已阅读并同意|原创声明须知"))
        if ag.count() > 0:
            ag.first.click(timeout=5000, force=True)
        else:
            cbl = m.locator('input[type="checkbox"]')
            if cbl.count() > 0:
                cbl.first.click(force=True, timeout=5000)
        pwc.human_ms(500, 1000)
    except Exception as e:
        pwc.log(f"  弹窗内勾选协议: {e}")
    for pat in (re.compile(r"^声明原创$"), re.compile(r"^确定$")):
        try:
            btn = m.get_by_role("button", name=pat)
            if btn.count() > 0:
                btn.last.click(timeout=10000)
                pwc.log("  已点击弹窗内「声明原创」/确定。")
                pwc.human_ms(800, 1400)
                return
        except Exception:
            continue
    for scope in [page, *list(page.frames)]:
        try:
            dl = scope.locator('[role="dialog"]').filter(has_text="原创权益")
            if dl.count() == 0:
                continue
            b = dl.get_by_role("button", name=re.compile(r"声明原创|确定"))
            if b.count() > 0:
                b.last.click(timeout=8000)
                pwc.log("  已点击弹窗确认（子 frame 回退）。")
                pwc.human_ms(800, 1200)
                return
        except Exception:
            continue
    pwc.log("  未自动点弹窗确认，请在窗口内手点。")


def _channels_find_publish_button(page: Any) -> Any | None:
    """底部「发表」可能在主文档或子 frame 内；保存草稿/手机预览 左侧的发表按钮。"""
    for scope in [page, *list(page.frames)]:
        try:
            b = scope.locator("div.form-btns").locator('button:has-text("发表")')
            if b.count() > 0:
                return b.last
            b2 = scope.get_by_role("button", name=re.compile("^发表$"))
            if b2.count() > 0:
                return b2.last
            b3 = scope.locator('button:has-text("发表")')
            if b3.count() > 0:
                return b3.last
        except Exception:
            continue
    return None


def _wait_channels_upload_done(page: Any, max_sec: float) -> bool:
    """等「发表」可点（去掉 weui_disabled）。与上游 wait_for_upload_complete 一致。"""
    deadline = time.monotonic() + max_sec
    last_log = 0.0
    while time.monotonic() < deadline:
        try:
            btn = _channels_find_publish_button(page)
            if btn is not None:
                cls = btn.get_attribute("class") or ""
                if "weui-desktop-btn_disabled" in cls:
                    pass
                else:
                    try:
                        if btn.is_disabled():
                            pass
                        else:
                            pwc.log("  视频已处理完，「发表」可点击。")
                            return True
                    except Exception:
                        pwc.log("  视频已处理完，「发表」可点击。")
                        return True
        except Exception:
            pass
        now = time.monotonic()
        if now - last_log > 15:
            pwc.log("  等待视频上传/转码完成，直至「发表」亮起…")
            last_log = now
        pwc.human_ms(1500, 2500)
    pwc.err("等待「发表」可用超时；可能仍在上传或页面异常。")
    return False


def _channels_submit_and_wait(page: Any) -> bool:
    """点击 form 内「发表」并尽量等待结果页；定时发表也可能留在编辑或提示成功。"""
    try:
        btn = _channels_find_publish_button(page)
        if btn is None:
            pwc.err("未找到「发表」按钮。")
            return False
        btn.scroll_into_view_if_needed(timeout=8000)
        pwc.human_ms(400, 900)
        btn.click(timeout=25000)
    except Exception as e:
        pwc.err(f"点击「发表」失败: {e}")
        return False
    pwc.human_ms(2000, 5000)
    try:
        page.wait_for_url(
            re.compile(r".*post/(list|index|create).*"), timeout=120000
        )
        pwc.log("  页面已跳转，发布/定时应已提交。")
        return True
    except Exception:
        u = page.url
        if "post/list" in u or "platform/post" in u or "create" in u:
            pwc.log("  请至视频号确认定时/发表状态。")
            return True
        pwc.log("  未确认到跳转；若出现成功提示或仍在编辑，请到视频号后台核对。")
        return True


def _channels_url_looks_like_login(u: str) -> bool:
    u = (u or "").lower()
    if not u:
        return False
    return any(
        x in u
        for x in (
            "/login",
            "passport",
            "ssologin",
            "qrconnect",
            "open.weixin",
            "work.weixin.qq.com",
        )
    )


def _safe_locator_count(root: Any, selector: str) -> int:
    """登录/跳转时 iframe 会卸載，在已 detach 的 frame 上 count 会抛错，须吞掉后重试下一轮。"""
    try:
        return root.locator(selector).count()
    except Exception:
        return 0


def _channels_resolve_root(page: Any, timeout_sec: float = 55.0) -> Any:
    """发表表单可能在子 frame；定位含「视频描述 / 添加描述」的 frame。"""
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        for root in list(page.frames):
            try:
                if _safe_locator_count(root, "div.input-editor") > 0:
                    return root
                if _safe_locator_count(root, '[placeholder*="添加描述"]') > 0:
                    return root
            except Exception:
                continue
        pwc.human_ms(800, 1400)
    return page


def _process_wait_sec() -> float:
    try:
        v = float((os.environ.get("MDT_CHANNELS_PROCESS_WAIT_SEC") or "600").strip() or 600.0)
    except ValueError:
        v = 600.0
    return max(60.0, min(3600.0, v))


def _any_channels_file_input(page: Any) -> bool:
    for fr in list(page.frames):
        if _safe_locator_count(fr, "input[type=file]") > 0:
            return True
    return False


def _wait_for_channels_session_ready(page: Any) -> int:
    """
    若当前为登录/授权页，不立即退出，而是提示并等待用户扫码，直至离开登录或出现上传控件或超时。
    返回 0 可继续，2 表示超时仍像未登录，3 可继续但异常（不应出现）。
    """
    sec = 600.0
    try:
        sec = float((os.environ.get("MDT_CHANNELS_LOGIN_WAIT_SEC") or "600").strip() or 600.0)
    except ValueError:
        sec = 600.0
    sec = max(60.0, min(3600.0, sec))
    deadline = time.monotonic() + sec
    if not _channels_url_looks_like_login(page.url) and _any_channels_file_input(page):
        return 0
    if _channels_url_looks_like_login(page.url):
        pwc.log(
            f"  当前为登录/授权页，请在窗口内扫码（本脚本会等待最久约 {int(sec)} 秒，勿关闭浏览器）…",
        )
    else:
        pwc.log(
            f"  等待上传区域出现（最久约 {int(sec)} 秒）…",
        )
    n_log = 0
    while time.monotonic() < deadline:
        u = page.url
        if not _channels_url_looks_like_login(u) and (
            "platform" in u.lower() or "channels" in u.lower()
        ):
            pwc.human_ms(1500, 2500)
            if _any_channels_file_input(page):
                pwc.log("  已检测到登录后页面。")
                return 0
        if _any_channels_file_input(page):
            pwc.log("  已出现上传区域。")
            return 0
        n_log += 1
        if n_log % 5 == 1:
            pwc.log("  仍在等待登录或页面加载，可继续扫码…")
        pwc.human_ms(2000, 3000)
    pwc.err(
        f"在 {int(sec)} 秒内未进入可上传页面（可能仍在登录或网络慢）。"
        f"可增大 MDT_CHANNELS_LOGIN_WAIT_SEC 或在浏览器中先登录后再运行。",
    )
    return 2


def _try_file_in_frame(root: Any, vpath: str) -> bool:
    try:
        loc = root.locator("input[type=file]")
        if loc.count() == 0:
            return False
    except Exception:
        return False
    try:
        loc.first.wait_for(state="attached", timeout=15000)
        loc.first.set_input_files(vpath, timeout=20000)
        return True
    except Exception:
        return False


def _channels_attach_video(page: Any, vpath: str) -> bool:
    for fr in list(page.frames):
        if _try_file_in_frame(fr, vpath):
            return True
    for label in ("从相册", "发表", "上传", "选择视频", "从电脑"):
        try:
            t = page.get_by_text(re.compile(label), exact=False)
            if t.count() == 0:
                continue
            t.first.click(timeout=5000, force=True)
            pwc.human_ms(1000, 2000)
            for fr in list(page.frames):
                if _try_file_in_frame(fr, vpath):
                    return True
        except Exception:
            continue
    return False


def _publish(page: Any) -> int:
    vpath = (os.environ.get("MDT_CHANNELS_VIDEO") or "").strip()
    title = (os.environ.get("MDT_CHANNELS_TITLE") or "").strip()
    body = (os.environ.get("MDT_CHANNELS_BODY") or "").strip()
    if not vpath or not os.path.isfile(vpath):
        pwc.err("MDT_CHANNELS_VIDEO 无效或不是文件。")
        return 1
    if not title:
        title = os.path.splitext(os.path.basename(vpath))[0]
    tags = _tags_csv()
    # 视频描述 = 抖音同款：正文 + #；短标题 = 抖音标题（见 MDT_CHANNELS_TITLE）
    desc_text = _body_with_tags_like_douyin(body, tags)
    if not (desc_text or "").strip():
        desc_text = _body_with_tags_like_douyin(title, tags)

    ch_url = _channels_start_url()
    pwc.log(f"  打开发表页: {ch_url}")
    try:
        page.set_viewport_size({"width": 1440, "height": 900})
    except Exception:
        pass
    page.goto(ch_url, wait_until="load", timeout=90000)
    try:
        page.wait_for_load_state("networkidle", timeout=25000)
    except Exception:
        pass
    pwc.human_ms(2000, 4000)
    w = _wait_for_channels_session_ready(page)
    if w == 2:
        return 2
    if not _channels_attach_video(page, vpath):
        pwc.err("未找到视频文件上传控件（已尝试各 iframe）。请确认已登录、或开半自动手动点「上传/从相册」。")
        return 3
    pwc.log(f"  已选择: {os.path.basename(vpath)}")

    root = _channels_resolve_root(page)
    try:
        page.evaluate("window.scrollTo(0, 0)")
    except Exception:
        pass
    pwc.human_ms(1500, 2500)

    if not _fill_channels_description(root, page, desc_text):
        return 4
    if not _fill_channels_short_title(root, title) and not _fill_channels_short_title(page, title):
        pwc.log("  短标题未自动填写，请在窗口内补全短标题后再发。")

    if _env_schedule_enabled():
        when = _next_local_datetime_for_today_or_tomorrow(*_schedule_hour_minute())
        pwc.log(
            f"  定时发表: {when.strftime('%Y-%m-%d %H:%M')}（可用 MDT_CHANNELS_SCHEDULE=0 改为立即发）",
        )
        try:
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        except Exception:
            pass
        pwc.human_ms(500, 1000)
        _channels_set_schedule_datetime(page, when)
    pwc.human_ms(600, 1200)

    _channels_check_declare_original(root)
    _channels_check_declare_original(page)
    _channels_handle_original_rights_modal(page)

    if pwc.manual_click_from_env():
        pwc.log("半自动：未点击发表。")
        return 0

    try:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    except Exception:
        pass
    pwc.human_ms(400, 900)

    proc_sec = _process_wait_sec()
    if not _wait_channels_upload_done(page, proc_sec):
        pwc.log("  「发表」仍灰或找不到，将尝试直接点（若失败请调大 MDT_CHANNELS_PROCESS_WAIT_SEC）。")

    if not _channels_submit_and_wait(page):
        return 3
    return 0


def main() -> int:
    if os.environ.get("MDT_DRY_RUN", "").strip() == "1":
        pwc.log("🔍 dry-run: 不启动浏览器。")
        pwc.log(f"  {os.environ.get('MDT_CHANNELS_VIDEO','')}")
        return 0
    try:
        import importlib  # noqa: F401

        importlib.import_module("playwright")
    except ImportError:
        pwc.err("需要 playwright；见 venv 一键安装。")
        return 1

    def _run() -> int:
        pw: Any = None
        br: Any = None
        ctx: Any = None
        page: Any = None
        rc = 1
        try:
            res = pwc.get_playwright_page("channels_playwright", _profile_name())
            pw, br, ctx, page, _ = res
            rc = _publish(page)
        except Exception as e:
            pwc.excepthook_screenshot(page, "channels", e)
            rc = 1
        finally:
            k = pwc.keep_open_on_fail_from_env() and rc != 0
            pwc.close_playwright_session(pw, br, ctx, keep_open=k, rc=rc)
        return rc

    return pwc.run_in_playwright_isolated_thread(_run)


if __name__ == "__main__":
    sys.exit(main())
