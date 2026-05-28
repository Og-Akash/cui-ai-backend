-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "SearchCache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "sources" JSONB NOT NULL,
    "llmResponse" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("id")
);

-- HNSW index for fast cosine similarity search
CREATE INDEX "SearchCache_embedding_idx" ON "SearchCache"
USING hnsw (embedding vector_cosine_ops);
