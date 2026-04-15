import { VercelRequest, VercelResponse } from '@vercel/node';

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
    
    await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        results[url] = response.ok || response.status === 405;
      } catch (e) {
        try {
           const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
           results[url] = response.ok;
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
