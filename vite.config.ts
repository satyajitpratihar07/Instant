import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

let _geminiKeys: string[] = [];
let localKeyIndex = 0;

async function localSearchWeb(query: string) {
  const results: any[] = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!response.ok) return results;
    const html = await response.text();
    const blocks = html.split('<div class="result results_links');
    for (let i = 1; i < blocks.length && results.length < 6; i++) {
      const block = blocks[i];
      const urlMatch = block.match(/<a class="result__url"[^>]*href="([^"]*)"/);
      let link = urlMatch ? urlMatch[1] : '';
      if (link.includes('uddg=')) {
        const p = link.split('uddg=');
        if (p[1]) link = decodeURIComponent(p[1].split('&')[0]);
      }
      const titleMatch = block.match(/<a class="result__title"[^>]*>([\s\S]*?)<\/a>/);
      let title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim() : '';
      const snipMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      let snippet = snipMatch ? snipMatch[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim() : '';
      if (title && link) results.push({ title, url: link, snippet: snippet || 'No description.' });
    }
  } catch {}
  return results;
}

async function localCallGemini(prompt: string): Promise<string> {
  const keys = _geminiKeys;
  if (keys.length === 0) return 'No Gemini API keys found in .env file.';
  
  const models = ['gemini-2.0-flash', 'gemini-1.5-pro-latest', 'gemini-1.5-flash-latest'];
  let lastError = '';
  
  for (const model of models) {
    let attempts = keys.length;
    while (attempts > 0) {
      const key = keys[localKeyIndex % keys.length];
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = `HTTP ${res.status}: ${errText}`;
          localKeyIndex = (localKeyIndex + 1) % keys.length;
          attempts--;
          continue;
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'No answer.';
      } catch (err: any) {
        lastError = err.message;
        localKeyIndex = (localKeyIndex + 1) % keys.length;
        attempts--;
      }
    }
  }
  return `All local API keys failed. Last error: ${lastError}`;
}

function localApiPlugin(geminiKeys: string[]): Plugin {
  _geminiKeys = geminiKeys;
  return {
    name: 'local-api-routes',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') { res.statusCode = 200; res.end('{}'); return; }
        try {
          let raw = '';
          for await (const chunk of req as any) raw += chunk;
          const { q } = JSON.parse(raw || '{}');
          if (!q) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing 'q' field" })); return; }

          const sources = await localSearchWeb(q);
          const searchCtx = sources.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
          const prompt = searchCtx
            ? `You are an AI Search Assistant in a secure E2E chat app. User asked: "${q}"\n\nWeb search results:\n${searchCtx}\n\nAnswer concisely in 3-5 sentences. Link sources as [Title](URL).`
            : `You are a helpful AI assistant. Answer concisely: "${q}"`;

          const answer = await localCallGemini(prompt);
          res.statusCode = 200;
          res.end(JSON.stringify({ answer, sources }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/search', async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const q = url.searchParams.get('q') || '';
          if (!q) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing 'q'" })); return; }
          const results = await localSearchWeb(q);
          res.statusCode = 200;
          res.end(JSON.stringify({ results }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const geminiKeys = [
    env.GEMINI_API_KEY_1,
    env.GEMINI_API_KEY_2,
    env.GEMINI_API_KEY_3,
    env.GEMINI_API_KEY_4,
    env.GEMINI_API_KEY_5,
  ].filter(Boolean);

  console.log(`[Vite] Loaded ${geminiKeys.length} Gemini API key(s) from .env`);

  return {
    plugins: [react(), tailwindcss(), localApiPlugin(geminiKeys)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
