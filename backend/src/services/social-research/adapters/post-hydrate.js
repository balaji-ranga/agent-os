/**
 * Hydrate public post URLs into structured posts (text, timestamp, image).
 * Indexed search hits are not posts until hydration succeeds.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export function extractTweetIds(urls = []) {
  const ids = [];
  const seen = new Set();
  for (const raw of urls) {
    const m = String(raw || '').match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d{8,})/i);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function extractInstagramShortcodes(urls = []) {
  const codes = [];
  const seen = new Set();
  for (const raw of urls) {
    const m = String(raw || '').match(
      /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i
    );
    if (!m) continue;
    const code = m[1];
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

export function extractFacebookPostUrls(urls = []) {
  const out = [];
  const seen = new Set();
  for (const raw of urls) {
    const u = String(raw || '').trim();
    if (!/facebook\.com/i.test(u)) continue;
    if (!/\/(posts|videos|reel|photo|watch|permalink\.php|story\.php)\b/i.test(u) && !/[?&]story_fbid=/i.test(u)) {
      continue;
    }
    const key = u.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

export function captionHintFromSearch(title, description) {
  const t = String(title || '').trim();
  const ig = t.match(/on Instagram:\s*[“"']?([\s\S]+)/i);
  if (ig) return ig[1].replace(/[”"']$/, '').trim().slice(0, 500);
  const x = t.match(/on X:\s*([\s\S]+)/i);
  if (x) return x[1].trim().slice(0, 500);
  const d = String(description || '').trim();
  return (d || t).slice(0, 500);
}

export async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let cursor = 0;
  const workers = Math.min(Math.max(Number(limit) || 4, 1), list.length || 1);
  async function worker() {
    while (cursor < list.length) {
      const idx = cursor++;
      out[idx] = await fn(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, list.length) }, () => worker()));
  return out;
}

async function fetchJson(url, timeoutMs = 18000) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data, text };
}

export async function hydrateTweet(tweetId) {
  const id = String(tweetId || '').trim();
  if (!id) return null;
  const urls = [
    `https://api.fxtwitter.com/status/${id}`,
    `https://api.vxtwitter.com/Twitter/status/${id}`,
  ];
  for (const u of urls) {
    try {
      const { ok, data } = await fetchJson(u);
      if (!ok) continue;
      const t = data.tweet || data;
      const text = String(t.text || t.full_text || '').trim();
      if (!text && !t.media && !t.mediaURLs) continue;
      const photos = t.media?.photos || [];
      const videos = t.media?.videos || t.media?.video || [];
      const mediaUrls = Array.isArray(t.mediaURLs) ? t.mediaURLs : [];
      const imageUrl =
        photos[0]?.url ||
        videos[0]?.thumbnail_url ||
        videos[0]?.url ||
        mediaUrls.find((m) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(String(m))) ||
        mediaUrls[0] ||
        '';
      const ts =
        t.created_at ||
        t.date ||
        (t.created_timestamp ? new Date(Number(t.created_timestamp) * 1000).toISOString() : '');
      const handle = t.author?.screen_name || t.user_screen_name || t.user_name || '';
      return {
        id,
        url: t.url || `https://x.com/${handle || 'i'}/status/${id}`,
        text: text.slice(0, 800),
        timestamp: ts || '',
        image_url: imageUrl || '',
        handle: handle || null,
        adapter: 'fxtwitter',
        hydrated: true,
      };
    } catch (e) {
      console.warn('[social-research] tweet hydrate miss id=%s %s', id, e.message || e);
    }
  }
  return null;
}

export async function hydrateInstagramMedia(shortcode, { title = '', description = '' } = {}) {
  const code = String(shortcode || '').trim();
  if (!code) return null;
  const permalink = `https://www.instagram.com/p/${code}/`;
  try {
    const res = await fetch(`https://www.instagram.com/p/${code}/media/?size=l`, {
      headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const loc = String(res.headers.get('location') || '').trim();
    const ctype = String(res.headers.get('content-type') || '');
    let imageUrl = '';
    if (loc && /^https?:\/\//i.test(loc) && /cdninstagram|fbcdn|scontent/i.test(loc)) {
      imageUrl = loc;
    } else if (res.ok && /^image\//i.test(ctype)) {
      imageUrl = `https://www.instagram.com/p/${code}/media/?size=l`;
    }
    if (!imageUrl) return null;
    return {
      shortcode: code,
      url: permalink,
      caption: captionHintFromSearch(title, description),
      timestamp: '',
      image_url: imageUrl,
      is_video: false,
      adapter: 'instagram_media',
      hydrated: true,
      caption_source: title || description ? 'search_hint' : null,
    };
  } catch (e) {
    console.warn('[social-research] instagram media hydrate miss shortcode=%s %s', code, e.message || e);
    return null;
  }
}

export async function hydrateInstagramOembed(shortcode, appToken) {
  const code = String(shortcode || '').trim();
  const token = String(appToken || '').trim();
  if (!code || !token) return null;
  const permalink = `https://www.instagram.com/p/${code}/`;
  try {
    const u = new URL('https://graph.facebook.com/v21.0/instagram_oembed');
    u.searchParams.set('url', permalink);
    u.searchParams.set('access_token', token);
    const { ok, data } = await fetchJson(u.toString());
    if (!ok || data.error) return null;
    return {
      shortcode: code,
      url: permalink,
      caption: String(data.title || '').slice(0, 500),
      timestamp: '',
      image_url: data.thumbnail_url || '',
      author: data.author_name || '',
      adapter: 'instagram_oembed',
      hydrated: true,
      caption_source: 'oembed',
    };
  } catch (e) {
    console.warn('[social-research] instagram oembed miss shortcode=%s %s', code, e.message || e);
    return null;
  }
}

export async function hydrateFacebookOembed(postUrl, appToken) {
  const url = String(postUrl || '').trim();
  const token = String(appToken || '').trim();
  if (!url || !token) return null;
  try {
    const u = new URL('https://graph.facebook.com/v21.0/oembed_post');
    u.searchParams.set('url', url);
    u.searchParams.set('access_token', token);
    const { ok, data } = await fetchJson(u.toString());
    if (!ok || data.error) return null;
    return {
      url,
      message: String(data.title || '').slice(0, 500),
      created_time: '',
      permalink_url: url,
      image_url: data.thumbnail_url || '',
      adapter: 'facebook_oembed',
      hydrated: true,
    };
  } catch (e) {
    console.warn('[social-research] facebook oembed miss %s', e.message || e);
    return null;
  }
}

export async function hydrateTweetsFromUrls(urls, { limit = 8 } = {}) {
  const ids = extractTweetIds(urls).slice(0, Math.min(Math.max(Number(limit) || 8, 1), 12));
  const rows = await mapLimit(ids, 4, (id) => hydrateTweet(id));
  return rows.filter(Boolean);
}

export async function hydrateInstagramFromSearch(results, { appToken = '', limit = 8 } = {}) {
  const list = Array.isArray(results) ? results : [];
  const byCode = new Map();
  for (const r of list) {
    const codes = extractInstagramShortcodes([r.url]);
    if (!codes.length) continue;
    const code = codes[0];
    if (!byCode.has(code)) byCode.set(code, r);
  }
  const entries = [...byCode.entries()].slice(0, Math.min(Math.max(Number(limit) || 8, 1), 12));
  const rows = await mapLimit(entries, 4, async ([code, hit]) => {
    if (appToken) {
      const oembed = await hydrateInstagramOembed(code, appToken);
      if (oembed?.image_url) return oembed;
    }
    return hydrateInstagramMedia(code, { title: hit.title, description: hit.description });
  });
  return rows.filter(Boolean);
}
