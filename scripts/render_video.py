#!/usr/bin/env python3
"""
MDTP 短视频：TTS（edge-tts 优先）+ 首/尾帧优先 HTML/CSS（Playwright 截图），失败则 Pillow + FFmpeg 拼竖屏 1080x1920。

环境变量:
  MDT_VIDEO_JOB_JSON   见下方
  MDT_VIDEO_TTS_CONFIG_JSON
  MDT_VIDEO_TTS_ENGINE  edge | listenhub
  MDT_VIDEO_FFMPEG_PATH 可选，为 ffmpeg 所在**目录**或完整路径
  MDT_DEBUG
  MDT_LISTENHUB_BASE_URL  可选，默认 https://api.marswave.ai/openapi（ListenHub TTS 根路径）

MDT_VIDEO_JOB_JSON 内可选 backgroundMusic: {"enabled": true, "path": "/…/x.mp3", "volume": 0.14}
  volume 为 BGM 线性音量（人声称 1.0），推荐 0.10～0.20。未传则脚本内不混 BGM（兼容旧版）。
  videoConfig 可选 episode / coverEpisode / issue（期数，封面右上「第 N 期」）、deskImagePath（封面书桌图，默认 resource/img/desk.png）。
  高品质首尾帧需 playwright：pip install playwright && python -m playwright install chromium。
  可选 MDT_VIDEO_HTML_FRAMES=0 强制仅用 Pillow。
"""

from __future__ import annotations

import asyncio
import html as html_module
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

_VENV_DIR = Path(__file__).resolve().parent


def _check_pillow() -> bool:
    try:
        import PIL  # noqa: F401
    except ImportError:
        _err(
            "未安装 Pillow（PIL）。卡片/PDF 帧需 Pillow：在库内 venv（如 .obsidian/mdtp/xhs_venv）执行\n"
            "  python -m pip install Pillow\n"
            "或：python -m pip install -r …/scripts/requirements-video.txt\n"
            "亦可在 Obsidian「一键安装/修复」中安装短视频依赖。",
        )
        return False
    return True


def _log(msg: str) -> None:
    print(msg, flush=True)


def _err(msg: str) -> None:
    print(f"❌ {msg}", flush=True, file=sys.stderr)


def _brew_or_common_bin(name: str) -> str | None:
    """Obsidian 等 GUI 常不带 Homebrew 的 PATH，补试常见绝对路径。"""
    exe = f"{name}.exe" if os.name == "nt" else name
    if sys.platform == "darwin":
        for d in ("/opt/homebrew/bin", "/usr/local/bin"):
            q = Path(d) / exe
            if q.is_file():
                return str(q)
    return None


def _which_ffmpeg() -> str:
    p = (os.environ.get("MDT_VIDEO_FFMPEG_PATH") or "").strip()
    if p:
        cand = Path(p)
        if cand.is_dir():
            for name in ("ffmpeg", "ffmpeg.exe"):
                q = cand / name
                if q.is_file():
                    return str(q)
        if cand.is_file():
            return str(cand)
    w = shutil.which("ffmpeg")
    if w:
        return w
    fb = _brew_or_common_bin("ffmpeg")
    if fb:
        return fb
    raise FileNotFoundError("未找到 ffmpeg，请安装并加入 PATH，或填写插件中 FFmpeg 路径，或本机 `brew install ffmpeg`")


def _sibling_ffprobe(ffmpeg_path: str) -> str | None:
    ff = Path(ffmpeg_path)
    name = "ffprobe.exe" if os.name == "nt" else "ffprobe"
    sib = ff.parent / name
    return str(sib) if sib.is_file() else None


def _which_ffprobe() -> str | None:
    """若未安装 ffprobe 可返回 None，由 _audio_duration_sec 用 ffmpeg 回退。"""
    p = (os.environ.get("MDT_VIDEO_FFMPEG_PATH") or "").strip()
    if p:
        cand = Path(p)
        if cand.is_dir():
            for name in ("ffprobe", "ffprobe.exe"):
                q = cand / name
                if q.is_file():
                    return str(q)
        if cand.is_file() and "ffmpeg" in cand.name:
            sib = _sibling_ffprobe(str(cand))
            if sib:
                return sib
    w = shutil.which("ffprobe")
    if w:
        return w
    ff = shutil.which("ffmpeg")
    if ff:
        sib = _sibling_ffprobe(ff)
        if sib:
            return sib
    # 与 _which_ffmpeg 一致的常见路径
    fb = _brew_or_common_bin("ffprobe")
    if fb:
        return fb
    if sys.platform == "darwin":
        for d in ("/opt/homebrew/bin", "/usr/local/bin"):
            ff2 = Path(d) / "ffmpeg"
            if ff2.is_file():
                sib = ff2.parent / "ffprobe"
                if sib.is_file():
                    return str(sib)
    return None


def _duration_via_ffmpeg_ffmpeg_info(audio: Path) -> float:
    """无 ffprobe 时：用 ffmpeg -i 输出里的 Duration: 行解析（GUI 常无 Homebrew PATH）。"""
    ff = _which_ffmpeg()
    r = subprocess.run(
        [ff, "-hide_banner", "-i", str(audio), "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    err = (r.stderr or "") + (r.stdout or "")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", err)
    if m:
        h, mn, s = m.group(1), m.group(2), m.group(3)
        return max(0.1, int(h) * 3600 + int(mn) * 60 + float(s))
    raise RuntimeError(
        "无法从 ffmpeg 输出解析音长。请安装 ffmpeg，或在插件中填写其所在目录/完整路径。",
    )


def _ffprobe_duration_audio(audio: Path) -> float:
    pr = _which_ffprobe()
    if pr:
        r = subprocess.run(
            [pr, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(audio)],
            capture_output=True,
            text=True,
        )
        if r.returncode == 0:
            try:
                v = float((r.stdout or "0").strip() or 0)
                if v > 0:
                    return max(0.1, v)
            except ValueError:
                pass
    return _duration_via_ffmpeg_ffmpeg_info(audio)


def _resolve_frame_font_from_job(job: dict[str, Any]) -> str | None:
    """
    与小红书 PNG 一致：优先插件 `fonts/` 下 LXGWWenKaiGB-*.ttf，否则该目录下首个 .ttf/.otf/.ttc。
    `render_video.py` 位于 `…/scripts/`，同级的 `../fonts` 为插件根字体目录（随 Obsidian 插件一起部署）。
    """
    raw = (str(job.get("fontDir") or job.get("fontsDir") or "")).strip()
    try_dirs: list[Path] = []
    if raw:
        try_dirs.append(Path(raw))
    try_dirs.append(_VENV_DIR.parent / "fonts")
    for d in try_dirs:
        d = d.resolve()
        if not d.is_dir():
            continue
        for name in (
            "LXGWWenKaiGB-Regular.ttf",
            "LXGWWenKaiGB-Medium.ttf",
        ):
            p = d / name
            if p.is_file():
                _log(f"首/尾帧字体：{p.name}（{d}）")
                return str(p)
        ttf = (
            sorted(d.glob("*.ttf"), key=lambda p: p.name)
            + sorted(d.glob("*.otf"), key=lambda p: p.name)
            + sorted(d.glob("*.ttc"), key=lambda p: p.name)
        )
        if ttf:
            _log(f"首/尾帧字体：{ttf[0].name}（{d}）")
            return str(ttf[0])
    return _find_cjk_font()


def _find_cjk_font() -> str | None:
    if sys.platform == "darwin":
        cands = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/Supplemental/Songti.ttc",
        ]
    elif os.name == "nt":
        cands = [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"]
    else:
        cands = [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        ]
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


def _wrap_text(s: str, max_chars: int) -> str:
    out: list[str] = []
    for line in s.splitlines():
        cur = []
        n = 0
        for ch in line:
            cur.append(ch)
            n += 1
            if n >= max_chars:
                out.append("".join(cur))
                cur, n = [], 0
        if cur:
            out.append("".join(cur))
    return "\n".join(out) if out else s


def _lerp_f(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _make_warm_gradient_bg(w: int, h: int):
    """米白暖灰垂直渐变 + 轻微四角暗角（家庭教育 IP 底图）。"""
    return _make_family_education_bg(w, h)


def _make_family_education_bg(w: int, h: int):
    from PIL import Image  # type: ignore

    # #F5F0E8 系：上浅米白 → 下暖灰奶杏
    c_top = (248, 244, 238)
    c_bottom = (237, 229, 218)
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        ty = y / max(1, h - 1)
        r = int(_lerp_f(c_top[0], c_bottom[0], ty))
        g = int(_lerp_f(c_top[1], c_bottom[1], ty))
        b = int(_lerp_f(c_top[2], c_bottom[2], ty))
        for x in range(w):
            px[x, y] = (r, g, b)
    # 轻微暗角（书桌氛围）
    mx = max(1, w // 2)
    my = max(1, h // 2)
    dim = 22
    for y in range(h):
        for x in range(w):
            dx = abs(x - mx) / mx
            dy = abs(y - my) / my
            v = int(min(1.0, (dx * dx + dy * dy) ** 0.5) * dim)
            rr, gg, bb = px[x, y]
            px[x, y] = (max(0, rr - v), max(0, gg - v), max(0, bb - v))
    return im


# 家庭教育品牌色（与计划一致）
_FE_TITLE = (61, 47, 37)  # #3D2F25 深棕
_FE_SUB = (105, 88, 74)
_FE_ACCENT = (245, 158, 11)  # #F59E0B 橙
_FE_GRAY = (140, 140, 140)  # #8C8C8C
_FE_CARD = (255, 253, 248)
_FE_CARD_BORDER = (235, 224, 212)
_FE_SHADOW = (218, 206, 194)
_FE_BAR_TOP = (255, 243, 232)  # 浅橙底栏（封面底栏）
_FE_HOOK_BRUSH_BG = (62, 48, 40)  # 深色笔触条上的引导语
_FE_WHITE = (255, 255, 255)
_FE_ORANGE_BADGE = (245, 158, 11)  # #F59E0B 期数角标
_FE_CREAM_BG = (245, 240, 232)  # #F5F0E8 与 desk 上方撕纸融合
_FE_END_BAR_TAN = (218, 190, 158)  # 结尾页底部赭石条

_DEFAULT_END_CTA = "关注我，每天一个家庭教育实战方法"
_BRAND_TAGLINE = "真实爸爸视角｜家庭教育实战方法"
_BRAND_MOTTO = "用心陪伴 · 共同成长"
_END_HEAD_LABEL = "· 记住这句话 ·"

# 封面深棕笔触条：`opening_text` 首行超过该长度则不显示（保证版式）
_OPEN_SUBTITLE_MAX_CHARS = 14


def _default_desk_image_path() -> Path:
    return _VENV_DIR.parent / "resource" / "img" / "desk.png"


def _draw_episode_badge(
    dr,
    w: int,
    pad_r: int,
    top_y: int,
    episode: int,
    font,
) -> None:
    """右上橙色圆角徽章「第 N 期」，白字。"""
    text = f"第 {episode} 期"
    bb = dr.textbbox((0, 0), text, font=font)
    bw = (bb[2] - bb[0]) + 44
    bh = (bb[3] - bb[1]) + 28
    rx = w - pad_r - bw
    ry = top_y
    try:
        dr.rounded_rectangle([rx, ry, rx + bw, ry + bh], radius=bh // 2, fill=_FE_ORANGE_BADGE)
    except Exception:
        dr.rectangle([rx, ry, rx + bw, ry + bh], fill=_FE_ORANGE_BADGE)
    tx = rx + (bw - (bb[2] - bb[0])) // 2
    ty = ry + (bh - (bb[3] - bb[1])) // 2 - 2
    dr.text((tx, ty), text, fill=_FE_WHITE, font=font)


def _draw_orange_brushstroke_underline(
    dr,
    canvas_w: int,
    x_center: int,
    half_width: int,
    y_bottom: int,
) -> None:
    """主标题末行下方手绘感橙色粗笔触。"""
    x0 = max(8, x_center - half_width - 16)
    x1 = min(canvas_w - 8, x_center + half_width + 16)
    y = y_bottom + 2
    seg_w = 26
    xi = x0
    toggle = False
    while xi < x1:
        xn = min(xi + seg_w, x1)
        yo = y + (5 if toggle else 0)
        try:
            dr.ellipse([xi, yo, xn, yo + 14], fill=_FE_ACCENT)
        except Exception:
            dr.rectangle([xi, yo, xn, yo + 14], fill=_FE_ACCENT)
        toggle = not toggle
        xi += seg_w - 6


def _draw_dark_brush_hook_strip(
    dr,
    w: int,
    cx: int,
    y_top: int,
    text: str,
    font,
    pad_x: int,
) -> int:
    """深棕横向笔触条 + 白字短引导（opening 首行截取）。"""
    t = (text or "").strip()
    if not t:
        return y_top
    if len(t) > 20:
        t = t[:19] + "…"
    bb = dr.textbbox((0, 0), t, font=font)
    tw = bb[2] - bb[0]
    bw = min(w - 2 * pad_x, tw + 56)
    bh = (bb[3] - bb[1]) + 36
    lx = int(cx - bw / 2)
    try:
        dr.rounded_rectangle([lx, y_top, lx + bw, y_top + bh], radius=14, fill=_FE_HOOK_BRUSH_BG)
    except Exception:
        dr.rectangle([lx, y_top, lx + bw, y_top + bh], fill=_FE_HOOK_BRUSH_BG)
    tx = lx + (bw - tw) // 2
    ty = y_top + (bh - (bb[3] - bb[1])) // 2 - 2
    dr.text((tx, ty), t, fill=_FE_WHITE, font=font)
    return y_top + bh + 8


def _paste_scaled_desk_with_torn_bottom(
    im,
    desk_path: Path,
    top_y: int,
    bottom_y: int,
    blend_rgb: tuple[int, int, int],
) -> None:
    """将 desk 照片铺满宽度贴入 [top_y, bottom_y)，底部撕纸状与底色融合。"""
    try:
        from PIL import Image, ImageDraw, ImageOps  # type: ignore
    except ImportError:
        return
    if not desk_path.is_file():
        return
    w, _hc = im.size
    h_dest = bottom_y - top_y
    if h_dest < 80:
        return
    try:
        dg = Image.open(desk_path).convert("RGBA")
        _ant = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
        dg_f = ImageOps.fit(dg, (w, h_dest), method=_ant)
    except OSError:
        return
    im.paste(dg_f, (0, top_y), dg_f)
    dr = ImageDraw.Draw(im)
    jag_top = bottom_y - 26
    upper: list[tuple[float, float]] = []
    step = 52.0
    xi = 0.0
    flip = False
    while xi <= float(w) + 1:
        upper.append((xi, float(jag_top + (-9 if flip else 5))))
        flip = not flip
        xi += step
    poly = [(0, bottom_y)] + upper + [(float(w), float(bottom_y))]
    dr.polygon([(int(p[0]), int(p[1])) for p in poly], fill=blend_rgb)


def _fill_torn_top_band(
    dr,
    w: int,
    y_boundary: int,
    y_bottom: int,
    fill_rgb: tuple[int, int, int],
) -> None:
    """锯齿顶边界下方整块填充（结尾页赭石底栏）；锯齿以上为奶油背景。"""
    upper: list[tuple[int, int]] = []
    flip = False
    for x in range(0, w + 1, 56):
        upper.append((x, y_boundary + (-8 if flip else 6)))
        flip = not flip
    poly = upper + [(w, y_bottom), (0, y_bottom)]
    dr.polygon(poly, fill=fill_rgb)


def _stroke_dashed_round_rect(
    dr,
    box: tuple[int, int, int, int],
    radius: int,
    outline: tuple[int, int, int],
    width: int = 2,
    dash: int = 10,
    gap: int = 6,
) -> None:
    """近似圆角虚线框（布朗描边）。"""
    l, t, r, b = box
    # 简化为矩形虚线四边（圆角用短直线近似）
    def dashed_h(y: int, x0: int, x1: int) -> None:
        x = x0
        while x < x1:
            xe = min(x + dash, x1)
            dr.line([(x, y), (xe, y)], fill=outline, width=width)
            x = xe + gap

    def dashed_v(x: int, y0: int, y1: int) -> None:
        y = y0
        while y < y1:
            ye = min(y + dash, y1)
            dr.line([(x, y), (x, ye)], fill=outline, width=width)
            y = ye + gap

    dashed_h(t, l + radius, r - radius)
    dashed_h(b, l + radius, r - radius)
    dashed_v(l, t + radius, b - radius)
    dashed_v(r, t + radius, b - radius)


def _accent_segments_line(line: str) -> list[tuple[str, bool]]:
    """把一行标题拆成 (片段, 是否橙色强调)。数字/百分比 + 若干冲突词。"""
    if not line:
        return []
    out: list[tuple[str, bool]] = []
    pos = 0
    pat = re.compile(
        r"\d+(?:\.\d+)?%?|[０-９]+(?:\.[０-９]+)?[%％]?|"
        r"别再|不是[^，。？！；\s]{0,4}|错了|误区|真相|别\s*吼|别\s*骂",
    )
    for m in pat.finditer(line):
        if m.start() > pos:
            out.append((line[pos : m.start()], False))
        out.append((m.group(), True))
        pos = m.end()
    if pos < len(line):
        out.append((line[pos:], False))
    return out if out else [(line, False)]


def _draw_text_segments_centered(
    dr,
    y: int,
    cx: int,
    segments: list[tuple[str, bool]],
    font,
    fill_main: tuple[int, int, int],
    fill_accent: tuple[int, int, int],
    shadow: tuple[int, int, int] | None = None,
) -> int:
    """绘制一行混色文字（居中），返回下一行基线增量。"""
    total_w = 0
    widths: list[int] = []
    for seg, acc in segments:
        bb = dr.textbbox((0, 0), seg, font=font)
        wseg = bb[2] - bb[0]
        widths.append(wseg)
        total_w += wseg
    x0 = int(cx - total_w / 2)
    x = x0
    max_bottom = y
    for (seg, acc), wseg in zip(segments, widths):
        fill = fill_accent if acc else fill_main
        if shadow and seg.strip():
            dr.text((x + 1, y + 1), seg, fill=shadow, font=font)
        dr.text((x, y), seg, fill=fill, font=font)
        bb = dr.textbbox((x, y), seg, font=font)
        max_bottom = max(max_bottom, bb[3])
        x += wseg
    bb0 = dr.textbbox((0, 0), "Ay", font=font)
    return max_bottom - bb0[1] + 8


def _draw_rounded_card_with_shadow(
    dr,
    box: tuple[int, int, int, int],
    radius: int,
    fill: tuple[int, int, int],
    outline: tuple[int, int, int],
    shadow: tuple[int, int, int],
) -> None:
    l, t, r, b = box
    try:
        dr.rounded_rectangle([l + 6, t + 10, r + 6, b + 10], radius=radius + 2, fill=shadow)
        dr.rounded_rectangle([l, t, r, b], radius=radius, fill=fill, outline=outline, width=2)
    except Exception:
        dr.rectangle([l, t, r, b], fill=fill, outline=outline, width=2)


def _draw_subtitle_sandwiched_rules(
    dr,
    y_top: int,
    card_l: int,
    card_r: int,
    cx: int,
    lines: list[str],
    font,
    fill: tuple[int, int, int],
    shadow: tuple[int, int, int],
    rule_color: tuple[int, int, int],
    rule_margin_x: int = 44,
    inner_gap: int = 14,
) -> int:
    """参考爆款封面：副标题夹在两条横线之间，与主标题形成强弱分层。"""
    xl = card_l + rule_margin_x
    xr = card_r - rule_margin_x
    try:
        dr.line([xl, y_top, xr, y_top], fill=rule_color, width=2)
    except Exception:
        dr.line([xl, y_top, xr, y_top], fill=rule_color)
    y = y_top + inner_gap + 6
    gap_ln = 12
    for ln in lines:
        bb = dr.textbbox((0, 0), ln, font=font)
        x = int(cx - (bb[2] - bb[0]) / 2)
        dr.text((x + 1, y + 1), ln, fill=shadow, font=font)
        dr.text((x, y), ln, fill=fill, font=font)
        y += (bb[3] - bb[1]) + gap_ln
    y -= gap_ln
    y_bottom = y + inner_gap + 6
    try:
        dr.line([xl, y_bottom, xr, y_bottom], fill=rule_color, width=2)
    except Exception:
        dr.line([xl, y_bottom, xr, y_bottom], fill=rule_color)
    return y_bottom + 8


def _draw_subtle_desk_decoration(dr, w: int, card_bottom: int, bar_top: int) -> None:
    """主卡片与底栏之间空隙：淡淡书桌/台灯几何示意（勿压住正文卡片）。"""
    if bar_top <= card_bottom + 8:
        return
    y0 = int(card_bottom + (bar_top - card_bottom) * 0.35)
    pale = (242, 236, 228)
    thin = (228, 218, 206)
    try:
        dr.rounded_rectangle([72, y0 + 28, w - 72, y0 + 36], radius=4, fill=thin)
        dr.rounded_rectangle([w // 2 - 120, y0 - 16, w // 2 + 120, y0 + 18], radius=8, fill=pale)
        dr.polygon(
            [(w // 2 + 130, y0), (w // 2 + 190, y0 + 52), (w // 2 + 148, y0 + 52)],
            fill=(250, 228, 200),
        )
        dr.rectangle([w // 2 + 142, y0 + 52, w // 2 + 152, y0 + 78], fill=thin)
    except Exception:
        pass


def _paste_round_logo(
    im,
    logo_path: Path,
    top_left_xy: tuple[int, int],
    size: int,
) -> None:
    if not logo_path.is_file():
        return
    try:
        from PIL import Image, ImageDraw, ImageOps  # type: ignore
    except ImportError:
        return
    try:
        lg = Image.open(logo_path).convert("RGBA")
        _ant = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
        lg = ImageOps.fit(lg, (size, size), method=_ant)
    except OSError:
        return
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    lg = lg.copy()
    lg.putalpha(m)
    im.paste(lg, top_left_xy, lg)


def _truetype_cjk(
    path: str | None, sizes: tuple[int, int, int, int, int, int] = (64, 44, 36, 32, 28, 24)
):
    from PIL import ImageFont  # type: ignore

    a, b, c, d, e, f_ = sizes
    try:
        if path:
            return (
                ImageFont.truetype(path, a),
                ImageFont.truetype(path, b),
                ImageFont.truetype(path, c),
                ImageFont.truetype(path, d),
                ImageFont.truetype(path, e),
                ImageFont.truetype(path, f_),
            )
    except OSError:
        pass
    d0 = ImageFont.load_default()
    return (d0, d0, d0, d0, d0, d0)


def _wrap_cjk(s: str, max_chars: int) -> str:
    s = (s or "").strip() or " "
    if max_chars < 2:
        return s
    return _wrap_text(s, max_chars)


def _video_frames_html_enabled() -> bool:
    return (os.environ.get("MDT_VIDEO_HTML_FRAMES") or "1").strip().lower() not in ("0", "false", "no")


def _opening_hook_line_short(sub_title: str) -> str:
    """封面笔触条文案：仅首行，且长度不超过 `_OPEN_SUBTITLE_MAX_CHARS`，否则不显示。"""
    line = sub_title.split("\n", 1)[0].strip() if (sub_title or "").strip() else ""
    if not line:
        return ""
    if len(line) > _OPEN_SUBTITLE_MAX_CHARS:
        return ""
    return line


def _svg_wavy_band_uri(fill_hex_nohash: str) -> str:
    """底部/顶部的波浪分隔 SVG，用作 data URI。"""
    import urllib.parse

    w, bh = 1080, 28
    pts: list[tuple[float, float]] = [(0.0, float(bh))]
    x = 0.0
    flip = False
    while x <= w + 1:
        pts.append((x, float(12 + (-9 if flip else 6))))
        flip = not flip
        x += 52.0
    pts.append((float(w), float(bh)))
    d_parts = [f"M {pts[0][0]:.0f} {pts[0][1]:.0f}"]
    for p in pts[1:]:
        d_parts.append(f"L {p[0]:.0f} {p[1]:.0f}")
    d_parts.append("Z")
    d = " ".join(d_parts)
    svg = (
        f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {w} {bh}' width='{w}' height='{bh}'>"
        f"<path d=\"{d}\" fill='#{fill_hex_nohash}'/>"
        "</svg>"
    )
    return "data:image/svg+xml;charset=utf-8," + urllib.parse.quote(svg)


def _render_html_to_png(html_document: str, out_png: Path, width: int = 1080, height: int = 1920) -> bool:
    """Playwright 将固定视口 HTML 截图为 PNG。"""
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        _log(
            "⚠️ 未安装 playwright，首尾帧将使用 Pillow。"
            "高品质 HTML 渲染请执行：pip install playwright && python -m playwright install chromium",
        )
        return False
    out_png.parent.mkdir(parents=True, exist_ok=True)
    tf: Path | None = None
    try:
        fd, tpath = tempfile.mkstemp(suffix=".html", prefix="mdtp_frame_", text=True)
        os.close(fd)
        tf = Path(tpath)
        tf.write_text(html_document, encoding="utf-8")
        uri = tf.resolve().as_uri()
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception:
                browser = p.chromium.launch(headless=True, channel="chrome")
            page = browser.new_page(viewport={"width": width, "height": height, "device_scale_factor": 1})
            page.goto(uri, wait_until="load", timeout=120_000)
            page.wait_for_timeout(400)
            page.screenshot(path=str(out_png), clip={"x": 0, "y": 0, "width": width, "height": height}, type="png")
            browser.close()
        ok = out_png.is_file() and out_png.stat().st_size > 200
        if ok:
            _log("  已用 HTML/CSS + Playwright 导出 PNG")
        return ok
    except Exception as ex:
        _log(f"⚠️ HTML→PNG 截图失败，将回退 Pillow: {ex}")
        return False
    finally:
        if tf is not None:
            try:
                tf.unlink(missing_ok=True)
            except OSError:
                pass


def _css_font_face(font_path: str | None) -> str:
    if not font_path:
        return ""
    fp = Path(font_path)
    if not fp.is_file():
        return ""
    try:
        uri = fp.resolve().as_uri()
    except OSError:
        return ""
    return (
        "@font-face{font-family:'MdtpFrame';src:url('" + uri + "') format('truetype');font-weight:100 900;}"
        "body,.page{font-family:'MdtpFrame','PingFang SC','Microsoft YaHei',sans-serif!important;}"
    )


def _build_title_lines_html(main_title: str) -> tuple[str, bool]:
    """返回标题块 HTML 与是否需要末行下划线。"""
    mt = (main_title or "").strip() or " "
    lines = [ln for ln in _wrap_cjk(mt, 9).splitlines() if ln.strip()][:3]
    chunks: list[str] = []
    for i, ln in enumerate(lines):
        segs = _accent_segments_line(ln.strip())
        inner: list[str] = []
        for seg, acc in segs:
            esc = html_module.escape(seg)
            inner.append(f'<span class="{"accent" if acc else "tit"}">{esc}</span>')
        cls = "title-line"
        if i == len(lines) - 1:
            cls += " title-line-last"
        chunks.append(f'<div class="{cls}">{"".join(inner)}</div>')
    block = "".join(chunks)
    return block, bool(lines)


def _build_open_html(
    main_title: str,
    sub_title: str,
    logo_uri: str,
    desk_uri: str,
    account: str,
    episode: int | None,
    font_css: str,
) -> str:
    hook = _opening_hook_line_short(sub_title)
    title_block, has_title = _build_title_lines_html(main_title)
    hook_html = ""
    if hook:
        hook_html = f'<div class="hook-strip">{html_module.escape(hook)}</div>'
    acc_raw = (account or "").strip()
    acc_disp = f"@{acc_raw.lstrip('@')}" if acc_raw else ""
    torn_uri = _svg_wavy_band_uri("f5f0e8")
    desk_section = ""
    if desk_uri:
        desk_section = f'''
    <div class="title-desk-bridge" aria-hidden="true"></div>
    <div class="desk-wrap">
      <div class="desk-top-fade" aria-hidden="true"></div>
      <img src="{desk_uri}" alt=""/>
      <div class="desk-torn" style="background-image:url(\'{torn_uri}\')"></div>
    </div>'''
    footer_logo = ""
    if logo_uri:
        footer_logo = f'<img class="footer-logo" src="{logo_uri}" alt=""/>'
    meta_lines = ""
    if acc_disp:
        meta_lines = f'<div class="acc">{html_module.escape(acc_disp)}</div>'
    meta_lines += f'<div class="tl">{html_module.escape(_BRAND_TAGLINE)}</div>'
    underline_html = ""
    if has_title:
        underline_html = '<div class="brush-underline" aria-hidden="true"></div>'
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<style>
{font_css}
:root{{
  --cream:#f5f0e8;--brown:#3d2f25;--orange:#f59e0b;--gray:#8c8c8c;--bar:#fff3e8;
}}
html,body{{margin:0;padding:0;width:1080px;height:1920px;overflow:hidden;background:#faf8f5;}}
.page{{width:1080px;height:1920px;display:flex;flex-direction:column;background:linear-gradient(180deg,#ffffff 0%,#faf6ef 18%,#f5f0e8 100%);color:var(--brown);}}
/* 标题与书桌收在同一竖条内成组居中，避免标题单独占据大片留白而与图片割裂 */
.upper{{flex:1 1 0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px 40px 20px;gap:0;}}
.title-zone{{width:100%;text-align:center;flex-shrink:0;}}
.title-line{{font-size:98px;line-height:1.06;font-weight:900;letter-spacing:-2px;}}
.title-line .accent{{color:var(--orange);}}
.title-line .tit{{color:var(--brown);}}
.brush-underline{{width:78%;height:14px;margin:14px auto 0;border-radius:10px;
  background:repeating-linear-gradient(90deg,var(--orange) 0 22px,var(--orange) 22px 30px);opacity:0.95;}}
.hook-strip{{margin:16px auto 0;max-width:900px;background:#3e3028;color:#fff;font-size:26px;font-weight:700;padding:18px 36px;border-radius:16px;text-align:center;}}
.title-desk-bridge{{width:90%;max-width:960px;height:32px;margin:10px auto 0;border-radius:0 0 28px 28px;
  background:linear-gradient(180deg,rgba(255,255,255,.92) 0%,rgba(245,240,232,.88) 55%,rgba(237,229,218,.35) 100%);
  box-shadow:0 12px 28px rgba(61,47,37,.07);flex-shrink:0;}}
.desk-wrap{{flex-shrink:0;height:340px;width:92%;max-width:980px;margin:0 auto 0;position:relative;overflow:hidden;
  border-radius:18px 18px 14px 14px;box-shadow:0 14px 40px rgba(61,47,37,.14);border:1px solid rgba(235,224,212,.9);}}
.desk-top-fade{{position:absolute;top:0;left:0;right:0;height:52px;z-index:2;border-radius:18px 18px 0 0;
  background:linear-gradient(180deg,rgba(252,250,247,.88) 0%,rgba(252,250,247,.15) 65%,rgba(252,250,247,0) 100%);pointer-events:none;}}
.desk-wrap img{{width:100%;height:100%;object-fit:cover;display:block;position:relative;z-index:0;}}
.desk-torn{{position:absolute;left:0;right:0;bottom:0;height:28px;z-index:3;background-repeat:no-repeat;background-position:center bottom;background-size:1080px 28px;pointer-events:none;}}
.footer-area{{flex:0 0 268px;background:var(--bar);border-top:2px solid #ffe4cf;display:flex;align-items:center;padding:0 52px;gap:22px;}}
.footer-logo{{width:118px;height:118px;border-radius:50%;object-fit:cover;flex-shrink:0;}}
.footer-meta .acc{{font-size:34px;font-weight:800;color:var(--brown);}}
.footer-meta .tl{{font-size:22px;color:var(--gray);margin-top:8px;line-height:1.35;}}
</style></head><body>
<div class="page">
  <div class="upper">
  <div class="title-zone">
    {title_block}
    {underline_html}
    {hook_html}
  </div>
  {desk_section}
  </div>
  <div class="footer-area">
    {footer_logo}
    <div class="footer-meta">{meta_lines}</div>
  </div>
</div>
</body></html>"""


def _build_end_html(
    ending: str,
    logo_uri: str,
    account: str,
    font_css: str,
) -> str:
    en = (ending or "").strip() or "感谢观看"
    paras = [p.strip() for p in en.split("\n") if p.strip()]
    if not paras:
        paras = [en]
    primary = paras[0]
    quote_lines = [ln for ln in _wrap_cjk(primary, 12).splitlines() if ln.strip()]
    quote_parts: list[str] = []
    for i, ln in enumerate(quote_lines):
        cls = "ql"
        if i == len(quote_lines) - 1:
            cls += " ql-last"
        quote_parts.append(f'<div class="{cls}">{html_module.escape(ln)}</div>')
    quote_html = "".join(quote_parts)
    last_ul = '<div class="quote-uline" aria-hidden="true"></div>' if quote_lines else ""
    acc_raw = (account or "").strip()
    acc_show = f"@{acc_raw.lstrip('@')}" if acc_raw else ""
    torn_uri = _svg_wavy_band_uri("dabe9e")
    footer_logo = f'<img class="ef-logo" src="{logo_uri}" alt=""/>' if logo_uri else ""
    acc_block = ""
    if acc_show:
        acc_block = f'<div class="ef-acc">{html_module.escape(acc_show)}</div>'
    acc_block += f'<div class="ef-tl">{html_module.escape(_BRAND_TAGLINE)}</div>'
    motto_line = f"—— {_BRAND_MOTTO} ——"
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<style>
{font_css}
:root{{--cream:#f5f0e8;--brown:#3d2f25;--orange:#f59e0b;--gray:#8c8c8c;--tan:#dabe9e;}}
html,body{{margin:0;padding:0;width:1080px;height:1920px;overflow:hidden;background:var(--cream);}}
.page{{width:1080px;height:1920px;display:flex;flex-direction:column;background:var(--cream);}}
.head-l{{text-align:center;padding-top:96px;font-size:24px;color:var(--gray);letter-spacing:2px;}}
.quote-wrap{{flex:1;display:flex;flex-direction:column;align-items:center;padding:32px 56px 0;}}
.ql{{font-size:58px;font-weight:900;line-height:1.28;color:var(--brown);text-align:center;max-width:980px;}}
.ql-last{{position:relative;padding-bottom:14px;}}
.quote-uline{{width:min(880px,92%);height:14px;margin:12px auto 0;border-radius:8px;background:repeating-linear-gradient(90deg,var(--orange) 0 20px,var(--orange) 20px 26px);opacity:0.95;}}
.end-title-bar{{width:92%;height:12px;margin:28px auto 8px;border-radius:8px;background:linear-gradient(90deg,var(--orange),#fbbf24,var(--orange));}}
.cta-shell{{padding:0 44px;margin-top:28px;flex-shrink:0;}}
.cta-box{{border:2px dashed var(--orange);border-radius:28px;padding:56px 36px 48px;position:relative;text-align:center;}}
.cta-star{{position:absolute;top:-20px;left:50%;transform:translateX(-50%);width:36px;height:36px;background:var(--orange);border-radius:50%;color:#fff;font-size:20px;line-height:36px;font-weight:800;}}
.cta-row{{font-size:34px;font-weight:800;color:var(--brown);margin:24px 0;}}
.spacer-f{{flex:1;min-height:12px;}}
.torn-bar{{height:28px;margin:0;background-repeat:no-repeat;background-position:center top;background-size:1080px 28px;flex-shrink:0;}}
.footer-t{{flex:0 0 auto;background:var(--tan);padding:42px 52px 52px;display:flex;gap:24px;align-items:flex-start;}}
.ef-logo{{width:118px;height:118px;border-radius:50%;object-fit:cover;flex-shrink:0;}}
.ef-acc{{font-size:34px;font-weight:900;color:var(--brown);}}
.ef-tl{{font-size:22px;color:#5c4c42;margin-top:10px;line-height:1.35;}}
.motto-b{{text-align:center;font-size:22px;color:#786860;padding:0 40px 44px;background:var(--tan);}}
</style></head><body>
<div class="page" style="position:relative;">
  <div class="head-l">{html_module.escape(_END_HEAD_LABEL)}</div>
  <div class="quote-wrap">
    {quote_html}
    {last_ul}
  </div>
  <div class="end-title-bar" aria-hidden="true"></div>
  <div class="cta-shell">
    <div class="cta-box">
      <div class="cta-star">★</div>
      <div class="cta-row">♥ 如果有用，记得点赞</div>
      <div class="cta-row">★ 先收藏，晚上试一次</div>
      <div class="cta-row">↗ 转给需要的家长看看</div>
    </div>
  </div>
  <div class="spacer-f"></div>
  <div class="torn-bar" style="background-image:url('{torn_uri}')"></div>
  <div class="footer-t">{footer_logo}<div>{acc_block}</div></div>
  <div class="motto-b">{html_module.escape(motto_line)}</div>
</div>
</body></html>"""


def _render_open_frame_html(
    out_path: Path,
    main_title: str,
    sub_title: str,
    logo_path: Path,
    font_path: str | None,
    account: str,
    episode: int | None,
    desk_image_path: Path | None,
) -> bool:
    logo_uri = logo_path.resolve().as_uri() if logo_path.is_file() else ""
    desk_p = desk_image_path if desk_image_path and desk_image_path.is_file() else _default_desk_image_path()
    desk_uri = desk_p.resolve().as_uri() if desk_p.is_file() else ""
    doc = _build_open_html(main_title, sub_title, logo_uri, desk_uri, account, episode, _css_font_face(font_path))
    return _render_html_to_png(doc, out_path)


def _render_end_frame_html(
    out_path: Path,
    ending: str,
    account: str,
    logo_path: Path,
    font_path: str | None,
) -> bool:
    logo_uri = logo_path.resolve().as_uri() if logo_path.is_file() else ""
    doc = _build_end_html(ending, logo_uri, account, _css_font_face(font_path))
    return _render_html_to_png(doc, out_path)


def _pillow_warm_open_frame(
    out_path: Path,
    main_title: str,
    sub_title: str,
    logo_path: Path,
    font_path: str | None,
    account: str = "",
    *,
    episode: int | None = None,
    desk_image_path: Path | None = None,
) -> None:
    """家庭教育 IP 封面（无底栏顶栏；品牌仅在底部）：大标题、深色笔触、`desk`、浅橙账号栏。"""
    from PIL import Image, ImageDraw  # type: ignore

    w, h = 1080, 1920
    im = _make_family_education_bg(w, h)
    dr = ImageDraw.Draw(im, "RGB")

    f_title, _, f_acc_bar, _, f_hook, f_motto = _truetype_cjk(
        font_path,
        (104, 40, 34, 28, 26, 22),
    )

    pad_x = 40
    bar_h = 268
    by = h - bar_h
    cx = w // 2

    desk_p = desk_image_path if desk_image_path and desk_image_path.is_file() else _default_desk_image_path()

    title_y = 130
    mt = (main_title or "").strip() or " "
    st_ = (sub_title or "").strip()
    sh = (226, 216, 206)

    title_wrapped = _wrap_cjk(mt, 9)
    lines_t = [ln for ln in title_wrapped.splitlines() if ln.strip()][:3]
    gap_title = 10
    y = title_y
    last_half_w = 48
    last_bottom = y

    for ln in lines_t:
        segs = _accent_segments_line(ln.strip())
        tw = 0
        for seg, _ac in segs:
            bb = dr.textbbox((0, 0), seg, font=f_title)
            tw += bb[2] - bb[0]
        _draw_text_segments_centered(dr, y, cx, segs, f_title, _FE_TITLE, _FE_ACCENT, shadow=sh)
        bb_ln = dr.textbbox((0, 0), ln.strip(), font=f_title)
        lh = bb_ln[3] - bb_ln[1]
        last_half_w = max(tw // 2, 48)
        last_bottom = y + lh
        y += lh + gap_title

    if lines_t:
        _draw_orange_brushstroke_underline(dr, w, cx, last_half_w, last_bottom)

    hook_line = _opening_hook_line_short(st_)

    hook_after_title = last_bottom + 22
    hook_bottom = hook_after_title
    if hook_line:
        hook_bottom = _draw_dark_brush_hook_strip(dr, w, cx, hook_after_title, hook_line, f_hook, pad_x)

    desk_top = hook_bottom + 12
    desk_seg_h = min(340, max(260, by - 24 - desk_top))
    desk_bottom = desk_top + desk_seg_h
    if desk_p.is_file() and desk_bottom - desk_top >= 100:
        _paste_scaled_desk_with_torn_bottom(im, desk_p, desk_top, desk_bottom, _FE_CREAM_BG)

    try:
        dr.rounded_rectangle([0, by, w, h], radius=0, fill=_FE_BAR_TOP)
    except Exception:
        dr.rectangle([0, by, w, h], fill=_FE_BAR_TOP)
    dr.line((48, by, w - 48, by), fill=(255, 228, 198), width=2)

    logo_big = 118
    acc_raw = (account or "").strip()
    acc_t = f"@{acc_raw.lstrip('@')}" if acc_raw else ""

    if logo_path.is_file():
        lx = 52
        ly = by + (bar_h - logo_big) // 2
        _paste_round_logo(im, logo_path, (lx, ly), logo_big)
        tx0 = lx + logo_big + 22
        ty0 = by + 46
        if acc_t:
            dr.text((tx0, ty0), acc_t, fill=_FE_TITLE, font=f_acc_bar)
            ab = dr.textbbox((0, 0), acc_t, font=f_acc_bar)
            dr.text((tx0, ty0 + (ab[3] - ab[1]) + 6), _BRAND_TAGLINE, fill=_FE_GRAY, font=f_motto)
        else:
            tl_bb = dr.textbbox((0, 0), _BRAND_TAGLINE, font=f_motto)
            dr.text((tx0, ty0 + 20), _BRAND_TAGLINE, fill=_FE_GRAY, font=f_motto)
    elif acc_t:
        ab = dr.textbbox((0, 0), acc_t, font=f_acc_bar)
        ax = int(w / 2 - (ab[2] - ab[0]) / 2)
        ay = by + 54
        dr.text((ax, ay), acc_t, fill=_FE_TITLE, font=f_acc_bar)
        tl_bb = dr.textbbox((0, 0), _BRAND_TAGLINE, font=f_motto)
        dr.text((int(w / 2 - (tl_bb[2] - tl_bb[0]) / 2), ay + (ab[3] - ab[1]) + 8), _BRAND_TAGLINE, fill=_FE_GRAY, font=f_motto)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    im.save(str(out_path), format="PNG")


def _pillow_warm_end_frame(
    out_path: Path,
    ending: str,
    account: str,
    logo_path: Path,
    font_path: str | None,
) -> None:
    """参考结尾图：顶栏提示、大金句+橙笔触、虚线互动框三行、赭石撕纸底栏与口号。"""
    from PIL import Image, ImageDraw  # type: ignore

    w, h = 1080, 1920
    im = _make_family_education_bg(w, h)
    dr = ImageDraw.Draw(im, "RGB")

    f_label, f_quote, f_cta_row, f_acc, f_tl, f_foot = _truetype_cjk(
        font_path,
        (26, 58, 34, 32, 22, 22),
    )

    footer_h = 300
    by = h - footer_h
    cx = w // 2

    bb_lab = dr.textbbox((0, 0), _END_HEAD_LABEL, font=f_label)
    dr.text((int(cx - (bb_lab[2] - bb_lab[0]) / 2), 96), _END_HEAD_LABEL, fill=_FE_GRAY, font=f_label)

    en = (ending or "").strip() or "感谢观看"
    paras = [p.strip() for p in en.split("\n") if p.strip()]
    if not paras:
        paras = [en]

    primary = paras[0]
    primary_lines: list[str] = []
    for ln in _wrap_cjk(primary, 12).splitlines():
        if ln.strip():
            primary_lines.append(ln)

    box_margin_bottom = 36
    box_h = 272
    box_b = by - box_margin_bottom
    box_t = box_b - box_h
    box_l, box_r = 52, w - 52

    line_gap_quote = 20

    def quote_block_height(lines: list[str]) -> int:
        t = 0
        for ln in lines:
            bb = dr.textbbox((0, 0), ln, font=f_quote)
            t += (bb[3] - bb[1]) + line_gap_quote
        return t - line_gap_quote if lines else 0

    qh_val = quote_block_height(primary_lines)
    q_top = max(118, box_t - 36 - qh_val)

    sh = (236, 226, 216)
    y_ = q_top
    last_bottom = y_
    tw_last = 120
    for ln in primary_lines:
        bb = dr.textbbox((0, 0), ln, font=f_quote)
        x = int(cx - (bb[2] - bb[0]) / 2)
        dr.text((x + 1, y_ + 1), ln, fill=sh, font=f_quote)
        dr.text((x, y_), ln, fill=_FE_TITLE, font=f_quote)
        tw_last = bb[2] - bb[0]
        last_bottom = y_ + (bb[3] - bb[1])
        y_ += (bb[3] - bb[1]) + line_gap_quote

    if primary_lines:
        _draw_orange_brushstroke_underline(dr, w, cx, max(tw_last // 2, 40), last_bottom)

    rad_box = 24
    _stroke_dashed_round_rect(dr, (box_l, box_t, box_r, box_b), rad_box, _FE_TITLE, 2)

    star_cy = box_t
    try:
        dr.ellipse([cx - 15, star_cy - 15, cx + 15, star_cy + 15], fill=_FE_ACCENT)
        dr.text((cx - 11, star_cy - 12), "★", fill=_FE_WHITE, font=f_label)
    except Exception:
        pass

    rows = (
        "♥ 如果有用，记得点赞",
        "★ 先收藏，晚上试一次",
        "↗ 转给需要的家长看看",
    )
    y_row = box_t + 44
    for row in rows:
        bb = dr.textbbox((0, 0), row, font=f_cta_row)
        dr.text((int(cx - (bb[2] - bb[0]) / 2), y_row), row, fill=_FE_TITLE, font=f_cta_row)
        y_row += 72

    dr = ImageDraw.Draw(im)
    _fill_torn_top_band(dr, w, by, h, _FE_END_BAR_TAN)

    logo_sz = 118
    acc_raw = (account or "").strip()
    acc_show = f"@{acc_raw.lstrip('@')}" if acc_raw else ""

    if logo_path.is_file():
        lx = 48
        ly = by + 42
        _paste_round_logo(im, logo_path, (lx, ly), logo_sz)
        tx0 = lx + logo_sz + 24
        ty0 = by + 52
        if acc_show:
            dr.text((tx0, ty0), acc_show, fill=_FE_TITLE, font=f_acc)
            ab = dr.textbbox((0, 0), acc_show, font=f_acc)
            dr.text((tx0, ty0 + (ab[3] - ab[1]) + 8), _BRAND_TAGLINE, fill=(92, 76, 66), font=f_tl)
        else:
            tl_bb = dr.textbbox((0, 0), _BRAND_TAGLINE, font=f_tl)
            dr.text((tx0, ty0 + 8), _BRAND_TAGLINE, fill=(92, 76, 66), font=f_tl)
    elif acc_show:
        ab = dr.textbbox((0, 0), acc_show, font=f_acc)
        ax = int(w / 2 - (ab[2] - ab[0]) / 2)
        ty_acc = by + 52
        dr.text((ax, ty_acc), acc_show, fill=_FE_TITLE, font=f_acc)
        tl_bb = dr.textbbox((0, 0), _BRAND_TAGLINE, font=f_tl)
        dr.text(
            (int(w / 2 - (tl_bb[2] - tl_bb[0]) / 2), ty_acc + (ab[3] - ab[1]) + 10),
            _BRAND_TAGLINE,
            fill=(92, 76, 66),
            font=f_tl,
        )
    else:
        tl_bb = dr.textbbox((0, 0), _BRAND_TAGLINE, font=f_tl)
        dr.text((int(w / 2 - (tl_bb[2] - tl_bb[0]) / 2), by + 90), _BRAND_TAGLINE, fill=(92, 76, 66), font=f_tl)

    motto_full = f"—— {_BRAND_MOTTO} ——"
    bb_m = dr.textbbox((0, 0), motto_full, font=f_foot)
    dr.text((int(cx - (bb_m[2] - bb_m[0]) / 2), h - 52), motto_full, fill=(120, 104, 94), font=f_foot)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    im.save(str(out_path), format="PNG")


def _draw_warm_open_frame(
    out_path: Path,
    main_title: str,
    sub_title: str,
    logo_path: Path,
    font_path: str | None,
    account: str = "",
    *,
    episode: int | None = None,
    desk_image_path: Path | None = None,
) -> None:
    """优先 HTML/CSS + Playwright；失败则 Pillow。"""
    if _video_frames_html_enabled() and _render_open_frame_html(
        out_path,
        main_title,
        sub_title,
        logo_path,
        font_path,
        account,
        episode,
        desk_image_path,
    ):
        return
    _pillow_warm_open_frame(
        out_path,
        main_title,
        sub_title,
        logo_path,
        font_path,
        account,
        episode=episode,
        desk_image_path=desk_image_path,
    )


def _draw_warm_end_frame(
    out_path: Path,
    ending: str,
    account: str,
    logo_path: Path,
    font_path: str | None,
) -> None:
    """优先 HTML/CSS + Playwright；失败则 Pillow。"""
    if _video_frames_html_enabled() and _render_end_frame_html(
        out_path,
        ending,
        account,
        logo_path,
        font_path,
    ):
        return
    _pillow_warm_end_frame(out_path, ending, account, logo_path, font_path)


async def _tts_edge(text: str, out_mp3: Path, voice: str) -> None:
    import edge_tts  # type: ignore

    if not text.strip():
        text = "。"
    comm = edge_tts.Communicate(text.strip(), voice)
    await comm.save(str(out_mp3))


_DEFAULT_LISTENHUB_OPENAPI = "https://api.marswave.ai/openapi"
# FlowTTS 单次输入约 1 万字符，超出则截断并打日志
_LISTENHUB_TTS_MAX_CHARS = 10_000


def _tts_listenhub(text: str, out_mp3: Path, tcfg: dict[str, Any]) -> None:
    """ListenHub OpenAPI: POST {base}/v1/tts，返回 MP3 二进制流。文档见 https://listenhub.ai/docs/en/openapi/api-reference/flowspeech"""
    lh = tcfg.get("listenhub") if isinstance(tcfg.get("listenhub"), dict) else {}
    api_key = (str(lh.get("apiKey") or "")).strip()
    voice = (str(lh.get("voice") or "CN-Man-Beijing-V2")).strip()
    model = (str(lh.get("model") or "flowtts")).strip()
    custom_base = (str(lh.get("baseUrl") or "")).strip()
    if custom_base:
        base = custom_base.rstrip("/")
    else:
        base = (os.environ.get("MDT_LISTENHUB_BASE_URL") or _DEFAULT_LISTENHUB_OPENAPI).strip().rstrip("/")
    if not api_key:
        raise RuntimeError(
            "ListenHub 需要在插件「短视频 → TTS」中填写 listenhub.apiKey，或 TTS 配置 JSON 的 listenhub.apiKey",
        )
    t = (text or "").strip() or "。"
    if len(t) > _LISTENHUB_TTS_MAX_CHARS:
        _log(f"ListenHub 文本超过 {_LISTENHUB_TTS_MAX_CHARS} 字，已截断")
        t = t[:_LISTENHUB_TTS_MAX_CHARS]
    body = json.dumps({"input": t, "voice": voice, "model": model}).encode("utf-8")
    url = f"{base}/v1/tts"
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            err_obj = json.loads(raw)
            msg = err_obj.get("message") or err_obj.get("error") or raw
        except json.JSONDecodeError:
            msg = raw or str(e)
        raise RuntimeError(f"ListenHub TTS 请求失败（{e.code}）: {msg}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"ListenHub TTS 网络错误: {e.reason}") from e
    if not data or len(data) < 64:
        raise RuntimeError("ListenHub TTS 返回空或无效内容")
    if data[:1] in (b"{", b"["):
        try:
            err_obj = json.loads(data.decode("utf-8", errors="replace"))
            msg = err_obj.get("message") or str(err_obj)
        except json.JSONDecodeError:
            msg = "ListenHub 返回非音频 JSON"
        raise RuntimeError(f"ListenHub TTS: {msg}")
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    out_mp3.write_bytes(data)
    _log(f"ListenHub TTS 已写入 {out_mp3.name}（约 {len(data) // 1024} KB）")


def _glob_knowledge_card_pngs_in_dir(d: Path) -> list[Path]:
    """
    优先 `card_*.png`；若无则回退为目录内除 cover.png 外的 `*.png`（与小红书导出命名兼容）。
    """
    cards = sorted(d.glob("card_*.png"), key=lambda p: p.name)
    if cards:
        return cards
    out: list[Path] = []
    for p in sorted(d.glob("*.png"), key=lambda q: q.name):
        if p.name.lower() == "cover.png":
            continue
        out.append(p)
    return out


def _collect_knowledge_card_pngs(
    candidate_dirs: list[Path],
    fallback: Path,
) -> tuple[list[Path], str]:
    """
    不拼 cover.png。按候选目录顺序，首个含卡片的目录生效。
    """
    for d in candidate_dirs:
        d = Path(d).resolve()
        if not d.is_dir():
            continue
        cards = _glob_knowledge_card_pngs_in_dir(d)
        if cards:
            return cards, str(d)
    fb = Path(fallback).resolve()
    if fb.is_dir():
        cards = _glob_knowledge_card_pngs_in_dir(fb)
        if cards:
            return cards, str(fb)
    raise FileNotFoundError(
        "未找到可用于轮播的 PNG 卡片。请确认 Published/xhs/<会话> 等目录有 card_1.png 等；"
        "cover.png 不会用于轮播。若尚未生成，请先「出小红书图」或扩写。",
    )


def _build_card_durations(
    imgs: list[Path],
    total_d: float,
) -> list[tuple[Path, float]]:
    n = len(imgs)
    if n == 0 or total_d <= 0.05:
        raise ValueError("无卡片或口播长度过短")
    lo, hi = 1.8, 3.2
    per = total_d / n
    if per < lo:
        per = lo
    elif per > hi:
        per = hi
    seq: list[tuple[Path, float]] = []
    t_acc = 0.0
    idx = 0
    while t_acc + 0.01 < total_d:
        rem = total_d - t_acc
        d = min(per, rem)
        if d < 0.1:
            break
        seq.append((imgs[idx % n], d))
        t_acc += d
        idx += 1
    if not seq:
        seq = [(imgs[0], max(0.2, min(hi, total_d)))]
    return seq


def _run_ffmpeg(args: list[str]) -> None:
    p = _which_ffmpeg()
    a = [p, *args]
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "").strip() or f"ffmpeg 失败: {a[:6]}…")


def _png_to_mp4(png: Path, seconds: float, out_mp4: Path) -> None:
    if seconds <= 0.05:
        seconds = 0.1
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg(
        [
            "-y",
            "-loop",
            "1",
            "-i",
            str(png),
            "-t",
            f"{seconds:.3f}",
            "-vf",
            "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(out_mp4),
        ]
    )


def _png_to_mp4_knowledge_fullbleed(png: Path, seconds: float, out_mp4: Path) -> None:
    """
    知识卡片多来自 3:4 等竖图，若用 pad 会上下/左右留黑条。
    用「同图裁切放大 + 轻模糊」铺满 9:16 作底，再叠完整清晰卡片，观感与首/尾全屏白卡一致、无黑边。
    滤镜失败时回退为 pad 方案。
    """
    if seconds <= 0.05:
        seconds = 0.1
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    ff = _which_ffmpeg()
    # 1) 优先盒式模糊；2) 双次缩小放大模拟景深；3) 与旧版 _png_to_mp4 一致
    filter_chain: list[str] = [
        (
            "[0:v]split=2[bg0][fg0];"
            "[bg0]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,format=rgb24,boxblur=22:1[bg];"
            "[fg0]scale=1080:1920:force_original_aspect_ratio=decrease[fg];"
            "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p"
        ),
        (
            "[0:v]split=2[bg0][fg0];"
            "[bg0]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,format=rgb24,scale=270:480:flags=bilinear,"
            "scale=1080:1920:flags=bilinear[bg];"
            "[fg0]scale=1080:1920:force_original_aspect_ratio=decrease[fg];"
            "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p"
        ),
    ]
    err_note = ""
    for fc in filter_chain:
        r = subprocess.run(
            [
                ff,
                "-y",
                "-loop",
                "1",
                "-i",
                str(png),
                "-t",
                f"{seconds:.3f}",
                "-filter_complex",
                fc,
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(out_mp4),
            ],
            capture_output=True,
            text=True,
        )
        if r.returncode == 0:
            return
        err_note = (r.stderr or r.stdout or "").strip() or "ffmpeg 失败"
    _log(f"全屏知识卡片滤镜不可用，回退黑边：{err_note[:400]}")
    _png_to_mp4(png, seconds, out_mp4)


def _images_duration_concat(imgs: list[Path], total_d: float, out_mp4: Path) -> None:
    """
    中段用与首尾帧相同的方式：每张 PNG 先 `-loop 1` 成短视频，再 concat。
    避免 `-f concat` + 静图在部分 FFmpeg 下时长为 0、成片只剩首尾的兼容性问题。
    """
    seq = _build_card_durations(imgs, total_d)
    s2 = sum(d for _, d in seq)
    if s2 + 1e-2 < total_d and seq:
        extra = total_d - s2
        last = seq[-1]
        seq[-1] = (last[0], last[1] + max(0, extra))
    with tempfile.TemporaryDirectory() as td2:
        tdir = Path(td2)
        parts: list[Path] = []
        for i, (fp, dur) in enumerate(seq):
            seg = tdir / f"card_seg_{i:04d}.mp4"
            _png_to_mp4_knowledge_fullbleed(fp, dur, seg)
            parts.append(seg)
        if not parts:
            raise ValueError("中段无卡片片段")
        if len(parts) == 1:
            shutil.copy2(parts[0], out_mp4)
        else:
            _concat_vids(parts, out_mp4)
    _log(f"  中段已拼接 {len(seq)} 段静图（总时长约 {sum(d for _, d in seq):.2f}s）")


def _concat_vids(parts: list[Path], out: Path) -> None:
    with tempfile.TemporaryDirectory() as td:
        tf = Path(td) / "vlist.txt"
        lines = []
        for p in parts:
            s = str(p.resolve()).replace("'", r"\'")
            lines.append(f"file '{s}'")
        tf.write_text("\n".join(lines) + "\n", encoding="utf-8")
        _run_ffmpeg(
            [
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(tf),
                "-c",
                "copy",
                str(out),
            ]
        )


def _build_silence_aac(sec: float, out_aac: Path) -> None:
    _run_ffmpeg(
        [
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"anullsrc=channel_layout=stereo:sample_rate=44100",
            "-t",
            f"{sec:.3f}",
            "-c:a",
            "aac",
            str(out_aac),
        ]
    )


def _concatAudio3(sil1: Path, mid: Path, sil2: Path, out: Path) -> None:
    _run_ffmpeg(
        [
            "-y",
            "-i",
            str(sil1),
            "-i",
            str(mid),
            "-i",
            str(sil2),
            "-filter_complex",
            "[0:a][1:a][2:a]concat=n=3:v=0:a=1[aout]",
            "-map",
            "[aout]",
            "-c:a",
            "aac",
            str(out),
        ]
    )


def _mux(vpath: Path, apath: Path, out: Path) -> None:
    _run_ffmpeg(
        [
            "-y",
            "-i",
            str(vpath),
            "-i",
            str(apath),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            str(out),
        ]
    )


def _mix_voice_with_bgm(
    voice_aac: Path,
    bgm_mp3: Path,
    bgm_linear: float,
    out_m4a: Path,
) -> None:
    """人声音量保持 1.0 感知为主；BGM 循环垫满时长并以较低音量与 amix 混合，再限幅防削波。"""
    if not voice_aac.is_file():
        raise FileNotFoundError(f"人声音频不存在: {voice_aac}")
    if not bgm_mp3.is_file():
        raise FileNotFoundError(f"背景音乐不存在: {bgm_mp3}")
    d_v = _ffprobe_duration_audio(voice_aac)
    vol = min(0.45, max(0.04, float(bgm_linear)))
    # FFmpeg 8+：channel_layouts 只能写在 aformat= 内，不能写成伪「独立滤镜」
    d_str = f"{d_v:.6f}"
    fc = (
        f"[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[va];"
        f"[1:a]aloop=loop=-1:size=2e+09,atrim=0:{d_str},asetpts=PTS-STARTPTS,"
        f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={vol}[vm];"
        f"[va][vm]amix=inputs=2:duration=first:normalize=0[amx];"
        f"[amx]alimiter=limit=0.94[aout]"
    )
    out_m4a.parent.mkdir(parents=True, exist_ok=True)
    p = _which_ffmpeg()
    r = subprocess.run(
        [p, "-y", "-i", str(voice_aac), "-i", str(bgm_mp3), "-filter_complex", fc, "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", str(out_m4a)],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "").strip() or "ffmpeg 混音失败")


def main() -> int:
    raw = (os.environ.get("MDT_VIDEO_JOB_JSON") or "").strip()
    if not raw:
        _err("缺少 MDT_VIDEO_JOB_JSON")
        return 1
    tts_json = (os.environ.get("MDT_VIDEO_TTS_CONFIG_JSON") or "{}").strip()
    engine = (os.environ.get("MDT_VIDEO_TTS_ENGINE") or "edge").strip().lower()
    try:
        job = json.loads(raw)
    except json.JSONDecodeError as e:
        _err(f"MDT_VIDEO_JOB_JSON 非合法 JSON: {e}")
        return 1
    try:
        tcfg: dict[str, Any] = json.loads(tts_json) if tts_json else {}
    except json.JSONDecodeError:
        tcfg = {}

    img_dir = Path((job.get("imagesDir") or "")).resolve()
    out_dir = Path((job.get("outputDir") or "")).resolve()
    vcfg: dict[str, Any] = job.get("videoConfig") or job.get("config") or {}
    if not vcfg and isinstance(job, dict) and "accountInfo" in job:
        vcfg = job
    if not out_dir or not out_dir.is_dir():
        out_dir.mkdir(parents=True, exist_ok=True)

    open_sec = float(job.get("openSec", 2.5))
    end_sec = float(job.get("endSec", 3.5))

    voiceover = (vcfg.get("voiceover") or "").strip()
    if not voiceover and isinstance(vcfg.get("platforms"), dict):
        voiceover = "这是一段家长口播，请先完善 video_config 中的 voiceover 字段或重试扩写。"
    plats = (vcfg.get("platforms") or {}) if isinstance(vcfg, dict) else {}
    if not plats:
        _err("video_config 缺少 platforms")
        return 1
    if not _check_pillow():
        return 1

    frame_font = _resolve_frame_font_from_job(job)

    # TTS
    tts_engine = tcfg.get("engine") or engine
    if str(tts_engine).lower() in ("edge", "edgetts", "edge-tts"):
        edge_voice = (tcfg.get("edge") or {}).get("voice") if isinstance(tcfg.get("edge"), dict) else None
        voice = str(edge_voice or "zh-CN-YunxiNeural")
    else:
        voice = "zh-CN-YunxiNeural"

    main_mp3 = out_dir / "voiceover_main.mp3"
    if str(tts_engine).lower() in ("edge", "edgetts", "edge-tts", ""):
        asyncio.run(_tts_edge(voiceover, main_mp3, voice))
    elif "listen" in str(tts_engine).lower():
        _tts_listenhub(voiceover, main_mp3, tcfg)
    else:
        asyncio.run(_tts_edge(voiceover, main_mp3, voice))

    d_main = _ffprobe_duration_audio(main_mp3) if main_mp3.is_file() else 1.0
    _log(f"主口播约 {d_main:.2f} 秒")

    raw_cands = job.get("cardImageDirs")
    cands: list[Path] = []
    if isinstance(raw_cands, list):
        cands = [Path(str(x).strip()) for x in raw_cands if str(x).strip()]
    elif isinstance(raw_cands, str) and raw_cands.strip():
        cands = [Path(raw_cands.strip())]
    if not cands:
        cands = [img_dir]
    logo_str = (str(job.get("logoPath") or "")).strip()
    logo_p = Path(logo_str) if logo_str else Path()

    try:
        imgs, used_card_dir = _collect_knowledge_card_pngs(cands, img_dir)
    except FileNotFoundError as ex:
        _err(str(ex))
        return 1
    _log(f"轮播知识卡片 {len(imgs)} 张，来源：{used_card_dir}（不含 cover）")

    _raw_bgm = job.get("backgroundMusic")
    bgm_cfg: dict[str, Any] = _raw_bgm if isinstance(_raw_bgm, dict) else {}
    use_bgm = bool(bgm_cfg.get("enabled", False))
    bgm_path = (str(bgm_cfg.get("path") or "")).strip()
    try:
        bgm_vol = float(bgm_cfg.get("volume", 0.14))
    except (TypeError, ValueError):
        bgm_vol = 0.14

    with tempfile.TemporaryDirectory() as tdx:
        td = Path(tdx)
        sil_open = td / "sil_open.aac"
        sil_end = td / "sil_end.aac"
        mrg = td / "mrg.aac"
        _build_silence_aac(open_sec, sil_open)
        _build_silence_aac(end_sec, sil_end)
        _run_ffmpeg(
            [
                "-y",
                "-i",
                str(main_mp3),
                "-c:a",
                "aac",
                str(td / "main.aac"),
            ]
        )
        _concatAudio3(sil_open, td / "main.aac", sil_end, mrg)
        mrg_for_mux: Path = mrg
        if use_bgm:
            candidate = Path(bgm_path) if bgm_path else (
                _VENV_DIR.parent / "resource" / "mp3" / "65歌曲.mp3"
            )
            if candidate.is_file():
                mixed = td / "voice_with_bgm.m4a"
                try:
                    _mix_voice_with_bgm(mrg, candidate, bgm_vol, mixed)
                    mrg_for_mux = mixed
                    _log(f"已混合背景音乐: {candidate.name}（衬底系数 {min(0.45, max(0.04, bgm_vol)):.3f}）")
                except Exception as ex:
                    _log(f"⚠️ 背景音乐混音失败，仅使用人声音轨: {ex}")
                    mrg_for_mux = mrg
            else:
                _log(f"⚠️ 未找到背景音乐文件: {candidate}，仅导出口播")

        try:
            shutil.copy2(mrg_for_mux, out_dir / "voice_mixed.m4a")
        except OSError:
            shutil.copy2(mrg, out_dir / "voice_mixed.m4a")

        for pname, pcopy in (("douyin", plats.get("douyin")), ("xiaohongshu", plats.get("xiaohongshu")), ("shipinhao", plats.get("shipinhao"))):
            if not isinstance(pcopy, dict):
                _err(f"platforms.{pname} 无效，跳过")
                continue
            ct = str(pcopy.get("cover_title", ""))
            op = str(pcopy.get("opening_text", ""))
            en = str(pcopy.get("ending_text", ""))
            acc = str(vcfg.get("accountInfo", ""))

            ep_val: int | None = None
            for key in ("episode", "coverEpisode", "issue"):
                raw_ep = vcfg.get(key)
                if raw_ep is None and isinstance(pcopy, dict):
                    raw_ep = pcopy.get(key)
                if raw_ep is not None:
                    try:
                        ep_val = int(raw_ep)
                        break
                    except (TypeError, ValueError):
                        continue

            desk_override = (str(vcfg.get("deskImagePath") or "").strip())
            desk_use = Path(desk_override) if desk_override else _default_desk_image_path()

            op_png = out_dir / f"frame_{pname}_open.png"
            en_png = out_dir / f"frame_{pname}_end.png"
            _draw_warm_open_frame(
                op_png,
                ct,
                op,
                logo_p,
                frame_font,
                acc,
                episode=ep_val,
                desk_image_path=desk_use if desk_use.is_file() else None,
            )
            _draw_warm_end_frame(en_png, en, acc, logo_p, frame_font)

            o_mp4 = td / f"open_{pname}.mp4"
            m_mp4 = td / f"mid_{pname}.mp4"
            e_mp4 = td / f"end_{pname}.mp4"
            a_mp4 = td / f"all_{pname}.mp4"
            f_final = out_dir / f"{pname}.mp4"

            _png_to_mp4(op_png, open_sec, o_mp4)
            try:
                _images_duration_concat(imgs, d_main, m_mp4)
            except Exception as ex:
                _err(f"中段图片 concat 使用单图回退: {ex}")
                _images_duration_concat([imgs[0]], d_main, m_mp4)
            _png_to_mp4(en_png, end_sec, e_mp4)
            _concat_vids([o_mp4, m_mp4, e_mp4], a_mp4)
            _mux(a_mp4, mrg_for_mux, f_final)
            _log(f"  已写 {f_final}")

    _default_bgm = str(_VENV_DIR.parent / "resource" / "mp3" / "65歌曲.mp3")
    meta = {
        **{k: v for k, v in vcfg.items() if not str(k).startswith("_")},
        "mainVoiceSec": d_main,
        "openSec": open_sec,
        "endSec": end_sec,
        "imageDir": str(img_dir),
        "knowledgeCardDir": used_card_dir,
        "knowledgeCardCount": len(imgs),
        "cardImageDirCandidates": [str(p) for p in cands],
        "logoPath": str(logo_p) if logo_p and logo_p.is_file() else None,
        "frameFont": frame_font,
        "backgroundMusic": {
            "enabled": use_bgm,
            "path": bgm_path or _default_bgm,
            "volume": min(0.45, max(0.04, float(bgm_vol))) if use_bgm else None,
        },
    }
    (out_dir / "mdtp_video_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _log("完成。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        _err(str(e))
        if os.environ.get("MDT_DEBUG", "").strip() in ("1", "true", "yes"):
            traceback.print_exc()
        sys.exit(1)
