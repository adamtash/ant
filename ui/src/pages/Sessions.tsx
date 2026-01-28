import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import type { SessionDetailResponse, SessionsResponse } from "../api/types";
import Panel from "../components/Panel";
import StatusBadge from "../components/StatusBadge";

export default function Sessions() {
  const [sessions, setSessions] = useState<SessionsResponse["sessions"]>([]);
  const [activeKey, setActiveKey] = useState<string>("");
  const [messages, setMessages] = useState<SessionDetailResponse["messages"]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SessionsResponse>("/sessions")
      .then((data) => {
        setSessions(data.sessions);
        if (data.sessions[0]?.sessionKey) {
          setActiveKey((current) => current || data.sessions[0].sessionKey);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load sessions"));
  }, []);

  useEffect(() => {
    if (!activeKey) return;
    apiGet<SessionDetailResponse>(`/sessions/${encodeURIComponent(activeKey)}`)
      .then((data) => setMessages(data.messages))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load messages"));
  }, [activeKey]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    try {
      await apiPost("/chat", { message: input, sessionKey: activeKey || "ui:default" });
      setInput("");
      if (activeKey) {
        const data = await apiGet<SessionDetailResponse>(`/sessions/${encodeURIComponent(activeKey)}`);
        setMessages(data.messages);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold">Sessions</h2>
          <p className="text-slate-400">Inspect chat history and send a quick prompt.</p>
        </div>
        {error && <StatusBadge label={error} tone="error" />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Panel title="Session list" description="Most recent sessions from storage.">
          <div className="space-y-3">
            {sessions.length === 0 && <p className="text-sm text-slate-400">No sessions yet.</p>}
            {sessions.map((session) => (
              <button
                key={session.sessionKey}
                className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                  activeKey === session.sessionKey
                    ? "border-brand-500/60 bg-brand-500/10 text-white"
                    : "border-slate-800/50 bg-slate-900/50 text-slate-300 hover:bg-slate-900/70"
                }`}
                onClick={() => setActiveKey(session.sessionKey)}
              >
                <div className="font-semibold">{session.sessionKey}</div>
                <div className="text-xs text-slate-400">Updated {new Date(session.updatedAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Session transcript" description={activeKey ? `Viewing ${activeKey}` : "Select a session to view"}>
          <div className="space-y-4">
            <div className="max-h-[420px] overflow-y-auto space-y-3">
              {messages.length === 0 && <p className="text-sm text-slate-400">No messages yet.</p>}
              {messages.map((message, idx) => (
                <div
                  key={`${message.ts}-${idx}`}
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    message.role === "user"
                      ? "border-brand-500/40 bg-brand-500/10 text-white"
                      : "border-slate-800/50 bg-slate-900/60 text-slate-200"
                  }`}
                >
                  <div className="text-xs uppercase tracking-widest text-slate-400">{message.role}</div>
                  <p className="mt-2 whitespace-pre-wrap">{message.content}</p>
                  <div className="mt-2 text-xs text-slate-500">{new Date(message.ts).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Send a message"
                className="flex-1 rounded-xl border border-slate-800/60 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
              />
              <button
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
                onClick={sendMessage}
              >
                Send
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
