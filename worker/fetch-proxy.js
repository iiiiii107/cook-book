/* A page fetcher, for importing a recipe from a link.

   The browser cannot fetch another site's page — that is the same-origin
   policy, and it is not something to work around casually. This is thirty
   lines on Cloudflare's free tier (100,000 requests a day; you will use tens
   a month) that fetches one page and returns it with CORS headers.

   It is deliberately narrow: only GET, only http(s), only public addresses,
   only from the sites listed below, and only up to 2 MB. An open proxy is a
   thing other people find and use, and this one has your name on it.

   Deploy with:  wrangler deploy
   Then set VITE_FETCH_PROXY to the worker's URL as a repository secret. */

const ALLOWED_ORIGINS = [
  'https://iiiiii107.github.io',
  'http://localhost:5175',
];

const MAX_BYTES = 2 * 1024 * 1024;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin, allowed) });
    }
    if (request.method !== 'GET') {
      return fail(405, 'Only GET.', origin, allowed);
    }
    if (!allowed) {
      return fail(403, 'Not an allowed origin.', origin, allowed);
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return fail(400, 'No url given.', origin, allowed);

    let url;
    try {
      url = new URL(target);
    } catch {
      return fail(400, 'That is not a URL.', origin, allowed);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return fail(400, 'Only http and https.', origin, allowed);
    }
    // Someone else's private network is not this worker's business to reach.
    if (isPrivate(url.hostname)) {
      return fail(400, 'That address is not public.', origin, allowed);
    }

    let upstream;
    try {
      upstream = await fetch(url.toString(), {
        redirect: 'follow',
        headers: {
          // Some recipe sites serve a stub to anything that does not look
          // like a browser; this is a plain identification, not a disguise.
          'User-Agent': 'Mozilla/5.0 (compatible; CookBookImporter/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch {
      return fail(502, 'That page could not be reached.', origin, allowed);
    }

    if (!upstream.ok) {
      return fail(upstream.status, `That page returned ${upstream.status}.`, origin, allowed);
    }

    const type = upstream.headers.get('Content-Type') || '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      return fail(415, 'That link is not a web page.', origin, allowed);
    }

    const body = await upstream.text();
    return new Response(body.slice(0, MAX_BYTES), {
      headers: { ...cors(origin, allowed), 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};

function cors(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function fail(status, message, origin, allowed) {
  return new Response(message, { status, headers: cors(origin, allowed) });
}

/** Loopback, link-local and the private ranges. */
function isPrivate(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (/^(\[|::1|0\.)/.test(host)) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}
