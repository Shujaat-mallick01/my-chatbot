import { useState, useRef, useEffect, useCallback } from "react";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const API_BASE = "http://localhost:8000";

const AGENT_TYPES = {
  SCRAPER: { id: "scraper", name: "Web Scraper", icon: "🕷️", color: "#10b981" },
  SUMMARIZER: { id: "summarizer", name: "Summarizer", icon: "📝", color: "#6366f1" },
  QA: { id: "qa", name: "Q&A Agent", icon: "💬", color: "#f59e0b" },
  ROUTER: { id: "router", name: "Router", icon: "🔀", color: "#ec4899" },
};

const VECTOR_DBS = [
  { id: "pinecone", name: "Pinecone", icon: "🌲" },
  { id: "chroma", name: "ChromaDB", icon: "🎨" },
  { id: "weaviate", name: "Weaviate", icon: "🔮" },
  { id: "qdrant", name: "Qdrant", icon: "⚡" },
];

const STATUS = {
  IDLE: "idle",
  SCRAPING: "scraping",
  EMBEDDING: "embedding",
  QUERYING: "querying",
  THINKING: "thinking",
  ERROR: "error",
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  API HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function apiChat(message) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Server error ${res.status}`);
  }
  return res.json(); // { response, intermediate_steps }
}

async function apiIngest(urls) {
  const res = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Server error ${res.status}`);
  }
  return res.json(); // { status, detail }
}

async function apiSummarize(url) {
  const res = await fetch(`${API_BASE}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Server error ${res.status}`);
  }
  return res.json(); // { summary }
}

async function apiHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error("Backend unreachable");
  return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function MultiAgentRAGChatbot() {
  const [activeTab, setActiveTab] = useState("chat");
  const [urls, setUrls] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "system",
      content:
        "Welcome! I'm your multi-agent RAG assistant. Add some URLs in the **Sources** tab, then ask me anything about those pages.",
      agent: AGENT_TYPES.ROUTER,
    },
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(STATUS.IDLE);
  const [statusText, setStatusText] = useState("");
  const [indexedUrls, setIndexedUrls] = useState([]);
  const [selectedVectorDb, setSelectedVectorDb] = useState("chroma");
  const [agentLog, setAgentLog] = useState([]);
  const [showArchitecture, setShowArchitecture] = useState(false);
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(50);
  const [embeddingModel, setEmbeddingModel] = useState("openai");
  const [llmModel, setLlmModel] = useState("gpt-4");
  const [backendStatus, setBackendStatus] = useState("unknown"); // unknown | online | offline
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Check backend health on mount
  useEffect(() => {
    apiHealth()
      .then((data) => {
        setBackendStatus("online");
        if (data.vector_db) setSelectedVectorDb(data.vector_db);
        if (data.llm_model) setLlmModel(data.llm_model);
      })
      .catch(() => setBackendStatus("offline"));
  }, []);

  const addAgentLog = useCallback((agent, action, detail) => {
    setAgentLog((prev) => [
      ...prev,
      { agent, action, detail, time: new Date().toLocaleTimeString() },
    ]);
  }, []);

  // ── Ingest URLs via real API ──────────────────
  const handleIngestUrls = async () => {
    const parsed = urls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (parsed.length === 0) return;

    setStatus(STATUS.SCRAPING);
    setStatusText("Sending URLs to backend...");
    addAgentLog(AGENT_TYPES.SCRAPER, "Started", `Ingesting ${parsed.length} URL(s)`);

    try {
      const result = await apiIngest(parsed);

      setIndexedUrls((prev) => [...prev, ...parsed]);
      addAgentLog(AGENT_TYPES.SCRAPER, "Complete", result.detail);
      setUrls("");

      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `✅ ${result.detail}`,
          agent: AGENT_TYPES.SCRAPER,
        },
      ]);
    } catch (err) {
      addAgentLog(AGENT_TYPES.SCRAPER, "Error", err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `❌ Ingestion failed: ${err.message}`,
          agent: AGENT_TYPES.SCRAPER,
        },
      ]);
    } finally {
      setStatus(STATUS.IDLE);
      setStatusText("");
    }
  };

  // ── Send chat message via real API ────────────
  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStatus(STATUS.THINKING);
    setStatusText("Thinking...");

    addAgentLog(AGENT_TYPES.ROUTER, "Routing", `Analyzing: "${userMsg.content.slice(0, 50)}..."`);

    try {
      const result = await apiChat(userMsg.content);

      // Log intermediate steps from the agent
      if (result.intermediate_steps && result.intermediate_steps.length > 0) {
        result.intermediate_steps.forEach((step) => {
          const agent =
            step.tool === "web_scraper"
              ? AGENT_TYPES.SCRAPER
              : step.tool === "page_summarizer"
              ? AGENT_TYPES.SUMMARIZER
              : AGENT_TYPES.QA;

          addAgentLog(agent, `Tool: ${step.tool}`, `Input: ${step.input?.slice(0, 80)}...`);
        });
      }

      addAgentLog(AGENT_TYPES.QA, "Complete", "Response delivered");

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.response, agent: AGENT_TYPES.QA },
      ]);
    } catch (err) {
      addAgentLog(AGENT_TYPES.ROUTER, "Error", err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `❌ Error: ${err.message}\n\nMake sure the backend server is running on ${API_BASE}`,
          agent: AGENT_TYPES.ROUTER,
        },
      ]);
    } finally {
      setStatus(STATUS.IDLE);
      setStatusText("");
    }
  };

  // ── Architecture Diagram ──────────────────────
  const ArchitectureDiagram = () => (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 24,
        margin: "16px 0",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        lineHeight: 1.8,
        color: "var(--text-secondary)",
        overflowX: "auto",
      }}
    >
      <pre style={{ margin: 0, whiteSpace: "pre" }}>{`
  ┌─────────────────────────────────────────────────────────────────┐
  │                    MULTI-AGENT RAG SYSTEM                      │
  ├─────────────────────────────────────────────────────────────────┤
  │                                                                 │
  │   ┌──────────┐    ┌──────────────┐    ┌───────────────────┐    │
  │   │  React   │───▶│  FastAPI     │───▶│  Agent Router     │    │
  │   │  Frontend│    │  /chat       │    │  (LangChain)      │    │
  │   └──────────┘    │  /ingest     │    │  ┌─────────────┐  │    │
  │     fetch()       │  /summarize  │    │  │ Scraper     │  │    │
  │                    └──────────────┘    │  │ Summarizer  │  │    │
  │                                        │  │ Q&A Agent   │  │    │
  │                                        │  └─────────────┘  │    │
  │                                        └───────────────────┘    │
  │                              │                                   │
  │                              ▼                                   │
  │   ┌──────────────────────────────────────────────────────┐      │
  │   │              RAG Pipeline                             │      │
  │   │                                                       │      │
  │   │  POST /ingest ──▶ Scrape ──▶ Chunk ──▶ Embed ──▶ DB  │      │
  │   │                                                       │      │
  │   │  POST /chat   ──▶ Embed Q ──▶ Search ──▶ LLM ──▶ Res │      │
  │   └──────────────────────────────────────────────────────┘      │
  │                              │                                   │
  │                              ▼                                   │
  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐        │
  │   │  Pinecone   │  │  ChromaDB   │  │  Weaviate/Qdrant│        │
  │   │  (Cloud)    │  │  (Local)    │  │  (Self-hosted)  │        │
  │   └─────────────┘  └─────────────┘  └─────────────────┘        │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘
`}</pre>
    </div>
  );

  // ── Backend Status Badge ──────────────────────
  const BackendBadge = () => {
    const colors = {
      online: { bg: "rgba(16,185,129,0.12)", text: "#10b981", dot: "#10b981" },
      offline: { bg: "rgba(244,63,94,0.12)", text: "#f43f5e", dot: "#f43f5e" },
      unknown: { bg: "var(--surface-2)", text: "var(--text-muted)", dot: "var(--text-muted)" },
    };
    const c = colors[backendStatus];
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 20,
          fontSize: 10,
          fontWeight: 600,
          fontFamily: "'JetBrains Mono', monospace",
          background: c.bg,
          color: c.text,
          cursor: "pointer",
        }}
        title={`Backend: ${API_BASE}`}
        onClick={() =>
          apiHealth()
            .then(() => setBackendStatus("online"))
            .catch(() => setBackendStatus("offline"))
        }
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: c.dot,
          }}
        />
        {backendStatus === "online" ? "API Connected" : backendStatus === "offline" ? "API Offline" : "Checking..."}
      </div>
    );
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap');

        :root {
          --bg: #0a0a0f;
          --surface-0: #101018;
          --surface-1: #16161f;
          --surface-2: #1e1e2a;
          --surface-3: #282838;
          --border: #2a2a3a;
          --border-active: #4a4a6a;
          --text: #e8e8f0;
          --text-secondary: #a0a0b8;
          --text-muted: #606078;
          --accent: #7c5cfc;
          --accent-hover: #9078ff;
          --accent-glow: rgba(124, 92, 252, 0.3);
          --green: #10b981;
          --amber: #f59e0b;
          --rose: #f43f5e;
          --blue: #3b82f6;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'Outfit', sans-serif;
        }

        .app-container {
          display: grid;
          grid-template-columns: 280px 1fr 260px;
          height: 100vh;
          max-height: 100vh;
          overflow: hidden;
        }

        .sidebar-left {
          background: var(--surface-0);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .sidebar-header {
          padding: 20px 16px 16px;
          border-bottom: 1px solid var(--border);
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 4px;
        }

        .logo-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--accent), #ec4899);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          box-shadow: 0 4px 16px var(--accent-glow);
        }

        .logo-text {
          font-weight: 700;
          font-size: 18px;
          letter-spacing: -0.5px;
        }

        .logo-sub {
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.5px;
          margin-top: 6px;
          padding-left: 46px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .config-section {
          padding: 16px;
          flex: 1;
          overflow-y: auto;
        }

        .config-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: var(--text-muted);
          font-weight: 600;
          margin-bottom: 8px;
          margin-top: 16px;
        }

        .config-label:first-child { margin-top: 0; }

        .vdb-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .vdb-option {
          padding: 8px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface-1);
          cursor: pointer;
          text-align: center;
          font-size: 12px;
          transition: all 0.2s ease;
          font-family: 'Outfit', sans-serif;
          color: var(--text-secondary);
        }

        .vdb-option:hover { border-color: var(--border-active); }

        .vdb-option.active {
          border-color: var(--accent);
          background: rgba(124, 92, 252, 0.08);
          color: var(--text);
        }

        .vdb-icon { font-size: 18px; display: block; margin-bottom: 2px; }

        .config-select, .config-input {
          width: 100%;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface-1);
          color: var(--text);
          font-size: 13px;
          font-family: 'Outfit', sans-serif;
          outline: none;
          transition: border-color 0.2s;
        }

        .config-select:focus, .config-input:focus {
          border-color: var(--accent);
        }

        .config-select option { background: var(--surface-1); }

        .config-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .config-field label {
          display: block;
          font-size: 11px;
          color: var(--text-muted);
          margin-bottom: 4px;
        }

        .agent-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .agent-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .agent-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .arch-btn {
          width: 100%;
          padding: 10px;
          border-radius: 8px;
          border: 1px dashed var(--border);
          background: transparent;
          color: var(--text-muted);
          font-size: 12px;
          cursor: pointer;
          font-family: 'Outfit', sans-serif;
          transition: all 0.2s;
          margin-top: 12px;
        }

        .arch-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        .main-area {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .tabs-bar {
          display: flex;
          border-bottom: 1px solid var(--border);
          background: var(--surface-0);
          padding: 0 16px;
        }

        .tab {
          padding: 12px 20px;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-muted);
          cursor: pointer;
          border: none;
          background: none;
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
          font-family: 'Outfit', sans-serif;
        }

        .tab:hover { color: var(--text-secondary); }

        .tab.active {
          color: var(--text);
          border-bottom-color: var(--accent);
        }

        .chat-area {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .message {
          max-width: 72%;
          padding: 12px 16px;
          border-radius: 14px;
          font-size: 14px;
          line-height: 1.6;
          word-wrap: break-word;
          white-space: pre-wrap;
        }

        .message.user {
          align-self: flex-end;
          background: var(--accent);
          color: #fff;
          border-bottom-right-radius: 4px;
        }

        .message.system, .message.assistant {
          align-self: flex-start;
          background: var(--surface-2);
          color: var(--text);
          border-bottom-left-radius: 4px;
        }

        .msg-agent-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-muted);
          margin-bottom: 6px;
        }

        .message strong { color: var(--accent-hover); font-weight: 600; }

        .input-bar {
          padding: 16px 20px;
          border-top: 1px solid var(--border);
          background: var(--surface-0);
          display: flex;
          gap: 8px;
        }

        .input-field {
          flex: 1;
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--surface-1);
          color: var(--text);
          font-size: 14px;
          font-family: 'Outfit', sans-serif;
          outline: none;
          transition: border-color 0.2s;
        }

        .input-field:focus { border-color: var(--accent); }

        .send-btn {
          padding: 12px 24px;
          border-radius: 12px;
          border: none;
          background: var(--accent);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'Outfit', sans-serif;
          transition: all 0.2s;
        }

        .send-btn:hover { background: var(--accent-hover); }
        .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .sources-area {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }

        .url-textarea {
          width: 100%;
          min-height: 120px;
          padding: 14px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--surface-1);
          color: var(--text);
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
          outline: none;
          resize: vertical;
          line-height: 1.7;
        }

        .url-textarea:focus { border-color: var(--accent); }

        .ingest-btn {
          margin-top: 12px;
          padding: 12px 28px;
          border-radius: 10px;
          border: none;
          background: var(--green);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'Outfit', sans-serif;
          transition: all 0.2s;
        }

        .ingest-btn:hover { filter: brightness(1.1); }
        .ingest-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .indexed-list {
          margin-top: 24px;
        }

        .indexed-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--surface-1);
          border-radius: 8px;
          margin-bottom: 6px;
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--text-secondary);
        }

        .indexed-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--green);
          flex-shrink: 0;
        }

        .sidebar-right {
          background: var(--surface-0);
          border-left: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .log-header {
          padding: 16px;
          border-bottom: 1px solid var(--border);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          color: var(--text-muted);
          font-weight: 600;
        }

        .log-entries {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }

        .log-entry {
          padding: 8px;
          border-radius: 8px;
          margin-bottom: 6px;
          background: var(--surface-1);
          border-left: 3px solid var(--border);
        }

        .log-entry-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 2px;
        }

        .log-agent {
          font-size: 11px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .log-time {
          font-size: 10px;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
        }

        .log-action {
          font-size: 10px;
          color: var(--accent);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .log-detail {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
          margin-left: auto;
        }

        .status-pill.idle { background: var(--surface-2); color: var(--text-muted); }
        .status-pill.active { background: rgba(124, 92, 252, 0.15); color: var(--accent); }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .pulse-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          animation: pulse 1.2s ease-in-out infinite;
        }

        .thinking-indicator {
          display: flex;
          gap: 4px;
          padding: 12px 16px;
          align-self: flex-start;
        }

        .thinking-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-muted);
          animation: pulse 1.2s ease-in-out infinite;
        }

        .thinking-dot:nth-child(2) { animation-delay: 0.2s; }
        .thinking-dot:nth-child(3) { animation-delay: 0.4s; }

        .code-area {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }

        .code-block {
          background: var(--surface-1);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 20px;
        }

        .code-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          background: var(--surface-2);
          border-bottom: 1px solid var(--border);
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--text-muted);
        }

        .code-content {
          padding: 16px;
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          line-height: 1.7;
          color: var(--text-secondary);
          overflow-x: auto;
          white-space: pre;
        }

        .section-title {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .section-desc {
          font-size: 13px;
          color: var(--text-muted);
          margin-bottom: 16px;
          line-height: 1.6;
        }

        .chat-area::-webkit-scrollbar,
        .log-entries::-webkit-scrollbar,
        .config-section::-webkit-scrollbar,
        .sources-area::-webkit-scrollbar,
        .code-area::-webkit-scrollbar {
          width: 4px;
        }

        .chat-area::-webkit-scrollbar-thumb,
        .log-entries::-webkit-scrollbar-thumb,
        .config-section::-webkit-scrollbar-thumb,
        .sources-area::-webkit-scrollbar-thumb,
        .code-area::-webkit-scrollbar-thumb {
          background: var(--surface-3);
          border-radius: 4px;
        }

        .offline-banner {
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.25);
          border-radius: 10px;
          padding: 14px 18px;
          margin-bottom: 12px;
          font-size: 13px;
          color: #fca5a5;
          line-height: 1.6;
        }

        .offline-banner code {
          background: rgba(255,255,255,0.08);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }
      `}</style>

      <div className="app-container">
        {/* ── LEFT SIDEBAR ── */}
        <div className="sidebar-left">
          <div className="sidebar-header">
            <div className="logo">
              <div className="logo-icon">🤖</div>
              <span className="logo-text">RAG Agent</span>
            </div>
            <div className="logo-sub">
              <BackendBadge />
            </div>
          </div>

          <div className="config-section">
            <div className="config-label">Vector Database</div>
            <div className="vdb-grid">
              {VECTOR_DBS.map((db) => (
                <button
                  key={db.id}
                  className={`vdb-option ${selectedVectorDb === db.id ? "active" : ""}`}
                  onClick={() => setSelectedVectorDb(db.id)}
                >
                  <span className="vdb-icon">{db.icon}</span>
                  {db.name}
                </button>
              ))}
            </div>

            <div className="config-label">LLM Provider</div>
            <select
              className="config-select"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
            >
              <option value="gpt-4">OpenAI GPT-4</option>
              <option value="gpt-3.5">OpenAI GPT-3.5</option>
              <option value="claude-3">Claude 3 Sonnet</option>
              <option value="llama-3">Llama 3 (Local)</option>
            </select>

            <div className="config-label">Embedding Model</div>
            <select
              className="config-select"
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
            >
              <option value="openai">OpenAI Ada-002</option>
              <option value="cohere">Cohere Embed v3</option>
              <option value="huggingface">HuggingFace BGE</option>
            </select>

            <div className="config-label">Chunking</div>
            <div className="config-row">
              <div className="config-field">
                <label>Chunk Size</label>
                <input
                  type="number"
                  className="config-input"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                />
              </div>
              <div className="config-field">
                <label>Overlap</label>
                <input
                  type="number"
                  className="config-input"
                  value={chunkOverlap}
                  onChange={(e) => setChunkOverlap(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="config-label">Active Agents</div>
            <div className="agent-list">
              {Object.values(AGENT_TYPES).map((agent) => (
                <div key={agent.id} className="agent-item">
                  <div className="agent-dot" style={{ background: agent.color }} />
                  <span>{agent.icon}</span>
                  <span>{agent.name}</span>
                </div>
              ))}
            </div>

            <button
              className="arch-btn"
              onClick={() => setShowArchitecture(!showArchitecture)}
            >
              {showArchitecture ? "Hide" : "Show"} Architecture Diagram
            </button>
          </div>
        </div>

        {/* ── MAIN ── */}
        <div className="main-area">
          <div className="tabs-bar">
            <button
              className={`tab ${activeTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >
              💬 Chat
            </button>
            <button
              className={`tab ${activeTab === "sources" ? "active" : ""}`}
              onClick={() => setActiveTab("sources")}
            >
              🌐 Sources
            </button>
            <button
              className={`tab ${activeTab === "code" ? "active" : ""}`}
              onClick={() => setActiveTab("code")}
            >
              🧩 Setup Guide
            </button>
            <div className={`status-pill ${status !== STATUS.IDLE ? "active" : "idle"}`}>
              {status !== STATUS.IDLE && <div className="pulse-dot" />}
              {status === STATUS.IDLE ? "Ready" : statusText || status}
            </div>
          </div>

          {activeTab === "chat" && (
            <>
              <div className="chat-area">
                {backendStatus === "offline" && (
                  <div className="offline-banner">
                    ⚠️ Backend is not reachable at <code>{API_BASE}</code>. Start
                    the server first — see the <strong>Setup Guide</strong> tab for
                    instructions. Click the status badge in the sidebar to retry.
                  </div>
                )}
                {showArchitecture && <ArchitectureDiagram />}
                {messages.map((msg, i) => (
                  <div key={i} className={`message ${msg.role}`}>
                    {msg.agent && (
                      <div className="msg-agent-tag">
                        {msg.agent.icon} {msg.agent.name}
                      </div>
                    )}
                    <div
                      dangerouslySetInnerHTML={{
                        __html: msg.content
                          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                          .replace(/\n/g, "<br/>"),
                      }}
                    />
                  </div>
                ))}
                {status === STATUS.THINKING && (
                  <div className="thinking-indicator">
                    <div className="thinking-dot" />
                    <div className="thinking-dot" />
                    <div className="thinking-dot" />
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="input-bar">
                <input
                  ref={inputRef}
                  className="input-field"
                  placeholder={
                    backendStatus === "offline"
                      ? "Start the backend server first..."
                      : "Ask about your indexed content..."
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  disabled={status !== STATUS.IDLE}
                />
                <button
                  className="send-btn"
                  onClick={handleSend}
                  disabled={status !== STATUS.IDLE || !input.trim()}
                >
                  Send
                </button>
              </div>
            </>
          )}

          {activeTab === "sources" && (
            <div className="sources-area">
              <div className="section-title">🌐 Add Website Sources</div>
              <div className="section-desc">
                Paste URLs below (one per line). The backend will scrape each page,
                chunk the content, generate embeddings, and store them in your
                configured vector database.
              </div>
              {backendStatus === "offline" && (
                <div className="offline-banner" style={{ marginBottom: 16 }}>
                  ⚠️ Backend offline — ingestion won't work until you start the
                  server. See the <strong>Setup Guide</strong> tab.
                </div>
              )}
              <textarea
                className="url-textarea"
                placeholder={
                  "https://example.com/docs/intro\nhttps://example.com/docs/api\nhttps://example.com/about"
                }
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                disabled={status !== STATUS.IDLE}
              />
              <button
                className="ingest-btn"
                onClick={handleIngestUrls}
                disabled={status !== STATUS.IDLE || !urls.trim()}
              >
                {status === STATUS.SCRAPING ? "Indexing..." : "🚀 Ingest & Index"}
              </button>

              {indexedUrls.length > 0 && (
                <div className="indexed-list">
                  <div className="config-label">
                    Indexed Sources ({indexedUrls.length})
                  </div>
                  {indexedUrls.map((url, i) => (
                    <div key={i} className="indexed-item">
                      <div className="indexed-dot" />
                      {url}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "code" && (
            <div className="code-area">
              <div className="section-title">🧩 Backend Setup Guide</div>
              <div className="section-desc">
                Follow these steps to start the backend server that powers this UI.
              </div>

              <div className="code-block">
                <div className="code-header">
                  <span>Step 1 — Install dependencies</span>
                  <span>Terminal</span>
                </div>
                <div className="code-content">{`# Clone or enter your project directory
cd rag-agent

# Create a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate

# Install Python packages
pip install -r requirements.txt`}</div>
              </div>

              <div className="code-block">
                <div className="code-header">
                  <span>Step 2 — Set environment variables</span>
                  <span>.env</span>
                </div>
                <div className="code-content">{`# Required
OPENAI_API_KEY=sk-...

# Optional overrides (defaults shown)
LLM_MODEL=gpt-4
LLM_TEMPERATURE=0
EMBEDDING_MODEL=text-embedding-ada-002
VECTOR_DB=chroma
CHROMA_PERSIST_DIR=./chroma_db
CHUNK_SIZE=512
CHUNK_OVERLAP=50
RETRIEVAL_K=5
RETRIEVAL_FETCH_K=10

# If using Pinecone instead of Chroma:
# VECTOR_DB=pinecone
# PINECONE_API_KEY=...
# PINECONE_INDEX=rag-index

# If using Weaviate:
# VECTOR_DB=weaviate
# WEAVIATE_URL=http://localhost:8080

# If using Qdrant:
# VECTOR_DB=qdrant
# QDRANT_URL=http://localhost:6333`}</div>
              </div>

              <div className="code-block">
                <div className="code-header">
                  <span>Step 3 — Start the backend server</span>
                  <span>Terminal</span>
                </div>
                <div className="code-content">{`# Start with hot-reload (development)
uvicorn server:app --reload --port 8000

# Or run directly
python server.py

# The API will be live at http://localhost:8000
# Docs available at  http://localhost:8000/docs`}</div>
              </div>

              <div className="code-block">
                <div className="code-header">
                  <span>Step 4 — Start the frontend</span>
                  <span>Terminal (separate tab)</span>
                </div>
                <div className="code-content">{`# From the frontend project directory
npm install
npm run dev

# Opens at http://localhost:5173 (Vite) or :3000 (CRA)
# The frontend calls http://localhost:8000 by default.
# To change, edit the API_BASE constant at the top of
# MultiAgentRAGChatbot.jsx`}</div>
              </div>

              <div className="code-block">
                <div className="code-header">
                  <span>API Endpoints</span>
                  <span>Reference</span>
                </div>
                <div className="code-content">{`POST /chat
  Body:    { "message": "What is RAG?" }
  Returns: { "response": "...", "intermediate_steps": [...] }

POST /ingest
  Body:    { "urls": ["https://example.com/page1", ...] }
  Returns: { "status": "ok", "detail": "Indexed 24 chunks from 2 URL(s)." }

POST /summarize
  Body:    { "url": "https://example.com/page1" }
  Returns: { "summary": "..." }

GET /health
  Returns: { "status": "healthy", "vector_db": "chroma", "llm_model": "gpt-4" }

WS  /ws/chat
  Send:    { "message": "..." }
  Receive: { "type": "status", "status": "thinking" }
           { "type": "response", "response": "...", "intermediate_steps": [...] }`}</div>
              </div>

              <div className="code-block">
                <div className="code-header">
                  <span>requirements.txt</span>
                  <span>Python</span>
                </div>
                <div className="code-content">{`langchain>=0.2.0
langchain-openai
langchain-community
chromadb
pinecone-client
beautifulsoup4
fastapi
uvicorn
python-dotenv
unstructured
tiktoken
sentence-transformers
websockets`}</div>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT SIDEBAR — AGENT LOG ── */}
        <div className="sidebar-right">
          <div className="log-header">Agent Activity Log</div>
          <div className="log-entries">
            {agentLog.length === 0 && (
              <div
                style={{
                  padding: 16,
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 12,
                }}
              >
                Agent actions will appear here as you interact with the system.
              </div>
            )}
            {agentLog
              .slice()
              .reverse()
              .map((entry, i) => (
                <div
                  key={i}
                  className="log-entry"
                  style={{ borderLeftColor: entry.agent.color }}
                >
                  <div className="log-entry-header">
                    <div className="log-agent" style={{ color: entry.agent.color }}>
                      {entry.agent.icon} {entry.agent.name}
                    </div>
                    <div className="log-time">{entry.time}</div>
                  </div>
                  <div className="log-action">{entry.action}</div>
                  <div className="log-detail">{entry.detail}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}