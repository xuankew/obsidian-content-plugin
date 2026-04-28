#!/usr/bin/env python3
"""
MDTP 短视频：TTS（edge-tts 优先）+ Pillow 做开头/尾帧 + FFmpeg 拼竖屏 1080x1920。

环境变量:
  MDT_VIDEO_JOB_JSON   见下方
  MDT_VIDEO_TTS_CONFIG_JSON
  MDT_VIDEO_TTS_ENGINE  edge | listenhub
  MDT_VIDEO_FFMPEG_PATH 可选，为 ffmpeg 所在**目录**或完整路径
  MDT_DEBUG
  MDT_LISTENHUB_BASE_URL  可选，默认 https://api.marswave.ai/openapi（ListenHub TTS 根路径）

MDT_VIDEO_JOB_JSON 内可选 backgroundMusic: {"enabled": true, "path": "/…/x.mp3", "volume": 0.14}
  volume 为 BGM 线性音量（人声称 1.0），推荐 0.10～0.20。未传则脚本内不混 BGM（兼容旧版）。
"""

from __future__ import annotations

import asyncio
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
    from PIL import Image  # type: ignore

    im = Image.new("RGB", (w, h))
    px = im.load()
    # 左：柔粉紫 → 右：暖桃；略向下加奶油感
    c_left = (240, 232, 255)
    c_right = (255, 230, 220)
    c_bottom = (255, 248, 240)
    for y in range(h):
        ty = y / max(1, h - 1)
        for x in range(w):
            tx = x / max(1, w - 1)
            r = int(
                _lerp_f(
                    _lerp_f(c_left[0], c_right[0], tx),
                    c_bottom[0],
                    0.35 * ty,
                )
            )
            g = int(
                _lerp_f(
                    _lerp_f(c_left[1], c_right[1], tx),
                    c_bottom[1],
                    0.35 * ty,
                )
            )
            b = int(
                _lerp_f(
                    _lerp_f(c_left[2], c_right[2], tx),
                    c_bottom[2],
                    0.35 * ty,
                )
            )
            px[x, y] = (r, g, b)
    return im


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


def _draw_warm_open_frame(
    out_path: Path,
    main_title: str,
    sub_title: str,
    logo_path: Path,
    font_path: str | None,
) -> None:
    from PIL import Image, ImageDraw  # type: ignore

    w, h = 1080, 1920
    im = _make_warm_gradient_bg(w, h)
    dr = ImageDraw.Draw(im, "RGB")
    # 主标题更醒目、副标题略小；与小红书卡片用同一套霞鹜/插件 fonts
    f_title, f_sub, _a, _b, _c, _d = _truetype_cjk(
        font_path,
        (72, 40, 36, 32, 28, 24),
    )

    logo_size = 168
    top_y = 140
    center_x = w // 2
    if logo_path.is_file():
        _paste_round_logo(
            im,
            logo_path,
            (int(center_x - logo_size // 2), top_y),
            logo_size,
        )
        card_y0 = top_y + logo_size + 36
    else:
        card_y0 = 200

    card_m = 52
    card_top = min(card_y0 + 4, 500)
    card_h = 880
    card_l = card_m
    card_r = w - card_m
    card_b = card_top + card_h
    # 轻阴影底（纸质感，勿用过深）
    try:
        dr.rounded_rectangle(
            [card_l + 5, card_top + 8, card_r + 5, card_b + 8],
            radius=34,
            fill=(230, 218, 208),
        )
    except Exception:
        pass
    try:
        dr.rounded_rectangle(
            [card_l, card_top, card_r, card_b],
            radius=32,
            fill=(255, 253, 250),
            outline=(255, 198, 175),
            width=2,
        )
    except Exception:
        dr.rectangle(
            [card_l, card_top, card_r, card_b],
            fill=(255, 253, 250),
            outline=(255, 198, 175),
            width=2,
        )

    mt = (main_title or "").strip() or " "
    st_ = (sub_title or "").strip()
    c_main = (65, 48, 35)
    c_sub = (105, 80, 65)
    sh = (235, 225, 215)
    y = card_top + 80
    cx = w // 2
    for ln in _wrap_cjk(mt, 11).splitlines():
        if not ln.strip():
            continue
        bb = dr.textbbox((0, 0), ln, font=f_title)
        x = int(cx - (bb[2] - bb[0]) / 2)
        dr.text((x + 1, y + 1), ln, fill=sh, font=f_title)
        dr.text((x, y), ln, fill=c_main, font=f_title)
        y += (bb[3] - bb[1]) + 22
    if st_:
        # 主副标题之间留足呼吸感
        y += 40
        for ln in _wrap_cjk(st_, 16).splitlines():
            if not ln.strip():
                continue
            bb = dr.textbbox((0, 0), ln, font=f_sub)
            x = int(cx - (bb[2] - bb[0]) / 2)
            dr.text((x + 1, y + 1), ln, fill=sh, font=f_sub)
            dr.text((x, y), ln, fill=c_sub, font=f_sub)
            y += (bb[3] - bb[1]) + 18

    out_path.parent.mkdir(parents=True, exist_ok=True)
    im.save(str(out_path), format="PNG")


def _draw_warm_end_frame(
    out_path: Path,
    ending: str,
    account: str,
    logo_path: Path,
    font_path: str | None,
) -> None:
    from PIL import Image, ImageDraw  # type: ignore

    w, h = 1080, 1920
    im = _make_warm_gradient_bg(w, h)
    dr = ImageDraw.Draw(im, "RGB")
    # 首行收束语更大，次行引导关注/福利略小，字重层次与参考图一致
    f_head, f_body, f_acc, _a, _b, _c = _truetype_cjk(
        font_path,
        (48, 34, 34, 30, 28, 24),
    )

    bar_h = 200
    by = h - bar_h
    try:
        dr.rounded_rectangle(
            [0, by, w, h],
            radius=0,
            fill=(255, 224, 205),
        )
    except Exception:
        dr.rectangle([0, by, w, h], fill=(255, 224, 205))
    dr.line((60, by, w - 60, by), fill=(255, 200, 175), width=2)

    acc_t = f"@{account.lstrip('@')}" if (account and account.strip()) else ""
    if acc_t:
        ab = dr.textbbox((0, 0), acc_t, font=f_acc)
        ax = int(w / 2 - (ab[2] - ab[0]) / 2)
        ay = int(by + (bar_h - (ab[3] - ab[1])) / 2)
        dr.text((ax, ay), acc_t, fill=(78, 52, 42), font=f_acc)
    en = (ending or "").strip() or "感谢观看"
    paras = [p.strip() for p in en.split("\n") if p.strip()]
    if not paras:
        paras = [en]

    primary = paras[0]
    secondary = "\n".join(paras[1:]) if len(paras) > 1 else ""
    primary_lines: list[str] = []
    for ln in _wrap_cjk(primary, 14).splitlines():
        if ln.strip():
            primary_lines.append(ln)
    sec_lines: list[str] = []
    if secondary:
        for ln in _wrap_cjk(secondary, 18).splitlines():
            if ln.strip():
                sec_lines.append(ln)

    logo_size = 136
    content_top = 400
    content_bottom = by - 72
    center_x = w // 2
    y_cursor = content_top + 28
    if logo_path.is_file():
        _paste_round_logo(
            im,
            logo_path,
            (int(center_x - logo_size / 2), y_cursor),
            logo_size,
        )
        y_cursor += logo_size + 28

    sh = (238, 228, 218)
    c_head = (62, 46, 36)
    c_body = (88, 68, 54)
    line_gap_head = 22
    line_gap_body = 20
    gap_between_blocks = 36

    def block_height(lines: list[str], font, gap: int) -> int:
        t = 0
        for ln in lines:
            bb = dr.textbbox((0, 0), ln, font=font)
            t += (bb[3] - bb[1]) + gap
        return t - gap if lines else 0

    th1 = block_height(primary_lines, f_head, line_gap_head)
    th2 = block_height(sec_lines, f_body, line_gap_body)
    total_block = th1 + (gap_between_blocks if sec_lines else 0) + th2
    y_start = int(y_cursor + max(0, (content_bottom - y_cursor - total_block) / 2))
    y_ = y_start
    for ln in primary_lines:
        bb = dr.textbbox((0, 0), ln, font=f_head)
        x = int(center_x - (bb[2] - bb[0]) / 2)
        dr.text((x + 1, y_ + 1), ln, fill=sh, font=f_head)
        dr.text((x, y_), ln, fill=c_head, font=f_head)
        y_ += (bb[3] - bb[1]) + line_gap_head
    if sec_lines:
        y_ += gap_between_blocks
        for ln in sec_lines:
            bb = dr.textbbox((0, 0), ln, font=f_body)
            x = int(center_x - (bb[2] - bb[0]) / 2)
            dr.text((x + 1, y_ + 1), ln, fill=sh, font=f_body)
            dr.text((x, y_), ln, fill=c_body, font=f_body)
            y_ += (bb[3] - bb[1]) + line_gap_body

    out_path.parent.mkdir(parents=True, exist_ok=True)
    im.save(str(out_path), format="PNG")


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

            op_png = out_dir / f"frame_{pname}_open.png"
            en_png = out_dir / f"frame_{pname}_end.png"
            _draw_warm_open_frame(op_png, ct, op, logo_p, frame_font)
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
