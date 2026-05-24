export type WebSearchResult = {
    title: string;
    link: string;
    content?: string;
    score?: number;
    raw_content: string | null;
}

export type WebSearchResponse = {
    query: string;
    follow_up_questions: string[] | null;
    answers: string[] | null;
    images: string[];
    results: WebSearchResult[];
}