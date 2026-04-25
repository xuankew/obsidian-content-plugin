#!/usr/bin/env python3
"""
小红书笔记发布脚本 - 增强版

来源与许可：核心发布逻辑衍自 Auto-Redbook-Skills
https://github.com/comeonzhj/Auto-Redbook-Skills （md-to-platform 仅作整合与 MDT 环境变量适配）。

md-to-platform（Obsidian）调用方式：
  由插件在「发布小红书」中注入环境变量并执行本脚本，无需手填 -t / -i。
  仅 Obsidian 发笔记：在设置里填 Cookie 时，本机 **最少** `pip3 install xhs` 即可
  （Cookie 经环境变量传入，不强制 python-dotenv / requests；见 requirements-xhs-publish.txt 说明）

支持直接发布（本地签名）和通过 API 服务发布两种方式

使用方法:
    # 直接发布（使用本地签名）
    python publish_xhs.py --title "标题" --desc "描述" --images cover.png card_1.png
    
    # 通过 API 服务发布
    python publish_xhs.py --title "标题" --desc "描述" --images cover.png card_1.png --api-mode

环境变量:
    在同目录或项目根目录下创建 .env 文件，配置：
    
    # 必需：小红书 Cookie
    XHS_COOKIE=your_cookie_string_here
    
    # 可选：API 服务地址（使用 --api-mode 时需要）
    XHS_API_URL=http://localhost:5005

依赖安装:
    发布（非 API 模式）最低：pip3 install xhs
    或完整：pip3 install -r requirements-xhs-publish.txt
"""

import argparse
import os
import sys
import re
from pathlib import Path
from typing import List, Optional, Dict, Any


def _env_file_paths() -> List[Path]:
    return [
        Path.cwd() / ".env",
        Path(__file__).parent.parent / ".env",
        Path(__file__).parent.parent.parent / ".env",
    ]


def _try_load_dotenv_from_paths() -> None:
    """若已安装 python-dotenv 则加载 .env；未安装时静默跳过。"""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for env_path in _env_file_paths():
        if env_path.exists():
            load_dotenv(env_path)
            break


def _read_xhs_cookie_from_dotenv_file_raw() -> str:
    """
    不依赖 python-dotenv，从 .env 读一行 `XHS_COOKIE=...`（供纯 pip install xhs 用户）。
    """
    for env_path in _env_file_paths():
        if not env_path.is_file():
            continue
        try:
            for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
                s = line.strip()
                if s.startswith("XHS_COOKIE="):
                    v = s.split("=", 1)[1].strip()
                    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                        v = v[1:-1]
                    return v
        except OSError:
            pass
    return ""


def load_cookie() -> str:
    """从环境变量或 .env 加载 Cookie。Obsidian 插件会传 MDT_XHS_COOKIE。"""
    mdt = (os.environ.get("MDT_XHS_COOKIE") or "").strip()
    if mdt:
        return mdt
    _try_load_dotenv_from_paths()
    xhs = (os.environ.get("XHS_COOKIE") or "").strip()
    if xhs:
        return xhs
    raw = _read_xhs_cookie_from_dotenv_file_raw()
    if raw:
        return raw
    print("❌ 错误: 未找到 Cookie（请设置 MDT_XHS_COOKIE 或 XHS_COOKIE / .env）")
    print("在 Obsidian：设置 → MD to Platform → 小红书 →「小红书登录 Cookie（可选）」")
    print("\nCookie 获取方式：")
    print("1. 在浏览器中登录 https://www.xiaohongshu.com")
    print("2. 开发者工具（F12）→ Network → 任意请求 → 复制完整 Cookie 头")
    sys.exit(1)


def parse_cookie(cookie_string: str) -> Dict[str, str]:
    """解析 Cookie 字符串为字典"""
    cookies = {}
    for item in cookie_string.split(';'):
        item = item.strip()
        if '=' in item:
            key, value = item.split('=', 1)
            cookies[key.strip()] = value.strip()
    return cookies


def validate_cookie(cookie_string: str) -> bool:
    """验证 Cookie 是否包含必要的字段"""
    cookies = parse_cookie(cookie_string)
    
    # 检查必需的 cookie 字段
    required_fields = ['a1', 'web_session']
    missing = [f for f in required_fields if f not in cookies]
    
    if missing:
        print(f"⚠️ Cookie 可能不完整，缺少字段: {', '.join(missing)}")
        print("这可能导致签名失败，请确保 Cookie 包含 a1 和 web_session 字段")
        return False
    
    return True


def _print_xhs_troubleshoot_hints(e: BaseException) -> None:
    """对 xhs 本地发笔记常见错误输出中文说明（不依赖具体异常子类，主看消息与栈中关键词）。"""
    msg = f"{type(e).__name__}: {e}"
    low = msg.lower()
    is_signish = any(
        k in low
        for k in (
            "sign",
            "signature",
            "external_sign",
            "pre_header",
            "get_upload",
            "permit",
        )
    )
    is_auth = any(
        k in low
        for k in (
            "401",
            "403",
            "unauthorized",
            "forbidden",
            "登录",
            "login",
            "cookie",
            "session",
        )
    )
    is_net = any(k in low for k in ("connection", "timeout", "ssl", "network", "proxy"))

    if is_signish or is_auth or is_net:
        print()
        if is_signish and not is_auth and not is_net:
            print("💡 与签名/预请求（如 external_sign、get_upload_files_permit）相关时，常见原因：")
        elif is_net and not (is_signish or is_auth):
            print("💡 与网络/连接相关时：")
        else:
            print("💡 发布失败（登录、签名或网络）时：")
        print("1. 在浏览器重新打开 xiaohongshu.com 并登录，从开发者工具复制完整 Cookie（需含 a1、web_session）。")
        print("2. 在 Obsidian 插件设置中更新「小红书登录 Cookie」。")
        extra: List[str] = []
        if is_signish or is_auth:
            extra.append("在用于发布的虚拟环境中执行：pip install -U xhs（与站点/签名不同步时有效）。")
        if is_net:
            extra.append("检查本机网络、代理/VPN、公司防火墙后重试。")
        n = 3
        for line in extra:
            print(f"{n}. {line}")
            n += 1
        print(
            f"{n}. 若仍失败，可设置环境变量 MDT_DEBUG=1 后重试并保留完整输出；或考虑 --api-mode（需自架 xhs-api）。"
        )
    else:
        print()
        print("💡 若与签名/上传/登录态有关：重登后更新 Cookie，并在 venv 中执行 pip install -U xhs；或设置 MDT_DEBUG=1 获取完整堆栈。")


def get_api_url() -> str:
    """获取 API 服务地址"""
    return os.getenv('XHS_API_URL', 'http://localhost:5005')


def validate_images(image_paths: List[str]) -> List[str]:
    """验证图片文件是否存在"""
    valid_images = []
    for path in image_paths:
        if os.path.exists(path):
            valid_images.append(os.path.abspath(path))
        else:
            print(f"⚠️ 警告: 图片不存在 - {path}")
    
    if not valid_images:
        print("❌ 错误: 没有有效的图片文件")
        sys.exit(1)
    
    return valid_images


def _strip_md_light(s: str) -> str:
    s = re.sub(r"^---[\s\S]*?---\s*", "", s, count=1)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"^#+\s*", "", s, flags=re.M)
    s = re.sub(r"\s+", " ", s).strip()
    return s


_RE_XHS_TITLE_ENUM = re.compile(
    r"^\s*("
    r"第[0-9０-９一二三四五六七八九十百千两]+[步][、,，]?\s*|"
    r"[（(][0-9０-９一二三四五六七八九十]+[）)]\s*|"
    r"[0-9０-９]+[、,，.．:：]\s*|"
    r"[0-9０-９]+[)）]\s*"
    r")",
    re.UNICODE,
)


def _strip_xhs_title_enumeration(s: str) -> str:
    """与插件 stripLeadingEnumerationFromXhsTitle 一致：标题行首去掉 `1、``（1）` 等。"""
    t = s.lstrip("\ufeff")
    prev = None
    while t != prev:
        prev = t
        t = _RE_XHS_TITLE_ENUM.sub("", t).lstrip()
    return t.strip()


def _strip_inline_md_for_title(s: str) -> str:
    """与插件 plainTitle.stripInlineMarkdownForTitle 对齐：标题去 **、[]() 等。"""
    if not s:
        return ""
    t = s
    for _ in range(10):
        u = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", t)
        u = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", u)
        u = re.sub(r"\*\*([^*]+)\*\*", r"\1", u)
        u = re.sub(r"`+([^`]+)`+", r"\1", u)
        u = re.sub(r"~~([^~]+)~~", r"\1", u)
        u = re.sub(r"<[^>]{1,200}>", "", u)
        if u == t:
            break
        t = u
    return re.sub(r"\s+", " ", t).strip()


def _to_plain_title_for_xhs_api(s: str) -> str:
    """与插件 toPlainTitleForPlatformDrafts 一致：发笔记 API 用纯文字标题。"""
    if not s:
        return ""
    try:
        t = s.replace("\ufeff", "").strip()
        for _ in range(3):
            t = _strip_xhs_title_enumeration(t)
            t = _strip_inline_md_for_title(t)
        return t.strip()
    except Exception:
        return (s or "").strip()[:256]


def parse_publish_xhs_mdtp(text: str) -> tuple[str, str]:
    """与插件 extractXhsCoverFields 对齐：标题1、发布正文块、标题2 兜底。"""
    t1 = re.search(r"标题\s*[1１一]\s*[：:]\s*(.+?)(?:\n|$)", text)
    title = _to_plain_title_for_xhs_api(t1.group(1).strip()) if t1 else ""
    body_sec = re.search(
        r"(?:^|\n)##\s*发布正文[^\n]*\n+([\s\S]+?)(?=\n##\s|\Z)", text, re.M
    )
    if body_sec:
        desc = body_sec.group(1).strip()
    else:
        t2 = re.search(r"标题\s*[2２二]\s*[：:]\s*(.+?)(?:\n|$)", text)
        desc = t2.group(1).strip() if t2 else ""
    if not desc:
        desc = _strip_md_light(text)[:2000] or " "
    else:
        desc = _strip_md_light(desc)[:2000]
    if not title:
        line = ""
        for raw in text.splitlines():
            s = raw.strip()
            if s and not s.startswith("#") and "：" not in s[:3]:
                line = s
                break
        if line:
            t0 = re.sub(r"^#+\s*", "", line).strip()
            t0 = _to_plain_title_for_xhs_api(t0)
            title = t0[:20] if len(t0) > 20 else t0
        else:
            title = "笔记"
    title = _to_plain_title_for_xhs_api(title)
    if not title:
        title = "笔记"
    if len(title) > 20:
        title = title[:20]
    return title, desc or " "


def list_mdtp_image_paths(img_dir: str) -> list[str]:
    """先 cover.png，再 card_1, card_2, … 与平台上传习惯一致。"""
    out: list[str] = []
    cover = os.path.join(img_dir, "cover.png")
    if os.path.isfile(cover):
        out.append(os.path.abspath(cover))
    card_names: list[tuple[int, str]] = []
    for name in os.listdir(img_dir):
        m = re.match(r"^card_(\d+)\.png$", name, re.I)
        if m:
            card_names.append((int(m.group(1)), name))
    card_names.sort(key=lambda x: x[0])
    for _, name in card_names:
        p = os.path.join(img_dir, name)
        if os.path.isfile(p):
            out.append(os.path.abspath(p))
    return out


def mdtp_from_env() -> int:
    """由 md-to-platform 经环境变量驱动（与 stub.js 约定一致，并需 pip install xhs）。"""
    img_dir = (os.environ.get("MDT_XHS_IMAGES_DIR") or "").strip()
    pub_path = (os.environ.get("MDT_PUBLISH_XHS") or "").strip()
    if not img_dir or not os.path.isdir(img_dir):
        print("❌ 缺少或无效 MDT_XHS_IMAGES_DIR")
        return 1
    if not pub_path or not os.path.isfile(pub_path):
        print("❌ 缺少 MDT_PUBLISH_XHS 或文件不存在；请生成 publish_xhs.md 后再发")
        return 1
    dry = os.environ.get("MDT_DRY_RUN", "").strip() == "1"
    is_private = os.environ.get("MDT_XHS_AS_PRIVATE", "1").strip() != "0"
    try:
        with open(pub_path, "r", encoding="utf-8") as f:
            pub_text = f.read()
    except OSError as e:
        print(f"❌ 无法读取 MDT_PUBLISH_XHS: {e}")
        return 1
    title, desc = parse_publish_xhs_mdtp(pub_text)
    image_paths = list_mdtp_image_paths(img_dir)
    if not image_paths:
        print("❌ 目录中无 cover.png 或 card_*.png")
        return 1
    cookie = load_cookie()
    validate_cookie(cookie)
    valid = validate_images(image_paths)
    if dry:
        print("\n🔍 MDT dry-run，不实际发布")
        print(f"  📌 标题: {title}")
        print(f"  📝 描述: {desc[:200]}…" if len(desc) > 200 else f"  📝 描述: {desc}")
        print(f"  🖼️ 图片: {len(valid)} 张")
        for v in valid:
            print(f"     - {v}")
        print(f"  🔒 仅自己可见: {is_private}")
        print("\n✅ 校验通过")
        return 0
    pub = LocalPublisher(cookie)
    pub.init_client()
    pub.get_user_info()
    try:
        pub.publish(title=title, desc=desc, images=valid, is_private=is_private, post_time=None)
    except Exception:
        # publish() 已打印 ❌ 与排查说明；此处仅在需排障时输出完整堆栈，避免 Obsidian 通知被长 Traceback 淹没
        if os.environ.get("MDT_DEBUG", "").strip() == "1":
            import traceback
            print("\n[mdtp] 完整堆栈（MDT_DEBUG=1）:", file=sys.stderr)
            traceback.print_exc()
        return 1
    return 0


class LocalPublisher:
    """本地发布模式：直接使用 xhs 库"""
    
    def __init__(self, cookie: str):
        self.cookie = cookie
        self.client = None
        
    def init_client(self):
        """初始化 xhs 客户端"""
        try:
            from xhs import XhsClient
            from xhs.help import sign as local_sign
        except ImportError:
            exe = sys.executable
            pp = os.environ.get("PYTHONPATH", "")
            print("错误: 当前 Python 未加载到 xhs 库。")
            print(f"  sys.executable = {exe}")
            if pp:
                print(f"  PYTHONPATH = {pp[:500]}{'…' if len(pp) > 500 else ''}")
            print("若 pip 报 externally-managed-environment：bash scripts/bootstrap_xhs_venv.sh 后把解释器指到 scripts/xhs_venv/bin/python3。")
            print("或将依赖打进插件目录: npm run bundle:xhs-embed（会生成 scripts/xhs_bundles/<本机平台>，需本机有可用 pip 的解释器，见该目录 README）。")
            sys.exit(1)
        
        # 解析 a1 值
        cookies = parse_cookie(self.cookie)
        cookie_a1 = cookies.get("a1", "")

        def sign_func(
            uri,
            data=None,
            a1: str = "",
            a1_param: str = "",
            web_session: str = "",
            **kwargs: Any,
        ):
            # xhs 较新版本对 sign 的调用为 keyword a1=…；旧示例曾用 a1_param
            a1_to_use = (a1 or a1_param or cookie_a1) or ""
            return local_sign(uri, data, a1=a1_to_use)
        
        self.client = XhsClient(cookie=self.cookie, sign=sign_func)
        
    def get_user_info(self) -> Optional[Dict[str, Any]]:
        """获取当前登录用户信息"""
        try:
            info = self.client.get_self_info()
            print(f"👤 当前用户: {info.get('nickname', '未知')}")
            return info
        except Exception as e:
            print(f"⚠️ 无法获取用户信息: {e}")
            return None
    
    def publish(self, title: str, desc: str, images: List[str], 
                is_private: bool = True, post_time: str = None) -> Dict[str, Any]:
        """发布图文笔记"""
        print(f"\n🚀 准备发布笔记（本地模式）...")
        print(f"  📌 标题: {title}")
        print(f"  📝 描述: {desc[:50]}..." if len(desc) > 50 else f"  📝 描述: {desc}")
        print(f"  🖼️ 图片数量: {len(images)}")
        
        try:
            result = self.client.create_image_note(
                title=title,
                desc=desc,
                files=images,
                is_private=is_private,
                post_time=post_time
            )
            
            print("\n✨ 笔记发布成功！")
            if isinstance(result, dict):
                note_id = result.get('note_id') or result.get('id')
                if note_id:
                    print(f"  📎 笔记ID: {note_id}")
                    print(f"  🔗 链接: https://www.xiaohongshu.com/explore/{note_id}")
            
            return result
            
        except Exception as e:
            error_msg = str(e)
            print(f"\n❌ 发布失败: {error_msg}")
            _print_xhs_troubleshoot_hints(e)
            raise


class ApiPublisher:
    """API 发布模式：通过 xhs-api 服务发布"""
    
    def __init__(self, cookie: str, api_url: str = None):
        self.cookie = cookie
        self.api_url = api_url or get_api_url()
        self.session_id = 'md2redbook_session'
        
    def init_client(self):
        """初始化 API 客户端"""
        try:
            import requests
        except ImportError:
            print("❌ API 模式需要: pip install requests")
            sys.exit(1)
        self._requests = requests  # type: ignore
        print(f"📡 连接 API 服务: {self.api_url}")

        # 健康检查
        try:
            resp = self._requests.get(f"{self.api_url}/health", timeout=5)
            if resp.status_code != 200:
                raise Exception("API 服务不可用")
        except self._requests.exceptions.RequestException as e:
            print(f"❌ 无法连接到 API 服务: {e}")
            print(f"\n💡 请确保 xhs-api 服务已启动：")
            print(f"   cd xhs-api && python app_full.py")
            sys.exit(1)
        
        # 初始化 session
        try:
            resp = self._requests.post(
                f"{self.api_url}/init",
                json={
                    "session_id": self.session_id,
                    "cookie": self.cookie
                },
                timeout=30
            )
            result = resp.json()
            
            if resp.status_code == 200 and result.get('status') == 'success':
                print(f"✅ API 初始化成功")
                user_info = result.get('user_info', {})
                if user_info:
                    print(f"👤 当前用户: {user_info.get('nickname', '未知')}")
            elif result.get('status') == 'warning':
                print(f"⚠️ {result.get('message')}")
            else:
                raise Exception(result.get('error', '初始化失败'))
                
        except Exception as e:
            print(f"❌ API 初始化失败: {e}")
            sys.exit(1)
    
    def get_user_info(self) -> Optional[Dict[str, Any]]:
        """获取当前登录用户信息"""
        try:
            resp = self._requests.post(
                f"{self.api_url}/user/info",
                json={"session_id": self.session_id},
                timeout=10
            )
            if resp.status_code == 200:
                result = resp.json()
                if result.get('status') == 'success':
                    info = result.get('user_info', {})
                    print(f"👤 当前用户: {info.get('nickname', '未知')}")
                    return info
            return None
        except Exception as e:
            print(f"⚠️ 无法获取用户信息: {e}")
            return None
    
    def publish(self, title: str, desc: str, images: List[str], 
                is_private: bool = True, post_time: str = None) -> Dict[str, Any]:
        """发布图文笔记"""
        print(f"\n🚀 准备发布笔记（API 模式）...")
        print(f"  📌 标题: {title}")
        print(f"  📝 描述: {desc[:50]}..." if len(desc) > 50 else f"  📝 描述: {desc}")
        print(f"  🖼️ 图片数量: {len(images)}")
        
        try:
            payload = {
                "session_id": self.session_id,
                "title": title,
                "desc": desc,
                "files": images,
                "is_private": is_private
            }
            if post_time:
                payload["post_time"] = post_time
            
            resp = self._requests.post(
                f"{self.api_url}/publish/image",
                json=payload,
                timeout=120
            )
            result = resp.json()
            
            if resp.status_code == 200 and result.get('status') == 'success':
                print("\n✨ 笔记发布成功！")
                publish_result = result.get('result', {})
                if isinstance(publish_result, dict):
                    note_id = publish_result.get('note_id') or publish_result.get('id')
                    if note_id:
                        print(f"  📎 笔记ID: {note_id}")
                        print(f"  🔗 链接: https://www.xiaohongshu.com/explore/{note_id}")
                return publish_result
            else:
                raise Exception(result.get('error', '发布失败'))
                
        except Exception as e:
            error_msg = str(e)
            print(f"\n❌ 发布失败: {error_msg}")
            raise


def main():
    parser = argparse.ArgumentParser(
        description='将图片发布为小红书笔记',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  # 基本用法（默认仅自己可见）
  python publish_xhs.py -t "我的标题" -d "正文内容" -i cover.png card_1.png card_2.png
  
  # 公开发布
  python publish_xhs.py -t "我的标题" -d "正文内容" -i *.png --public
  
  # 使用 API 模式
  python publish_xhs.py -t "我的标题" -d "正文内容" -i *.png --api-mode
  
  # 定时发布
  python publish_xhs.py -t "我的标题" -d "正文内容" -i *.png --post-time "2024-12-01 10:00:00"
'''
    )
    parser.add_argument(
        '--title', '-t',
        required=True,
        help='笔记标题（不超过20字）'
    )
    parser.add_argument(
        '--desc', '-d',
        default='',
        help='笔记描述/正文内容'
    )
    parser.add_argument(
        '--images', '-i',
        nargs='+',
        required=True,
        help='图片文件路径（可以多个）'
    )
    parser.add_argument(
        '--public',
        action='store_true',
        help='公开发布（默认为仅自己可见）'
    )
    parser.add_argument(
        '--post-time',
        default=None,
        help='定时发布时间（格式：2024-01-01 12:00:00）'
    )
    parser.add_argument(
        '--api-mode',
        action='store_true',
        help='使用 API 模式发布（需要 xhs-api 服务运行）'
    )
    parser.add_argument(
        '--api-url',
        default=None,
        help='API 服务地址（默认: http://localhost:5005）'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='仅验证，不实际发布'
    )
    
    args = parser.parse_args()
    
    # 验证标题长度
    if len(args.title) > 20:
        print(f"⚠️ 警告: 标题超过20字，将被截断")
        args.title = args.title[:20]
    
    # 加载 Cookie
    cookie = load_cookie()
    
    # 验证 Cookie 格式
    validate_cookie(cookie)
    
    # 验证图片
    valid_images = validate_images(args.images)
    
    if args.dry_run:
        print("\n🔍 验证模式 - 不会实际发布")
        print(f"  📌 标题: {args.title}")
        print(f"  📝 描述: {args.desc}")
        print(f"  🖼️ 图片: {valid_images}")
        print(f"  🔒 私密: {not args.public}")
        print(f"  ⏰ 定时: {args.post_time or '立即发布'}")
        print(f"  📡 模式: {'API' if args.api_mode else '本地'}")
        print("\n✅ 验证通过，可以发布")
        return
    
    # 选择发布方式
    if args.api_mode:
        publisher = ApiPublisher(cookie, args.api_url)
    else:
        publisher = LocalPublisher(cookie)
    
    # 初始化客户端
    publisher.init_client()
    
    # 发布笔记
    try:
        publisher.publish(
            title=args.title,
            desc=args.desc,
            images=valid_images,
            is_private=not args.public,
            post_time=args.post_time
        )
    except Exception as e:
        sys.exit(1)


if __name__ == "__main__":
    # 仅一个脚本路径参数且无 CLI 子命令时，若存在 MDT 环境则走 Obsidian 集成
    if os.environ.get("MDT_XHS_IMAGES_DIR", "").strip() and len(sys.argv) == 1:
        raise SystemExit(mdtp_from_env())
    main()
