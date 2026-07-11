import type { IncomingMessage, ServerResponse } from 'http';

// --- API Key Rotation Pool ---
const GEMINI_KEYS: string[] = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

let currentKeyIndex = 0;

function getNextKey(): string | null {
  if (GEMINI_KEYS.length === 0) return null;
  return GEMINI_KEYS[currentKeyIndex % GEMINI_KEYS.length];
}

function rotateToNextKey(): void {
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_KEYS.length;
}

// --- Web Search via DuckDuckGo (free, no key required) ---
async function searchWeb(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const results: any[] = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) return results;

    const html = await response.text();
    const resultBlocks = html.split('<div class="result results_links');

    for (let i = 1; i < resultBlocks.length && results.length < 6; i++) {
      const block = resultBlocks[i];

      const urlMatch = block.match(/<a class="result__url"[^>]*href="([^"]*)"/);
      let link = urlMatch ? urlMatch[1] : '';
      if (link.includes('uddg=')) {
        const parts = link.split('uddg=');
        if (parts[1]) link = decodeURIComponent(parts[1].split('&')[0]);
      }

      const titleMatch = block.match(/<a class="result__title"[^>]*>([\s\S]*?)<\/a>/);
      let title = titleMatch ? titleMatch[1] : '';
      title = title.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();

      const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      let snippet = snippetMatch ? snippetMatch[1] : '';
      snippet = snippet.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();

      if (title && link) {
        results.push({ title, url: link, snippet: snippet || 'No description available.' });
      }
    }
  } catch (err) {
    console.error('DuckDuckGo search failed:', err);
  }
  return results;
}

// --- Call Gemini with Automatic Skip on Errors and Model Fallback ---
async function callGeminiWithRotation(prompt: string): Promise<string> {
  const totalKeys = GEMINI_KEYS.length;
  if (totalKeys === 0) {
    return 'No Gemini API keys are configured on the server.';
  }

  // Model fallback sequence
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-flash'];
  let lastErrorMsg = '';

  for (const model of models) {
    let attemptsLeft = totalKeys;
    while (attemptsLeft > 0) {
      const key = getNextKey();
      if (!key) break;

      console.log(`[Gemini] Trying model ${model} with key index ${currentKeyIndex % totalKeys}`);

      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
            }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          let parsedErr: any = {};
          try { parsedErr = JSON.parse(errText); } catch {}
          
          const msg = parsedErr.error?.message || `HTTP ${response.status}`;
          console.warn(`[Gemini] Model ${model} with key index ${currentKeyIndex % totalKeys} failed: ${msg}. Rotating key...`);
          
          lastErrorMsg = msg;
          rotateToNextKey();
          attemptsLeft--;
          continue;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('Empty response from Gemini');
        }

        return text.trim();
      } catch (err: any) {
        console.error(`[Gemini] Model ${model} with key index ${currentKeyIndex % totalKeys} error:`, err.message);
        lastErrorMsg = err.message;
        rotateToNextKey();
        attemptsLeft--;
      }
    }
  }

  return `All configured Gemini keys and models failed. Last error: ${lastErrorMsg}`;
}

type VercelLikeReq = IncomingMessage & { query: Record<string, string | string[]> };
type VercelLikeRes = ServerResponse & {
  status: (code: number) => VercelLikeRes;
  json: (data: any) => void;
  setHeader: (key: string, val: string) => void;
  end: () => void;
};

export default async function handler(req: VercelLikeReq, res: VercelLikeRes) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type, Date');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  let body: any = {};
  if (req.method === 'POST') {
    await new Promise<void>((resolve, reject) => {
      let rawData = '';
      req.on('data', (chunk) => { rawData += chunk; });
      req.on('end', () => {
        try { body = JSON.parse(rawData); } catch { body = {}; }
        resolve();
      });
      req.on('error', reject);
    });
  }

  const { q, key: customKey } = body;
  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: "Request body must contain 'q' (string)" });
  }

  try {
    console.log(`[Chat API] Searching web for: "${q}"`);
    const searchResults = await searchWeb(q);

    let searchContext = '';
    if (searchResults.length > 0) {
      searchContext = searchResults
        .map((r, i) => `[Source ${i + 1}] Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
        .join('\n\n');
    }

    const systemPrompt = searchContext
      ? `You are a helpful AI Search Assistant built into a secure E2E chat app called InstantE2E.
The user asked: "${q}"

Here are fresh web search results from DuckDuckGo to help you answer accurately:

${searchContext}

Instructions:
- Answer the user's question directly and accurately using the search results above.
- Be concise — 3 to 6 sentences maximum.
- When you reference a search result, use markdown link format: [Title](URL)
- If search results are not fully relevant, answer from your general knowledge and say so.
- Do NOT add unnecessary disclaimers or filler text. Get to the point.`
      : `You are a helpful AI Search Assistant. The user asked: "${q}". Web search returned no results. Answer from your general knowledge in 3-5 sentences.`;

    // Setup keys array (customKey goes first, then rotation keys)
    const activeKeys = [customKey, ...GEMINI_KEYS].filter(Boolean) as string[];
    
    console.log(`[Chat API] Calling Gemini (Active keys: ${activeKeys.length})`);
    
    // Inline implementation of call with activeKeys parameter
    let finalAnswer = '';
    const models = ['gemini-2.0-flash', 'gemini-1.5-pro-latest', 'gemini-1.5-flash-latest'];
    let lastErrorMsg = '';
    let success = false;

    for (const model of models) {
      if (success) break;
      for (const key of activeKeys) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: systemPrompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            let parsedErr: any = {};
            try { parsedErr = JSON.parse(errText); } catch {}
            lastErrorMsg = parsedErr.error?.message || `HTTP ${response.status}`;
            continue;
          }

          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            finalAnswer = text.trim();
            success = true;
            break;
          }
        } catch (err: any) {
          lastErrorMsg = err.message;
        }
      }
    }

    if (!success) {
      finalAnswer = `All available API keys failed. If you have your own Gemini key, please click the gear icon in the top right of this panel to add it. Error: ${lastErrorMsg}`;
    }

    return res.status(200).json({
      answer: finalAnswer,
      sources: searchResults
    });
  } catch (error: any) {
    console.error('[Chat API] Fatal error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
