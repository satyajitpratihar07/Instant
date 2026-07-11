import type { IncomingMessage, ServerResponse } from 'http';

export default async function handler(req: IncomingMessage & { query: Record<string, string | string[]> }, res: ServerResponse & { status: (code: number) => any; json: (data: any) => any; setHeader: (key: string, val: string) => any; end: () => any }) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { q } = req.query;
  const query = Array.isArray(q) ? q[0] : q;

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Search index responded with status ${response.status}`);
    }

    const html = await response.text();
    const results: any[] = [];
    const resultBlocks = html.split('<div class="result results_links');
    
    for (let i = 1; i < resultBlocks.length && results.length < 5; i++) {
      const block = resultBlocks[i];
      
      const urlMatch = block.match(/<a class="result__url"[^>]*href="([^"]*)"/);
      let link = urlMatch ? urlMatch[1] : '';
      if (link.includes('uddg=')) {
        const parts = link.split('uddg=');
        if (parts[1]) {
          link = decodeURIComponent(parts[1].split('&')[0]);
        }
      }

      const titleMatch = block.match(/<a class="result__title"[^>]*>([\s\S]*?)<\/a>/);
      let title = titleMatch ? titleMatch[1] : '';
      title = title.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();

      const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      let snippet = snippetMatch ? snippetMatch[1] : '';
      snippet = snippet.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();

      if (title && link) {
        results.push({
          title,
          url: link,
          snippet: snippet || 'No snippet available.'
        });
      }
    }

    return res.status(200).json({ results });
  } catch (error: any) {
    console.error("Search API error:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch search results" });
  }
}
