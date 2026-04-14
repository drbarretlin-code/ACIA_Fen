import { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import PQueue from 'p-queue';

let db: admin.firestore.Firestore | null = null;
try {
  if (admin.apps.length === 0) {
    admin.initializeApp();
    db = admin.firestore();
  } else {
    db = admin.firestore();
  }
} catch (e) {
  console.error('Firebase Admin initialization error:', e);
}

const getApiKey = () => {
  return process.env.GEMINI_API_KEY || process.env.MY_GEMINI_API_KEY || '';
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });
const queue = new PQueue({ concurrency: 1, interval: 2000, intervalCap: 1 });

async function generateWithRetry(prompt: string, schema: Schema, retries = 3): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Gemini API Key is missing.');
  
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await queue.add(() => ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.2
        }
      }));
      return res;
    } catch (err: any) {
      lastError = err;
      const isQuotaError = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED');
      if (isQuotaError && i < retries - 1) {
        const waitTime = Math.pow(2, i) * 10000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function runSubscriptionSearch(sub: any) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { success: false, error: 'SMTP credentials missing' };
  }

  try {
    const actualField = sub.field.toLowerCase() === 'all' ? '全領域 (All Academic Fields)' : sub.field;
    
    const expandPrompt = `Role: 國際學術會議情報鑑識系統\nTask: 針對「${actualField}」領域，推導出 3 到 5 個具體的子領域標籤。\nOutput: 純 JSON 陣列格式，例如 ["領域一", "領域二"]。`;
    const expandSchema: Schema = { type: Type.ARRAY, items: { type: Type.STRING } };
    const expandRes = await generateWithRetry(expandPrompt, expandSchema);
    if (!expandRes) throw new Error("No response for expansion");
    
    let expandedFields: string[] = [];
    try {
      expandedFields = JSON.parse(expandRes.text!);
    } catch (e) {
      const match = expandRes.text!.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) expandedFields = JSON.parse(match[1]);
    }

    const allResults: any[] = [];
    const searchPromises = expandedFields.map(async (subField) => {
      const isChinaSelected = sub.locations.some((loc: string) => loc.includes('中國') || loc.includes('China'));
      const searchPrompt = `Role: 國際學術會議情報鑑識系統\nParameters: 領域: ${subField}, 時間: ${sub.startDate} ~ ${sub.endDate}, 地點: ${sub.locations.join(', ')}\n${isChinaSelected ? '請強制檢索中國重點大學官網' : ''}\n提取確切深層網址，回傳 JSON 陣列。`;
      
      const searchSchema: Schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            theme: { type: Type.STRING }, topics: { type: Type.STRING },
            date: { type: Type.STRING }, location: { type: Type.STRING },
            deadline: { type: Type.STRING }, presentationType: { type: Type.STRING },
            predatoryAnalysis: { type: Type.STRING }, url: { type: Type.STRING },
            originalTextQuote: { type: Type.STRING }
          },
          required: ["theme", "topics", "date", "location", "deadline", "presentationType", "predatoryAnalysis", "url", "originalTextQuote"]
        }
      };

      try {
        const res = await generateWithRetry(searchPrompt, searchSchema);
        let data: any = [];
        try {
          data = JSON.parse(res.text!);
        } catch (e) {
          const match = res.text!.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (match) data = JSON.parse(match[1]);
        }
        allResults.push(...(Array.isArray(data) ? data : (data.conferences || [])));
      } catch (e) {
        console.error(`Search failed for ${subField}`, e);
      }
    });

    await Promise.allSettled(searchPromises);
    const uniqueResults = Array.from(new Map(allResults.map(item => [item.theme, item])).values());
    
    const verifiedResults: any[] = [];
    await Promise.all(uniqueResults.map(async (conf: any) => {
      try {
        const response = await fetch(conf.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        if (response.ok || response.status === 405) verifiedResults.push(conf);
        else {
          const getRes = await fetch(conf.url, { method: 'GET', signal: AbortSignal.timeout(5000) });
          if (getRes.ok) verifiedResults.push(conf);
        }
      } catch (e) {
         // Do nothing
      }
    }));

    if (verifiedResults.length > 0) {
      let html = `<h2>${sub.name} - 最新會議情報</h2><p>為您找到 ${verifiedResults.length} 筆：</p><ul>`;
      verifiedResults.forEach((conf: any) => {
        html += `<li><strong>${conf.theme}</strong><br/>網址: <a href="${conf.url}">${conf.url}</a></li><br/>`;
      });
      html += `</ul>`;

      await transporter.sendMail({
        from: `"ACIA 系統" <${process.env.SMTP_USER}>`,
        to: sub.emails.join(','),
        subject: `[ACIA] 自動搜尋報告: ${sub.name}`,
        html
      });
      return { success: true, resultsCount: verifiedResults.length };
    }
    return { success: true, resultsCount: 0 };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subId, subData } = req.body;
    let sub = subData;
    
    if (!sub && db) {
      const doc = await db.collection('subscriptions').doc(subId).get();
      if (doc.exists) sub = doc.data();
    }
    
    if (!sub) return res.status(404).json({ error: 'Subscription data not found' });
    
    const result = await runSubscriptionSearch(sub);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
