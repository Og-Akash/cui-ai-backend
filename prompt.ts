import type { RecalledMemory } from "./services/memory";

// ── Response style descriptors ───────────────────────────────────────────────

const STYLE_DESCRIPTIONS: Record<string, string> = {
  balanced: "Use a clear, well-rounded tone: informative but approachable.",
  creative:
    "Respond in a creative, vivid way — use analogies, storytelling and colorful language while staying accurate.",
  concise:
    "Be as concise as possible. Prefer short sentences and bullet points. No filler, no restating the question.",
  technical:
    "Respond like a senior engineer: precise terminology, code examples where useful, tradeoffs and edge cases called out explicitly.",
  friendly:
    "Use a warm, conversational, encouraging tone — like a helpful friend who knows the topic well.",
  academic:
    "Respond in a rigorous, scholarly tone: structured arguments, careful qualifications, and citations of the provided sources.",
};

export type PersonaContext = {
  name: string;
  aboutYou: string;
  occupation: string;
  traits: string[];
  responseStyle: string;
  customInstructions: string;
} | null;

// ── System prompt ────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are an expert assistant called Purplexity. Given the user's query,
the conversation so far, and (optionally) web search results, answer the query to the best of your
abilities. YOU DON'T HAVE ACCESS TO ANY TOOLS — all the context you need is provided.

When web search results are provided, ground your answer in them and cite them inline as [1], [2], …
matching the numbering of the results.

You also need to return follow up questions to the user based on the question they have asked.
The response needs to be structured like this -
<ANSWER>
    This is where the actual query should be answered
</ANSWER>

<FOLLOW_UPS>
    <question> first follow up question </question>
    <question> second follow up question </question>
    <question> third follow up question </question>
</FOLLOW_UPS>

## Rich UI blocks
When the query is about shopping, buying, or comparing products (or the user asks to compare
concrete items/services), include a fenced code block with language "productcards" INSIDE the
<ANSWER> section, containing a JSON array of the products you found in the web results:

\`\`\`productcards
[{"name": "Product name", "price": "$99", "rating": 4.5, "highlights": ["key spec 1", "key spec 2"], "pros": ["..."], "cons": ["..."], "url": "https://...", "image": "https://..."}]
\`\`\`

Rules for productcards:
- Only use data present in the web search results; never invent prices or URLs.
- 2–6 products. "rating" is a number out of 5 or null. "image" is a URL from the provided images list or null.
- Put a short intro paragraph before the block and your recommendation after it.
- Do NOT use productcards for non-product queries.`;

export function buildSystemPrompt(
  persona: PersonaContext,
  memories: RecalledMemory[],
): string {
  let prompt = BASE_SYSTEM_PROMPT;

  if (persona) {
    const styleLine =
      STYLE_DESCRIPTIONS[persona.responseStyle] ?? STYLE_DESCRIPTIONS.balanced;
    // Persona fields are unbounded user input — cap them so a pasted essay in
    // "custom instructions" can't dominate the token budget of every request.
    const aboutYou = persona.aboutYou.trim().slice(0, 600);
    const occupation = persona.occupation.trim().slice(0, 200);
    const customInstructions = persona.customInstructions.trim().slice(0, 1500);
    const parts: string[] = [];
    if (aboutYou) parts.push(`About them: ${aboutYou}`);
    if (occupation) parts.push(`What they do: ${occupation}`);
    if (persona.traits.length > 0)
      parts.push(`They want you to be: ${persona.traits.join(", ")}.`);
    parts.push(`Response style: ${styleLine}`);
    if (customInstructions) {
      parts.push(`Additional instructions from them:\n${customInstructions}`);
    }

    prompt += `

    ## User profile ("${persona.name}")
    The user has configured how you should interact with them. Follow this faithfully:
    ${parts.join("\n")}`;
      }

      if (memories.length > 0) {
        prompt += `

    ## What you remember about this user
    From previous conversations you know the following. Use it to personalise the answer when relevant;
    never recite this list back unless asked what you remember:
    ${memories.map((m) => `- (${m.category}) ${m.content}`).join("\n")}`}

  return prompt;
}

// ── Per-request prompt ───────────────────────────────────────────────────────

export function buildChatPrompt(opts: {
  query: string;
  sourcesText: string;
  imagesText: string;
  historyText: string;
}): string {
  const { query, sourcesText, imagesText, historyText } = opts;

  return `${historyText ? `# Conversation so far\n${historyText}\n\n` : ""}# Web search results
${sourcesText}
${imagesText ? `\n# Images found alongside the results (for productcards "image" fields)\n${imagesText}\n` : ""}
## User query
${query}
`;
}

// ── Follow-ups endpoint prompt (unchanged behaviour) ─────────────────────────

export const SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

export const FOLLOW_UPS_PROMPT = `
    Based on the following conversation, generate exactly 3 insightful follow-up questions
    the user might want to ask next. These should naturally extend the conversation.

    Output only in this exact XML format:
    <FOLLOW_UPS>
        <question> first follow up question </question>
        <question> second follow up question </question>
        <question> third follow up question </question>
    </FOLLOW_UPS>

    ## Conversation History
    {{CONVERSATION_HISTORY}}
`;
