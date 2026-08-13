"""Self-hosted Instaloader sidecar. Calls instagram.com (429 is Instagram, not this process)."""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request

app = Flask(__name__)

try:
    import instaloader
except ImportError:  # pragma: no cover
    instaloader = None

_IG_HTTP_RE = re.compile(r"\b(429|403|401|409|400)\b")


def _make_loader(sessionid: str | None = None):
    if not instaloader:
        return None
    loader = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        quiet=True,
        max_connection_attempts=1,
    )
    loader.context._session.headers["User-Agent"] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )
    if sessionid:
        loader.context._session.cookies.set(
            "sessionid", sessionid, domain=".instagram.com", path="/"
        )
    return loader


def _classify_ig_error(exc: BaseException) -> dict:
    err = str(exc)[:400]
    m = _IG_HTTP_RE.search(err)
    ig_http = int(m.group(1)) if m else None
    rate_limited = ig_http in (429, 403) or "too many requests" in err.lower()
    return {
        "ok": False,
        "error": err,
        "fallback": True,
        "self_hosted": True,
        "sidecar": "instaloader-sidecar",
        "upstream": "instagram.com",
        "instagram_http": ig_http,
        "rate_limited": rate_limited,
    }


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "instaloader-sidecar",
            "instaloader": bool(instaloader),
            "self_hosted": True,
            "upstream": "instagram.com",
        }
    )


@app.post("/profile")
def profile():
    if not instaloader:
        return jsonify({"ok": False, "error": "instaloader not installed", "fallback": True, "self_hosted": True}), 200
    body = request.get_json(silent=True) or {}
    username = str(body.get("username") or "").strip().lstrip("@")
    days = int(body.get("days") or 30)
    limit = int(body.get("limit") or 40)
    sessionid = str(body.get("sessionid") or "").strip()
    days = max(1, min(days, 90))
    limit = max(1, min(limit, 80))
    if not username:
        return jsonify({"ok": False, "error": "username required", "self_hosted": True}), 400
    since = datetime.now(timezone.utc) - timedelta(days=days)
    loader = _make_loader(sessionid or None)
    if not loader:
        return jsonify({"ok": False, "error": "instaloader not installed", "fallback": True, "self_hosted": True}), 200
    try:
        ig_profile = instaloader.Profile.from_username(loader.context, username)
        posts = []
        for post in ig_profile.get_posts():
            dt = post.date_utc.replace(tzinfo=timezone.utc)
            if dt < since:
                break
            image_url = ""
            try:
                image_url = post.url or ""
            except Exception:  # noqa: BLE001
                image_url = ""
            posts.append(
                {
                    "shortcode": post.shortcode,
                    "url": f"https://www.instagram.com/p/{post.shortcode}/",
                    "caption": (post.caption or "")[:500],
                    "likes": int(post.likes or 0),
                    "comments": int(post.comments or 0),
                    "timestamp": dt.isoformat(),
                    "is_video": bool(post.is_video),
                    "image_url": image_url,
                    "hydrated": True,
                    "adapter": "instaloader",
                }
            )
            if len(posts) >= limit:
                break
        return jsonify(
            {
                "ok": True,
                "adapter": "instaloader",
                "username": username,
                "full_name": ig_profile.full_name or "",
                "followers": int(ig_profile.followers or 0),
                "biography": (ig_profile.biography or "")[:500],
                "posts": posts,
                "count": len(posts),
                "used_session": bool(sessionid),
                "self_hosted": True,
                "upstream": "instagram.com",
            }
        )
    except Exception as exc:  # noqa: BLE001 — sidecar returns fallback for the Node adapter
        payload = _classify_ig_error(exc)
        print(
            "[instaloader-sidecar] instagram.com error http=%s rate_limited=%s username=%s"
            % (payload.get("instagram_http"), payload.get("rate_limited"), username),
            flush=True,
        )
        return jsonify(payload), 200


if __name__ == "__main__":
    port = int(os.environ.get("INSTALOADER_PORT", "8083"))
    from waitress import serve

    print("[instaloader-sidecar] waitress host=0.0.0.0 port=%s (self-hosted; upstream=instagram.com)" % port, flush=True)
    serve(app, host="0.0.0.0", port=port, threads=4)
