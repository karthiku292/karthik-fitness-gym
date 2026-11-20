import { FormEvent, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Bot, Info, Send, User } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
} from "@/components/ui";
import { apiErrorMessage } from "@/lib/api";
import { ChatMessage, ChatRole, askAssistant } from "@/features/assistant/api";

// Short-term context window sent with each question. The backend rejects more
// than 10 recent messages (422), so the client caps it defensively (Req 9.2).
const RECENT_LIMIT = 10;

/** One transcript turn, rendered as a chat bubble. */
function MessageBubble({ role, content }: { role: ChatRole; content: string }) {
  const isUser = role === "user";
  return (
    <div className={clsx("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={clsx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
          isUser ? "bg-brand-gradient text-[#080808]" : "bg-surface-2 text-brand"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={clsx(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm text-white",
          isUser ? "bg-brand/15" : "bg-surface-2"
        )}
      >
        {content}
      </div>
    </div>
  );
}

/** Assistant-side placeholder shown while a request is in flight (Req 9.3). */
function PendingBubble() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-brand">
        <Bot className="h-4 w-4" />
      </div>
      <div className="w-48 rounded-2xl bg-surface-2 px-4 py-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-2/3" />
      </div>
    </div>
  );
}

/**
 * Admin-only AI Business Assistant chat page (Req 9). All conversation state
 * lives in component memory — nothing is persisted, matching the stateless
 * backend. On submit the page appends the user's turn, sends the question plus
 * up to the last {@link RECENT_LIMIT} prior turns as short-term context, shows a
 * loading indicator while in flight, and appends the answer on success. A
 * failure rolls back the optimistic turn, shows an error, and preserves the
 * typed question so the administrator can retry without retyping (Req 9.5).
 * When the latest response is a non-AI local summary (`source === "local"`), a
 * visible note explains the assistant is running without AI configuration (Req 9.6).
 */
export function AssistantPage() {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reflects the latest answer's Configuration Indicator; true when the most
  // recent response came from the deterministic local summary (Req 9.6).
  const [notConfigured, setNotConfigured] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as the transcript grows or a reply is pending.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, loading]);

  async function send() {
    const question = input.trim();
    if (!question || loading) return;

    // Capture prior turns as context *before* appending the new question, so the
    // current question is not duplicated in recent_messages (the backend adds it).
    const recent = transcript.slice(-RECENT_LIMIT);
    setTranscript((t) => [...t, { role: "user", content: question }]);
    setLoading(true);
    setError(null);

    try {
      const res = await askAssistant({ question, recent_messages: recent });
      setTranscript((t) => [...t, { role: "assistant", content: res.answer }]);
      setNotConfigured(res.source === "local");
      setInput(""); // cleared only on a successful send (Req 9.5)
    } catch (err) {
      // Roll back the optimistic user turn and keep the question in the input so
      // the administrator can retry without retyping (Req 9.5).
      setTranscript((t) => t.slice(0, -1));
      setError(apiErrorMessage(err, "Could not get an answer. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  const isEmpty = transcript.length === 0 && !loading && !error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Business Assistant</h1>
        <p className="text-sm text-muted">
          Ask about your gym's members, revenue, attendance and membership plans
        </p>
      </div>

      <Card className="flex flex-col p-5">
        {notConfigured && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone="warning">No AI</Badge>
                <span className="font-medium text-white">AI is not configured</span>
              </div>
              <p className="text-muted">
                Showing a data summary generated directly from your gym's reporting figures.
              </p>
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className="min-h-[16rem] max-h-[52vh] space-y-4 overflow-y-auto pr-1"
        >
          {isEmpty && (
            <EmptyState
              title="Ask about your gym"
              hint="Try “How many active members do I have?” or “What's my revenue this month?”"
            />
          )}
          {transcript.map((m, i) => (
            <MessageBubble key={i} role={m.role} content={m.content} />
          ))}
          {loading && <PendingBubble />}
          {error && <ErrorState message={error} onRetry={() => void send()} />}
        </div>

        <form onSubmit={onSubmit} className="mt-4 flex items-center gap-3 border-t border-border pt-4">
          <div className="flex-1">
            <Input
              aria-label="Ask a question about your gym"
              placeholder="Ask about members, revenue, attendance…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button type="submit" loading={loading} disabled={!input.trim()}>
            <Send className="h-4 w-4" />
            Send
          </Button>
        </form>
      </Card>
    </div>
  );
}
