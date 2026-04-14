import { GoogleGenAI, Type, Schema } from '@google/genai';
import { VercelRequest, VercelResponse } from '@vercel/node';
import PQueue from 'p-queue';

// Initialize Request Queue
const queue = new PQueue({ concurrency: 2 });

const ai = new GoogleGenAI({ apiKey: process.env.MY_GEMINI_API_KEY! });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Ensure body is parsed
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { prompt, schema } = body;

  console.log('API Request received. Prompt length:', prompt?.length);

  if (!process.env.MY_GEMINI_API_KEY) {
    console.error('MY_GEMINI_API_KEY is missing in Vercel environment');
    return res.status(500).json({ error: 'Gemini API key is not configured' });
  }

  try {
    await queue.add(async () => {
      console.log('Processing request in queue...');
      const config: any = {
        tools: [{ googleSearch: {} }],
        temperature: 0.2
      };
      if (schema) {
        config.responseMimeType = 'application/json';
        config.responseSchema = schema;
      }
      
      const result = await ai.models.generateContentStream({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config
      });
      
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      
      for await (const chunk of result) {
        if (chunk.text) {
          res.write(chunk.text);
        }
      }
      res.end();
      console.log('Request processed successfully.');
    });
  } catch (error: any) {
    console.error('Generate error details:', {
      message: error.message,
      stack: error.stack,
    });
    
    // Handle 429 Quota Exceeded
    if (error.message && error.message.includes('429')) {
      const retryDelayMatch = error.message.match(/retry in (\d+\.?\d*)s/);
      const delay = retryDelayMatch ? parseFloat(retryDelayMatch[1]) * 1000 : 30000;
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      try {
         await queue.add(async () => {
           const config: any = {
             tools: [{ googleSearch: {} }],
             temperature: 0.2
           };
           if (schema) {
             config.responseMimeType = 'application/json';
             config.responseSchema = schema;
           }
           const result = await ai.models.generateContentStream({
            model: 'gemini-3.1-pro-preview',
            contents: prompt,
            config
          });
          for await (const chunk of result) {
            if (chunk.text) {
              res.write(chunk.text);
            }
          }
          res.end();
         });
         return;
      } catch (retryError: any) {
         console.error('Retry failed:', retryError);
      }
    }

    if (!res.writableEnded) {
      res.status(500).json({ error: error.message });
    }
  }
}
