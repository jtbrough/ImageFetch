const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const dns = require('node:dns').promises;
const net = require('node:net');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '8788', 10);
const RUNTIME_LABEL = process.env.IMAGEFETCH_RUNTIME || 'local';
const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'index.html');
const VERSION_PATH = path.join(ROOT, 'VERSION');
const MAX_HTML_BYTES = Number.parseInt(process.env.MAX_HTML_BYTES || '2097152', 10); // 2 MB
const MAX_ASSET_BYTES = Number.parseInt(process.env.MAX_ASSET_BYTES || '26214400', 10); // 25 MB
const MAX_REQUEST_TARGET_CHARS = Number.parseInt(process.env.MAX_REQUEST_TARGET_CHARS || '4096', 10);

const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', '::1']);
const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function loadAppVersion() {
  try {
    const raw = readFileSync(VERSION_PATH, 'utf8').trim();
    return raw || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const APP_VERSION = loadAppVersion();

function escapeForJsString(input) {
  return String(input)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '')
    .replaceAll('\r', '');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  return false;
}

async function assertSafeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    throw new Error('Blocked host');
  }

  if (net.isIP(host)) {
    if ((net.isIP(host) === 4 && isPrivateIpv4(host)) || (net.isIP(host) === 6 && isPrivateIpv6(host))) {
      throw new Error('Blocked private IP');
    }
    return parsed;
  }

  const answers = await dns.lookup(host, { all: true, verbatim: true });
  if (!answers.length) {
    throw new Error('Could not resolve host');
  }

  for (const answer of answers) {
    if (answer.family === 4 && isPrivateIpv4(answer.address)) {
      throw new Error('Host resolved to private IPv4');
    }
    if (answer.family === 6 && isPrivateIpv6(answer.address)) {
      throw new Error('Host resolved to private IPv6');
    }
  }

  return parsed;
}

function timeoutSignal(ms) {
  return AbortSignal.timeout(Math.max(1000, ms));
}

async function safeFetchWithRedirects(startUrl, options = {}) {
  const timeoutMs = options.timeoutMs || 7000;
  const maxRedirects = options.maxRedirects || 5;
  let current = startUrl;

  for (let i = 0; i <= maxRedirects; i += 1) {
    await assertSafeUrl(current);
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal: timeoutSignal(timeoutMs),
      headers: options.headers || undefined,
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirect without location: HTTP ${res.status}`);
      current = new URL(loc, current).toString();
      continue;
    }

    return { res, finalUrl: current };
  }

  throw new Error('Too many redirects');
}

function parseAttributes(tag) {
  const firstSpace = tag.indexOf(' ');
  if (firstSpace < 0) return {};
  const attrs = {};
  const attrSlice = tag.slice(firstSpace);
  const re = /(\w[\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(attrSlice))) {
    const key = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = value;
  }
  return attrs;
}

async function readResponseBytesWithLimit(res, maxBytes, label) {
  const chunks = [];
  let total = 0;

  for await (const chunk of res.body || []) {
    const part = Buffer.from(chunk);
    total += part.length;
    if (total > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} bytes`);
    }
    chunks.push(part);
  }

  return Buffer.concat(chunks);
}

function parseSrcset(srcset) {
  if (!srcset) return '';
  const list = srcset.split(',').map((v) => v.trim()).filter(Boolean).map((entry) => {
    const parts = entry.split(/\s+/);
    const raw = parts[0];
    const desc = parts[1] || '';
    let score = 0;
    if (desc.endsWith('w')) score = Number.parseInt(desc, 10) || 0;
    if (desc.endsWith('x')) score = (Number.parseFloat(desc) || 0) * 1000;
    return { raw, score };
  }).sort((a, b) => b.score - a.score);
  return list[0] ? list[0].raw : '';
}

function extractBackgroundUrls(style) {
  const out = [];
  if (!style) return out;
  const re = /url\(([^)]+)\)/gi;
  let m;
  while ((m = re.exec(style))) {
    out.push(m[1]);
  }
  return out;
}

function resolveUrl(raw, base) {
  if (!raw) return null;
  const clean = raw.trim().replace(/^url\((.*)\)$/i, '$1').replace(/^['"]|['"]$/g, '');
  try {
    return new URL(clean, base).toString();
  } catch {
    return null;
  }
}

function filenameFromUrl(raw) {
  try {
    const u = new URL(raw);
    const leaf = u.pathname.split('/').filter(Boolean).pop() || 'image';
    return decodeURIComponent(leaf);
  } catch {
    return 'image';
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function likelyImageUrl(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/.test(p);
  } catch {
    return false;
  }
}

function isAllowedAssetType(contentType, url) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type.startsWith('application/octet-stream') && likelyImageUrl(url)) return true;
  return false;
}

function pushUnique(target, seen, group, rawUrl, sourceType, note, base) {
  const url = resolveUrl(rawUrl, base);
  if (!url) return;
  const key = `${group}|${url}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push({
    id: `${group}-${seen.size}`,
    group,
    url,
    sourceType,
    note,
    filename: filenameFromUrl(url),
  });
}

function extractCandidates(html, baseUrl, headerDepth = 3) {
  const favicon = [];
  const appleTouch = [];
  const headerImages = [];
  const seen = new Set();

  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const attrs = parseAttributes(tag);
    const rel = (attrs.rel || '').toLowerCase();
    const href = attrs.href || '';
    if (!href) continue;
    if (rel.includes('apple-touch-icon')) {
      pushUnique(appleTouch, seen, 'apple-touch-icon', href, 'link', rel, baseUrl);
    } else if (rel.includes('icon')) {
      pushUnique(favicon, seen, 'favicon', href, 'link', rel, baseUrl);
    }
  }

  const headerBlocks = html.match(/<header\b[\s\S]*?<\/header>/gi) || [];
  for (const block of headerBlocks) {
    let scannedDepth = 0;
    const tagRe = /<\/?([a-z0-9:-]+)\b[^>]*>/gi;
    let tm;
    while ((tm = tagRe.exec(block))) {
      const full = tm[0];
      const name = (tm[1] || '').toLowerCase();
      const isClose = full.startsWith('</');
      if (!isClose) scannedDepth += 1;
      if (scannedDepth <= headerDepth + 1 && !isClose) {
        const attrs = parseAttributes(full);
        if (name === 'img') {
          pushUnique(headerImages, seen, 'header-images', attrs.src || parseSrcset(attrs.srcset || ''), 'header-img', name, baseUrl);
        }
        if (name === 'source') {
          pushUnique(headerImages, seen, 'header-images', parseSrcset(attrs.srcset || '') || attrs.src, 'header-source', name, baseUrl);
        }
        for (const bg of extractBackgroundUrls(attrs.style || '')) {
          pushUnique(headerImages, seen, 'header-images', bg, 'header-bg', 'inline-style', baseUrl);
        }
      }
      if (isClose) scannedDepth = Math.max(0, scannedDepth - 1);
    }
  }

  const firstImg = (html.match(/<img\b[^>]*>/i) || [])[0];
  if (firstImg) {
    const attrs = parseAttributes(firstImg);
    pushUnique(headerImages, seen, 'header-images', attrs.src || parseSrcset(attrs.srcset || ''), 'hero-fallback', 'first-content-image', baseUrl);
  }

  const heroIndex = headerImages.findIndex((x) => x.sourceType === 'hero-fallback');
  if (heroIndex >= 0) {
    const hero = headerImages.splice(heroIndex, 1)[0];
    headerImages.push(hero);
  }

  return [
    { key: 'favicon', title: 'Favicon', index: 0, items: favicon },
    { key: 'apple-touch-icon', title: 'Apple Touch Icon', index: 0, items: appleTouch },
    { key: 'header-images', title: 'Header Images', index: 0, items: headerImages },
  ];
}

function limitTotalCandidates(groups, maxTotal) {
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (!nonEmpty.length) return groups;

  for (const group of nonEmpty) {
    group.items = group.items.slice(0, Math.max(1, maxTotal));
  }

  let remaining = maxTotal;
  const result = new Map();

  for (const group of nonEmpty) {
    if (remaining <= 0) break;
    result.set(group.key, [group.items[0]]);
    remaining -= 1;
  }

  if (remaining > 0) {
    const pool = [];
    for (const group of nonEmpty) {
      for (let i = 1; i < group.items.length; i += 1) {
        pool.push({ groupKey: group.key, item: group.items[i] });
      }
    }

    for (const entry of pool) {
      if (remaining <= 0) break;
      const list = result.get(entry.groupKey) || [];
      list.push(entry.item);
      result.set(entry.groupKey, list);
      remaining -= 1;
    }
  }

  for (const group of groups) {
    group.items = result.get(group.key) || [];
    group.index = 0;
  }

  return groups;
}

async function handleExtract(req, res, reqUrl) {
  const input = reqUrl.searchParams.get('url') || '';
  const timeoutMs = clampInt(reqUrl.searchParams.get('timeoutMs') || '6500', 6500, 1000, 30000);
  const maxImages = clampInt(reqUrl.searchParams.get('maxImages') || '6', 6, 1, 30);
  const headerDepth = clampInt(reqUrl.searchParams.get('headerDepth') || '3', 3, 1, 8);

  if (!input) return sendJson(res, 400, { error: 'Missing url query parameter' });

  try {
    const { res: upstream, finalUrl } = await safeFetchWithRedirects(input, {
      timeoutMs,
      maxRedirects: 5,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });

    if (!upstream.ok) {
      return sendJson(res, 502, { error: `Upstream HTML fetch failed with HTTP ${upstream.status}` });
    }

    const htmlBytes = await readResponseBytesWithLimit(upstream, MAX_HTML_BYTES, 'HTML response');
    const html = htmlBytes.toString('utf8');
    let groups = extractCandidates(html, finalUrl, headerDepth);
    groups = limitTotalCandidates(groups, maxImages);

    return sendJson(res, 200, {
      finalUrl,
      groups,
    });
  } catch (err) {
    return sendJson(res, 400, { error: String(err.message || err) });
  }
}

async function handleAsset(req, res, reqUrl) {
  const input = reqUrl.searchParams.get('url') || '';
  const timeoutMs = clampInt(reqUrl.searchParams.get('timeoutMs') || '6500', 6500, 1000, 30000);
  if (!input) return sendJson(res, 400, { error: 'Missing url query parameter' });

  try {
    const { res: upstream } = await safeFetchWithRedirects(input, {
      timeoutMs,
      maxRedirects: 5,
    });

    if (!upstream.ok) {
      return sendJson(res, 502, { error: `Upstream asset fetch failed with HTTP ${upstream.status}` });
    }

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!isAllowedAssetType(ct, input)) {
      return sendJson(res, 415, { error: `Unsupported asset content-type: ${ct}` });
    }
    const buf = await readResponseBytesWithLimit(upstream, MAX_ASSET_BYTES, 'Asset response');
    res.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': ct,
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch (err) {
    return sendJson(res, 400, { error: String(err.message || err) });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  if ((req.url || '').length > MAX_REQUEST_TARGET_CHARS) {
    return sendJson(res, 414, { error: 'Request target too long' });
  }

  let reqUrl;
  try {
    reqUrl = new URL(req.url || '/', 'http://localhost');
  } catch {
    return sendJson(res, 400, { error: 'Invalid request URL' });
  }

  if (reqUrl.pathname === '/api/extract') {
    return handleExtract(req, res, reqUrl);
  }

  if (reqUrl.pathname === '/api/asset') {
    return handleAsset(req, res, reqUrl);
  }

  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    try {
      const html = await readFile(INDEX_PATH, 'utf8');
      const rendered = html
        .replaceAll('__IMAGEFETCH_RUNTIME_VALUE__', escapeForJsString(RUNTIME_LABEL))
        .replaceAll('__IMAGEFETCH_VERSION_VALUE__', escapeForJsString(APP_VERSION));
      res.writeHead(200, {
        ...COMMON_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(rendered),
      });
      res.end(rendered);
    } catch (err) {
      sendText(res, 500, String(err.message || err));
    }
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, HOST, () => {
  console.log(`ImageFetch server running at http://${HOST}:${PORT}`);
});
