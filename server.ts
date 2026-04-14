import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import PQueue from 'p-queue';

dotenv.config();

// Initialize Firebase Admin
let db: admin.firestore.Firestore | null = null;
try {
  if (admin.apps.length === 0) {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      admin.initializeApp({
        projectId: firebaseConfig.projectId,
        credential: admin.credential.applicationDefault()
      });
      // Correct way to get Firestore instance in Firebase Admin SDK
      db = admin.firestore();
      // If a specific database ID is provided, we might need to handle it differently 
      // but usually admin.firestore() is the standard entry point.
      console.log(`Firebase Admin initialized for project: ${firebaseConfig.projectId}`);
    } else {
      admin.initializeApp();
      db = admin.firestore();
    }
  } else {
    db = admin.firestore();
  }
} catch (e) {
  console.error('Firebase Admin initialization error:', e);
}

const getApiKey = () => {
  const key = process.env.GEMINI_API_KEY || process.env.MY_GEMINI_API_KEY;
  if (!key || key === 'your_gemini_api_key' || key.includes('TODO')) {
    console.warn('Warning: No valid Gemini API key found in environment variables.');
    return '';
  }
  console.log('Gemini API key is configured.');
  return key;
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

// Initialize Request Queue (limit to 1 concurrent request and add delay to stay within quota for free tier)
const queue = new PQueue({ concurrency: 1, interval: 2000, intervalCap: 1 });

async function generateWithRetry(prompt: string, schema: Schema, retries = 3): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Gemini API Key is missing. Please set GEMINI_API_KEY in Settings -> Secrets.');
  }
  
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
        const waitTime = Math.pow(2, i) * 10000; // 10s, 20s, 40s
        console.warn(`[Gemini] Quota exceeded. Retrying in ${waitTime/1000}s... (Attempt ${i+1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Setup Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify transporter on startup
transporter.verify((error, success) => {
  if (error) {
    console.warn('SMTP Transporter verification failed. Email notifications may not work.');
    if (error.message.includes('535') || error.message.includes('534')) {
      console.error('CRITICAL: Gmail login failed. This is usually due to incorrect credentials or missing "App Password".');
      console.error('Action Required: 1. Enable 2FA on your Google account. 2. Generate an "App Password" at https://myaccount.google.com/apppasswords. 3. Set it as SMTP_PASS in Settings -> Secrets.');
    } else {
      console.error('SMTP Error Details:', error.message);
    }
  } else {
    console.log('SMTP Transporter is ready to send emails');
  }
});

async function runSubscriptionSearch(sub: any) {
  console.log(`[Subscription] Starting search for: ${sub.name} (${sub.emails.join(',')})`);
  
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(`[Subscription] SMTP credentials missing. Cannot send email for ${sub.name}`);
    return { success: false, error: 'SMTP credentials missing' };
  }

  try {
    const actualField = sub.field.toLowerCase() === 'all' ? '全領域 (All Academic Fields)' : sub.field;
    
    // Phase 1: Expand Fields
    console.log(`[Subscription] Expanding fields for: ${actualField}`);
    const expandPrompt = `
      Role: 國際學術會議情報鑑識系統
      Task: 針對「${actualField}」領域，推導出 3 到 5 個具體的子領域標籤。
      Output: 純 JSON 陣列格式，例如 ["領域一", "領域二"]。
    `;

    const expandSchema: Schema = {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "擴展搜尋的領域文字標籤 (3-5個)"
    };

    const expandRes = await generateWithRetry(expandPrompt, expandSchema);

    if (!expandRes) throw new Error("No response from Gemini for expansion");
    const expandText = expandRes.text;
    if (!expandText) throw new Error("No response text from Gemini for expansion");
    
    let expandedFields: string[] = [];
    try {
      expandedFields = JSON.parse(expandText);
    } catch (e) {
      const match = expandText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) expandedFields = JSON.parse(match[1]);
      else throw new Error('擴展領域解析失敗');
    }

    console.log(`[Subscription] Expanded fields: ${expandedFields.join(', ')}`);

    // Phase 2: Parallel Search
    const allResults: any[] = [];
    const searchPromises = expandedFields.map(async (subField) => {
      const isChinaSelected = sub.locations.some((loc: string) => loc.includes('中國') || loc.includes('China'));
      const searchPrompt = `
        Role: 國際學術會議情報鑑識系統
        Objective: 檢索全球會議資訊，並執行掠奪性期刊鑑識。
        Language: 繁體中文
        
        Parameters:
        - 領域: ${subField} (屬於 ${actualField})
        - 時間: ${sub.startDate} ~ ${sub.endDate}
        - 地點: ${sub.locations.join(', ')}

        Instructions:
        1. 嚴格遵守「逆向三步驟」驗證規則：
           - 第一步（識別）：確認會議名稱、主辦單位及舉辦細節。
           - 第二步（定位）：尋找該會議的「官方網站」深層網址，優先選擇 .edu, .org 或學術學會網域。
           - 第三步（驗證）：確保所提供的網址目前可公開訪問，且內容確實包含該會議的徵稿資訊。
        2. 廣泛檢索各大學、研究機構、學會及期刊組織 (如 SSCI, SCI, EI) 的官方訊息。
        ${isChinaSelected ? `特別指示：請強制檢索中國重點大學官網 (site:tsinghua.edu.cn, pku.edu.cn, zju.edu.cn, sjtu.edu.cn, fudan.edu.cn, nju.edu.cn, ustc.edu.cn 等)。` : ''}
        3. 提取確切深層網址，摘錄網頁原文字句以支持論點。
        4. 交叉比對主辦方與收費模式，進行「掠奪性期刊」研判。
        5. 必須回傳 JSON 陣列。
      `;

      const searchSchema: Schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            theme: { type: Type.STRING, description: "會議主題" },
            topics: { type: Type.STRING, description: "徵稿範圍（或主題）" },
            date: { type: Type.STRING, description: "舉辦時間" },
            location: { type: Type.STRING, description: "地點" },
            deadline: { type: Type.STRING, description: "投稿截止日" },
            presentationType: { type: Type.STRING, description: "發佈形態" },
            predatoryAnalysis: { type: Type.STRING, description: "掠奪性期刊分析" },
            url: { type: Type.STRING, description: "會議連結網址" },
            originalTextQuote: { type: Type.STRING, description: "支持論點的網頁原文字句" }
          },
          required: ["theme", "topics", "date", "location", "deadline", "presentationType", "predatoryAnalysis", "url", "originalTextQuote"]
        }
      };

      try {
        const res = await generateWithRetry(searchPrompt, searchSchema);

        if (!res) return;
        const text = res.text;
        if (!text) return;

        let data: any = [];
        try {
          data = JSON.parse(text);
        } catch (e) {
          const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (match) data = JSON.parse(match[1]);
        }
        
        const validData = Array.isArray(data) ? data : (data.conferences || []);
        allResults.push(...validData);
      } catch (err) {
        console.error(`[Subscription] Search failed for ${subField}:`, err);
      }
    });

    await Promise.allSettled(searchPromises);

    // Deduplicate results
    const uniqueResults = Array.from(new Map(allResults.map(item => [item.theme, item])).values());
    
    // Phase 3: Link Verification
    console.log(`[Subscription] Verifying ${uniqueResults.length} links...`);
    const verifiedResults: any[] = [];
    await Promise.all(uniqueResults.map(async (conf: any) => {
      try {
        const response = await fetch(conf.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        if (response.ok || response.status === 405) {
          verifiedResults.push(conf);
        } else {
          // Try GET if HEAD fails
          const getRes = await fetch(conf.url, { method: 'GET', signal: AbortSignal.timeout(5000) });
          if (getRes.ok) verifiedResults.push(conf);
          else console.warn(`[Subscription] Invalid link filtered: ${conf.url}`);
        }
      } catch (e) {
        console.warn(`[Subscription] Link verification failed for ${conf.url}:`, e);
      }
    }));

    const results = verifiedResults;
    console.log(`[Subscription] Found ${results.length} valid results for ${sub.name}`);

    // Send Email
    if (results.length > 0) {
      let html = `<h2>${sub.name} - 最新會議情報</h2>`;
      if (expandedFields.length > 0) {
        html += `<p><strong>AI 擴展搜尋領域：</strong> ${expandedFields.join(', ')}</p>`;
      }
      html += `<p>為您找到 ${results.length} 筆符合條件且經系統初步驗證網址有效的會議：</p><ul>`;
      results.forEach((conf: any) => {
        html += `<li>
          <strong>${conf.theme}</strong><br/>
          徵稿範圍: ${conf.topics || '未提供'}<br/>
          時間: ${conf.date} | 地點: ${conf.location}<br/>
          截稿: ${conf.deadline} | 形式: ${conf.presentationType}<br/>
          分析: ${conf.predatoryAnalysis}<br/>
          網址: <a href="${conf.url}">${conf.url}</a>
        </li><br/>`;
      });
      html += `</ul>`;

      await transporter.sendMail({
        from: `"ACIA 系統" <${process.env.SMTP_USER}>`,
        to: sub.emails.join(','),
        subject: `[ACIA] 自動搜尋報告: ${sub.name}`,
        html: html
      });
      console.log(`[Subscription] Email sent to ${sub.emails.join(',')} for ${sub.name}`);
      return { success: true, resultsCount: results.length };
    } else {
      console.log(`[Subscription] No results found for ${sub.name}. No email sent.`);
      return { success: true, resultsCount: 0 };
    }

  } catch (error: any) {
    console.error(`[Subscription] Error running subscription ${sub.name}:`, error);
    return { success: false, error: error.message };
  }
}

// Setup Cron Job (Runs every day at 8:00 AM)
cron.schedule('0 8 * * *', async () => {
  console.log('[Cron] Running daily subscription check...');
  if (!db) {
    console.error('[Cron] Firestore not initialized');
    return;
  }

  try {
    const snapshot = await db.collection('subscriptions').where('isActive', '==', true).get();
    const subs = snapshot.docs;
    console.log(`[Cron] Found ${subs.length} active subscriptions`);

    for (const doc of subs) {
      const sub = doc.data();
      // Run sequentially to avoid hitting rate limits too hard
      await runSubscriptionSearch(sub);
      
      // Update lastRun
      await doc.ref.update({ lastRun: admin.firestore.FieldValue.serverTimestamp() });
    }
    console.log('[Cron] Daily subscription check completed');
  } catch (error) {
    console.error('[Cron] Error fetching subscriptions:', error);
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  app.post('/api/utils/verify-links', async (req, res) => {
    console.log('Received request to /api/utils/verify-links');
    const { urls } = req.body;
    const results: Record<string, boolean> = {};
    
    await Promise.all((urls as string[]).map(async (url) => {
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
    
    res.json(results);
  });

  app.post('/api/subscriptions/test', async (req, res) => {
    const { subId, subData } = req.body;
    
    try {
      let sub = subData;
      if (!sub && db) {
        const doc = await db.collection('subscriptions').doc(subId).get();
        if (doc.exists) {
          sub = doc.data();
        }
      }
      
      if (!sub) {
        return res.status(404).json({ error: 'Subscription data not found' });
      }
      
      const result = await runSubscriptionSearch(sub);
      res.json(result);
    } catch (error: any) {
      console.error('[Test API] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
