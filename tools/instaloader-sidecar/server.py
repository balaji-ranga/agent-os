"""Instagram profile research via Instaloader. Optional sessionid cookie (never logged)."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request

app = Flask(__name__)

try:
    import instaloader
except ImportError:  # pragma: no cover
    instaloader = None


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


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "instaloader-sidecar", "instaloader": bool(instaloader)})


@app.post("/profile")
def profile():
    if not instaloader:
        return jsonify({"ok": False, "error": "instaloader not installed", "fallback": True}), 200
    body = request.get_json(silent=True) or {}
    username = str(body.get("username") or "").strip().lstrip("@")
    days = int(body.get("days") or 30)
    limit = int(body.get("limit") or 40)
    sessionid = str(body.get("sessionid") or "").strip()
    days = max(1, min(days, 90))
    limit = max(1, min(limit, 80))
    if not username:
        return jsonify({"ok": False, "error": "username required"}), 400
    since = datetime.now(timezone.utc) - timedelta(days=days)
    loader = _make_loader(sessionid or None)
    if not loader:
        return jsonify({"ok": False, "error": "instaloader not installed", "fallback": True}), 200
    try:
        profile = instaloader.Profile.from_username(loader.context, username)
        posts = []
        for post in profile.get_posts():
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
                "full_name": profile.full_name or "",
                "followers": int(profile.followers or 0),
                "biography": (profile.biography or "")[:500],
                "posts": posts,
                "count": len(posts),
                "used_session": bool(sessionid),
            }
        )
    except Exception as exc:  # noqa: BLE001 — sidecar returns fallback for the Node adapter
        return jsonify({"ok": False, "error": str(exc)[:400], "fallback": True}), 200


if __name__ == "__main__":
    port = int(os.environ.get("INSTALOADER_PORT", "8083"))
    app.run(host="0.0.0.0", port=port)
