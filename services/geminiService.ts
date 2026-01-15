
import { GoogleGenAI, Type } from "@google/genai";
import { XPost, AuditResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function auditPosts(posts: XPost[]): Promise<Map<string, AuditResult>> {
  const results = new Map<string, AuditResult>();
  
  if (posts.length === 0) return results;

  // We audit a sample or process in batches. For demo, we take the first 50.
  const sample = posts.slice(0, 50);

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze these X (Twitter) posts (tweets, replies, or reposts) for potential controversy, sensitive content, or brand risk. 
    Return a list of audit results, each including the post id.
    
    Posts to analyze:
    ${JSON.stringify(sample.map(r => ({ id: r.id, text: r.full_text, type: r.type })))}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING, description: "The post ID" },
            reason: { type: Type.STRING, description: "Reason for the audit result" },
            riskLevel: { type: Type.STRING, description: "Risk level of the content" },
            sentiment: { type: Type.STRING, description: "Sentiment analysis" }
          },
          propertyOrdering: ["id", "reason", "riskLevel", "sentiment"]
        }
      }
    }
  });

  try {
    const text = response.text.trim();
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      data.forEach((audit: any) => {
        if (audit.id) {
          results.set(audit.id, {
            reason: audit.reason || 'N/A',
            riskLevel: audit.riskLevel || 'Low',
            sentiment: audit.sentiment || 'Neutral'
          });
        }
      });
    }
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
  }

  return results;
}
