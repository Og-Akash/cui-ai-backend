import { embed } from "ai"
import { googleEmbeddingModel } from "./models"

export async function embedQuery(query: string) {
    const { embedding } = await embed({
        model: googleEmbeddingModel("gemini-embedding-001"),
        value: query,
        providerOptions: {
            google: {
                outputDimensionality: 768,
            },
        },
    })

    return embedding;
}