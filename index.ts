import express from "express";
import { tavily } from "@tavily/core";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompt";
import { streamText } from "ai";
import { googleModel } from "./lib/models";

const port = 4000;
const app = express();

app.use(express.json());

const tvlyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });

app.get("/health", (req, res) => {
  res.status(200).json({
    message: "Hello from the server",
  });
});

app.get("/chat", async (req, res) => {
  // SETP 1 -> Get the user search query
  const { query } = req.body;
  // STEP 2 - (TODO) Check if the user query is already indexed for a similar query

  // STEP 3 -> Do the web search and gather the sources
  const webSearchResult = await tvlyClient.search(query, {
    searchDepth: "advanced",
  });

  // STEP 4 - (TODO) Store the query and result in the vector DB

  // STEP 5 - Do some context engineering on the prpmpt -> web search response
  const prompt = PROMPT_TEMPLATE.replace(
    "{{WEB_SEARCH_RESULTS}}",
    JSON.stringify(webSearchResult),
  ).replace("{{USER_QUERY}}", query);

  // STEP 6 - Hit the LLM and stream back the response
  const result = streamText({
    model: googleModel,
    prompt,
    system: SYSTEM_PROMPT,
    // output: Output.object({
    //   schema: z.object({
    //     followUps: z.array(z.string()),
    //     answer: z.string(),
    //   }),
    // }),
  });

  res.header("Cache-Control", "no-cache")
  res.header("Content-Type", "text/event-stream")
  res.header("Connection", "keep-alive")

  for await (const textPart of result.textStream) {
    res.write(textPart)
  }

  res.write("\n<SOURCES>\n")

  // STEP 7 - Also steram back the sources and follow up questions (which we can get from web search response + llm )
  res.write(JSON.stringify(webSearchResult.results.map(result => ({ url: result.url }))));

  // STEP 8 - Close the event stream
  res.end()
});

app.listen(port, () => console.log(`Server is running on port ${port}`));
