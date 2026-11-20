import { api } from "@/lib/api";

// Mirrors the backend contract in app/schemas/assistant.py: the only roles a
// client may supply as short-term context are "user"/"assistant"; the system
// message is authored server-side and is never sent from the client.
export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AskRequest {
  question: string;
  recent_messages: ChatMessage[];
}

export interface AskResponse {
  answer: string;
  ai_configured: boolean; // Configuration Indicator: true while AI is configured
  source: "ai" | "local"; // which path produced the answer (ai_configured === (source === "ai"))
  model: string | null; // AI_MODEL when source === "ai", otherwise null
}

export async function askAssistant(input: AskRequest): Promise<AskResponse> {
  const { data } = await api.post<AskResponse>("/assistant/ask", input);
  return data;
}
