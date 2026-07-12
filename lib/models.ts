import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Default provider instance using the server's API key (embeddings, fallbacks)
const defaultGoogleProvider = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export const google = (modelId: string, customApiKey?: string) => {
  if (!customApiKey) return defaultGoogleProvider(modelId);
  const client = createGoogleGenerativeAI({ apiKey: customApiKey });
  return client(modelId);
};

export const googleEmbeddingModel = (modelId: string) =>
  defaultGoogleProvider.embeddingModel(modelId);

export const googleModel = google("gemini-2.5-flash");

export const openRouterModel = (modelId: string, customApiKey?: string) => {
  const client = createOpenRouter({
    apiKey: customApiKey || process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY,
  });
  return client(modelId);
};
