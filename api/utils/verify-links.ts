import { VercelRequest, VercelResponse } from '@vercel/node';

// HTTP 狀態碼可達判斷邏輯：
// - 2xx：正常可達
// - 3xx：重定向，伺服器存在
// - 401/403/405/429：伺服器存在但限制訪問（常見於學術機構防爬蟲），視為可達
// - 5xx / network error：視為不可達
function isReachable(status: number): boolean {
  if (status >= 200 && status < 400) return true;
  if ([401, 403, 405, 429].includes(status)) return true;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'Invalid urls array' });
    }

    const results: Record<string, boolean> = {};
    
    await Promise.all(urls.map(async (url: string) => {
      try {
        // HEAD 請求：timeout 10 秒（學術機構伺服器較慢）
        const headRes = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AcademiaBot/1.0)' }
        });
        results[url] = isReachable(headRes.status);
      } catch (e) {
        try {
          // HEAD 失敗時 fallback 到 GET
          const getRes = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(10000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AcademiaBot/1.0)' }
          });
          results[url] = isReachable(getRes.status);
        } catch (e2) {
          results[url] = false;
        }
      }
    }));
    
    return res.status(200).json(results);
  } catch (error: any) {
    console.error('Verify links error:', error);
    return res.status(500).json({ error: error.message });
  }
}
