/**
 * Web search for enrichment.
 *
 * We scrape DuckDuckGo's HTML endpoint rather than using an API key —
 * good-enough quality for finding product pages / manual PDFs, no keys to
 * manage in the add-on config. Brave can be added later as an opt-in.
 *
 * Parsing uses Bun's built-in HTMLRewriter so we avoid pulling in a DOM
 * library. DDG's HTML response is stable enough (the lite variant is even
 * more so) but we're defensive about missing/empty elements.
 */

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export async function searchDuckDuckGo(
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      // DDG returns a CAPTCHA page if the UA looks like a bot. A plain
      // browser UA works well enough for scraped use.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`DDG search failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  return parseDuckDuckGoHtml(html).slice(0, limit);
}

/**
 * Extract results from DDG HTML. Each result is a `<div class="result">`
 * containing `<a class="result__a">` (URL + title) and
 * `<a class="result__snippet">` (body text).
 *
 * DDG sometimes wraps URLs with its redirect: `//duckduckgo.com/l/?uddg=…`.
 * We unwrap those so downstream code gets real destinations.
 */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  let current: Partial<SearchResult> = {};

  const flush = (): void => {
    if (current.url && current.title) {
      results.push({
        url: current.url,
        title: current.title,
        snippet: current.snippet ?? "",
      });
    }
    current = {};
  };

  // HTMLRewriter element/text handler types come from Bun globals; use
  // parameter inference to avoid pulling DOM lib types we don't have.
  class TitleHandler {
    textBuf = "";
    element(el: HTMLRewriterTypes.Element): void {
      const href = el.getAttribute("href");
      if (href) current.url = unwrapDdgRedirect(href);
    }
    text(text: HTMLRewriterTypes.Text): void {
      this.textBuf += text.text;
      if (text.lastInTextNode) {
        current.title = this.textBuf.trim();
        this.textBuf = "";
      }
    }
  }
  class SnippetHandler {
    textBuf = "";
    text(text: HTMLRewriterTypes.Text): void {
      this.textBuf += text.text;
      if (text.lastInTextNode) {
        current.snippet = this.textBuf.trim();
        this.textBuf = "";
        flush(); // snippet comes last in each result block
      }
    }
  }

  new HTMLRewriter()
    .on("a.result__a", new TitleHandler())
    .on("a.result__snippet", new SnippetHandler())
    .transform(new Response(html));

  // Flush any trailing result that had no snippet.
  if (current.url && current.title) flush();
  return results;
}

function unwrapDdgRedirect(href: string): string {
  // "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&rut=..."
  // → "https://example.com/"
  if (href.startsWith("//duckduckgo.com/l/") || href.startsWith("/l/")) {
    try {
      const url = new URL(
        href.startsWith("//") ? `https:${href}` : `https://duckduckgo.com${href}`,
      );
      const uddg = url.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    } catch {
      /* fall through */
    }
  }
  return href;
}
