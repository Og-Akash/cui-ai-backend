import { embed } from "ai"
import { google } from "./models"

export async function embedQuery(query: string) {
    const { embedding } = await embed({
        model: google.embedding("gemini-embedding-001"),
        value: query,
        providerOptions: {
            google: {
                outputDimensionality: 768,
            },
        },
    })

    return embedding;
}