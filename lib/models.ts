import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export const googleModel = google("gemini-2.5-flash");

export const openRouterModel = createOpenRouter({
  apiKey: process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY,
});
