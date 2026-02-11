import { useState, useRef, useEffect, useCallback } from "react";
import * as recharts from "recharts";

const { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } = recharts;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CONFIG — change API_BASE to your backend URL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const API = "https://t8rtbqrp-8000.asse.devtunnels.ms";

const AGENTS = {
  SCRAPER:    { id:"scraper",    name:"Scraper",    icon:"◆", color:"#22d3ee" },
  SUMMARIZER: { id:"summarizer", name:"Summarizer", icon:"◇", color:"#a78bfa" },
  QA:         { id:"qa",         name:"Q&A",        icon:"●", color:"#fbbf24" },
  ROUTER:     { id:"router",     name:"Router",     icon:"◈", color:"#f472b6" },
  EXTRACTOR:  { id:"extractor",  name:"Extractor",  icon:"⬡", color:"#34d399" },
  EXPORT:     { id:"export",     name:"Export",      icon:"▣", color:"#fb923c" },
};

const ST = { IDLE:"idle", WORKING:"working" };
const COLORS = ["#22d3ee","#a78bfa","#fbbf24","#f472b6","#34d399","#fb923c","#818cf8","#f87171"];

// ━━━  API  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const post = async (path, body) => {
  const r = await fetch(`${API}${path}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail||`Error ${r.status}`); }
  return r.json();
};
const get = async (path) => { const r = await fetch(`${API}${path}`); if (!r.ok) throw new Error("Failed"); return r.json(); };

const apiChat      = (msg) => post("/chat",      { message: msg });
const apiIngest    = (urls)=> post("/ingest",     { urls });
const apiSummarize = (url) => post("/summarize",  { url });
const apiExtract   = (type, query) => post("/extract", { extract_type: type, query });
const apiHealth    = ()    => get("/health");
const apiSources   = ()    => get("/sources");
const apiExports   = ()    => get("/exports");

// ━━━  CLIENT-SIDE CSV EXPORT  ━━━━━━━━━━━━━━━━━━

function downloadCSV(data, filename = "export.csv") {
  if (!data?.length) return;
  const h = Object.keys(data[0]);
  const rows = [h.join(","), ...data.map(r => h.map(k => `"${String(r[k]||'').replace(/"/g,'""')}"`).join(","))];
  const blob = new Blob([rows.join("\n")], { type:"text/csv" });
  Object.assign(document.createElement("a"), { href:URL.createObjectURL(blob), download:filename }).click();
}

function downloadFromServer(filename) {
  window.open(`${API}/exports/${filename}`, "_blank");
}

// ━━━  MAIN COMPONENT  ━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function RAGDashboard() {
  const [view, setView] = useState("chat");
  const [urls, setUrls] = useState("");
  const [messages, setMessages] = useState([
    { role:"system", content:"System ready. Paste URLs in INGEST to scrape content. Then ask questions or extract data (emails, phones, etc). Results can be exported as CSV/Excel.", agent:AGENTS.ROUTER, ts:Date.now() }
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(ST.IDLE);
  const [statusLabel, setStatusLabel] = useState("");
  const [indexedUrls, setIndexedUrls] = useState([]);
  const [logs, setLogs] = useState([]);
  const [backend, setBackend] = useState("unknown");
  const [backendInfo, setBackendInfo] = useState({});
  const [exportData, setExportData] = useState(null);    // latest extracted table
  const [chartData, setChartData] = useState([]);
  const [serverExports, setServerExports] = useState([]); // files on server
  const chatEnd = useRef(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);
  useEffect(() => {
    apiHealth().then(d => { setBackend("online"); setBackendInfo(d); }).catch(() => setBackend("offline"));
  }, []);

  const log = useCallback((agent, action, detail) => {
    setLogs(p => [...p, { agent, action, detail, time: new Date().toLocaleTimeString() }]);
  }, []);

  const refreshExports = () => apiExports().then(d => setServerExports(d.files||[])).catch(()=>{});

  // ── INGEST ──
  const handleIngest = async () => {
    const list = urls.split("\n").map(u=>u.trim()).filter(Boolean);
    if (!list.length) return;
    setStatus(ST.WORKING); setStatusLabel(`Scraping ${list.length} URL(s)…`);
    log(AGENTS.SCRAPER, "INGEST", `${list.length} URL(s)`);
    try {
      const r = await apiIngest(list);
      setIndexedUrls(p => [...p, ...list]);
      log(AGENTS.SCRAPER, "DONE", r.detail);
      setMessages(p => [...p, { role:"system", content:`✓ ${r.detail}`, agent:AGENTS.SCRAPER, ts:Date.now() }]);
      setUrls("");
    } catch (e) {
      log(AGENTS.SCRAPER, "ERROR", e.message);
      setMessages(p => [...p, { role:"system", content:`✗ ${e.message}`, agent:AGENTS.SCRAPER, ts:Date.now() }]);
    }
    setStatus(ST.IDLE); setStatusLabel("");
  };

  // ── CHAT (routes through agent — will use extraction tools automatically) ──
  const handleSend = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setMessages(p => [...p, { role:"user", content:msg, ts:Date.now() }]);
    setInput("");
    setStatus(ST.WORKING); setStatusLabel("Agent thinking…");
    log(AGENTS.ROUTER, "ROUTE", `"${msg.slice(0,60)}"`);
    try {
      const r = await apiChat(msg);
      // Log intermediate steps
      r.intermediate_steps?.forEach(s => {
        const a = s.tool==="web_scraper"?AGENTS.SCRAPER : s.tool==="page_summarizer"?AGENTS.SUMMARIZER
          : s.tool==="contact_extractor"?AGENTS.EXTRACTOR : s.tool==="custom_data_extractor"?AGENTS.EXTRACTOR : AGENTS.QA;
        log(a, s.tool, (s.input||'').slice(0,80));
      });

      const agentUsed = r.intermediate_steps?.length
        ? (r.intermediate_steps.some(s => s.tool.includes("extractor")) ? AGENTS.EXTRACTOR : AGENTS.QA)
        : AGENTS.QA;

      setMessages(p => [...p, {
        role:"assistant", content:r.response, agent:agentUsed, ts:Date.now(),
        exportData: r.export_data || null,
      }]);

      // If export data came back, store it
      if (r.export_data?.length) {
        setExportData(r.export_data);
        log(AGENTS.EXPORT, "DATA_READY", `${r.export_data.length} records`);
        refreshExports();

        // Build chart from export data
        const typeCount = {};
        r.export_data.forEach(row => {
          const key = row.Type || row.type || Object.values(row)[0] || "Item";
          typeCount[key] = (typeCount[key]||0) + 1;
        });
        if (Object.keys(typeCount).length >= 1) {
          setChartData(Object.entries(typeCount).map(([name,value])=>({name,value})));
        }
      }

      log(AGENTS.QA, "DONE", "Response delivered");
    } catch (e) {
      log(AGENTS.ROUTER, "ERROR", e.message);
      setMessages(p => [...p, { role:"system", content:`✗ ${e.message}`, agent:AGENTS.ROUTER, ts:Date.now() }]);
    }
    setStatus(ST.IDLE); setStatusLabel("");
  };

  // ── DIRECT EXTRACT (bypass agent for speed) ──
  const handleDirectExtract = async (type, query) => {
    setStatus(ST.WORKING); setStatusLabel("Extracting…");
    log(AGENTS.EXTRACTOR, "EXTRACT", `${type}: ${query}`);
    try {
      const r = await apiExtract(type, query);
      setMessages(p => [...p, {
        role:"assistant", content:r.result, agent:AGENTS.EXTRACTOR, ts:Date.now(),
        exportData: r.export_data || null,
      }]);
      if (r.export_data?.length) {
        setExportData(r.export_data);
        log(AGENTS.EXPORT, "DATA_READY", `${r.export_data.length} records`);
        refreshExports();
      }
    } catch (e) {
      log(AGENTS.EXTRACTOR, "ERROR", e.message);
      setMessages(p => [...p, { role:"system", content:`✗ ${e.message}`, agent:AGENTS.EXTRACTOR, ts:Date.now() }]);
    }
    setStatus(ST.IDLE); setStatusLabel("");
  };

  // ── RENDER ──
  return (<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Sora:wght@300;400;500;600;700;800&display=swap');
      :root{--bg:#06080c;--s0:#0b0e14;--s1:#111620;--s2:#181e2a;--s3:#222936;--bdr:#1e2636;--bdr-a:#2e3a4e;--tx:#d4dae6;--tx2:#8892a6;--tx3:#505a6e;--cyan:#22d3ee;--cyan-d:rgba(34,211,238,.1);--violet:#a78bfa;--violet-d:rgba(167,139,250,.1);--amber:#fbbf24;--rose:#f472b6;--green:#34d399;--green-d:rgba(52,211,153,.1);--orange:#fb923c;--orange-d:rgba(251,146,60,.1)}
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:var(--bg);color:var(--tx);font-family:'Sora',sans-serif}
      ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--s3);border-radius:3px}

      .shell{display:grid;grid-template-columns:60px 220px 1fr 260px;height:100vh;overflow:hidden}

      /* ICON BAR */
      .ib{background:var(--s0);border-right:1px solid var(--bdr);display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:4px}
      .ib-logo{width:36px;height:36px;border-radius:11px;background:linear-gradient(145deg,var(--cyan),var(--violet));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#000;margin-bottom:18px;box-shadow:0 0 20px rgba(34,211,238,.2);font-family:'IBM Plex Mono',monospace}
      .ib-btn{width:40px;height:40px;border-radius:10px;border:none;background:transparent;color:var(--tx3);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;transition:all .15s;font-family:'Sora'}
      .ib-btn:hover{background:var(--s2);color:var(--tx2)}
      .ib-btn.on{background:var(--cyan-d);color:var(--cyan)}
      .ib-btn.on::before{content:'';position:absolute;left:-1px;top:50%;transform:translateY(-50%);width:3px;height:18px;background:var(--cyan);border-radius:0 2px 2px 0}
      .ib-sp{flex:1}
      .ib-dot{width:8px;height:8px;border-radius:50%;margin-bottom:8px}

      /* LEFT PANEL */
      .lp{background:var(--s0);border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden}
      .lp-hd{padding:18px 14px 10px;border-bottom:1px solid var(--bdr)}
      .lp-t{font-size:13px;font-weight:700;letter-spacing:-.3px}
      .lp-sub{font-size:9px;color:var(--tx3);font-family:'IBM Plex Mono',monospace;letter-spacing:.5px;margin-top:2px}
      .lp-body{padding:10px 14px;flex:1;overflow-y:auto}
      .lp-lbl{font-size:8px;text-transform:uppercase;letter-spacing:1.8px;color:var(--tx3);font-weight:600;margin:14px 0 6px;font-family:'IBM Plex Mono',monospace}
      .lp-lbl:first-child{margin-top:0}
      .ag-row{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:6px;font-size:11px;color:var(--tx2);cursor:default}
      .ag-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
      .idx-row{display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:10px;font-family:'IBM Plex Mono',monospace;color:var(--tx3);word-break:break-all}
      .idx-d{width:4px;height:4px;border-radius:50%;background:var(--green);flex-shrink:0}
      .sys-box{font-size:10px;color:var(--tx3);font-family:'IBM Plex Mono',monospace;padding:8px;background:var(--s1);border-radius:6px;line-height:1.9}
      .sys-box span{color:var(--cyan)}
      .lp-btn{width:100%;padding:7px;border-radius:6px;border:1px solid var(--bdr);background:var(--s1);color:var(--tx2);font-size:10px;font-weight:600;cursor:pointer;font-family:'IBM Plex Mono',monospace;transition:all .15s;margin-top:4px;text-align:center}
      .lp-btn:hover{border-color:var(--cyan);color:var(--cyan)}
      .lp-btn.grn:hover{border-color:var(--green);color:var(--green)}
      .lp-btn.org:hover{border-color:var(--orange);color:var(--orange)}

      /* MAIN */
      .mn{display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
      .mn-hd{display:flex;align-items:center;gap:2px;padding:0 18px;height:46px;border-bottom:1px solid var(--bdr);background:var(--s0);flex-shrink:0}
      .mn-tab{padding:9px 14px;font-size:11px;font-weight:500;color:var(--tx3);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;transition:all .15s;font-family:'Sora'}
      .mn-tab:hover{color:var(--tx2)}.mn-tab.on{color:var(--cyan);border-bottom-color:var(--cyan)}
      .mn-st{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:9px;font-family:'IBM Plex Mono',monospace;color:var(--tx3)}
      .mn-dot{width:6px;height:6px;border-radius:50%}
      @keyframes bk{0%,100%{opacity:1}50%{opacity:.3}}.bk{animation:bk 1s ease-in-out infinite}
      .exp-bar{display:flex;gap:5px;margin-left:10px}
      .exp-b{padding:4px 10px;border-radius:5px;border:1px solid var(--bdr);background:var(--s1);color:var(--tx2);font-size:9px;font-weight:600;cursor:pointer;font-family:'IBM Plex Mono',monospace;transition:all .15s}
      .exp-b:hover{border-color:var(--green);color:var(--green);background:var(--green-d)}
      .exp-b.dl{border-color:var(--orange);color:var(--orange)}.exp-b.dl:hover{background:var(--orange-d)}

      /* CHAT */
      .ch-scroll{flex:1;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:8px}
      .msg{max-width:76%;padding:11px 15px;border-radius:14px;font-size:12.5px;line-height:1.7;word-wrap:break-word;white-space:pre-wrap;position:relative}
      .msg.user{align-self:flex-end;background:linear-gradient(135deg,rgba(34,211,238,.14),rgba(167,139,250,.1));border:1px solid rgba(34,211,238,.18);border-bottom-right-radius:4px}
      .msg.system,.msg.assistant{align-self:flex-start;background:var(--s1);border:1px solid var(--bdr);border-bottom-left-radius:4px}
      .msg-tag{display:flex;align-items:center;gap:5px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:5px;font-family:'IBM Plex Mono',monospace}
      .msg strong{font-weight:600}
      .msg-acts{display:flex;gap:4px;margin-top:8px;flex-wrap:wrap}
      .ma-btn{padding:3px 9px;border-radius:5px;border:1px solid var(--bdr);background:transparent;color:var(--tx3);font-size:8px;font-weight:600;cursor:pointer;font-family:'IBM Plex Mono',monospace;transition:all .15s;text-transform:uppercase;letter-spacing:.5px}
      .ma-btn:hover{border-color:var(--green);color:var(--green)}
      .ma-btn.dl:hover{border-color:var(--orange);color:var(--orange)}

      .think{display:flex;gap:5px;padding:12px 16px;align-self:flex-start}
      .think>div{width:7px;height:7px;border-radius:50%;background:var(--tx3);animation:bk 1.2s ease-in-out infinite}
      .think>div:nth-child(2){animation-delay:.2s}.think>div:nth-child(3){animation-delay:.4s}

      .ch-bar{padding:12px 18px;border-top:1px solid var(--bdr);background:var(--s0);display:flex;gap:8px;flex-shrink:0}
      .ch-in{flex:1;padding:10px 14px;border-radius:10px;border:1px solid var(--bdr);background:var(--s1);color:var(--tx);font-size:12.5px;font-family:'Sora';outline:none;transition:border-color .15s}
      .ch-in:focus{border-color:var(--cyan)}.ch-in::placeholder{color:var(--tx3)}
      .ch-send{padding:10px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--cyan),var(--violet));color:#000;font-size:12.5px;font-weight:700;cursor:pointer;font-family:'Sora';transition:all .15s}
      .ch-send:hover{filter:brightness(1.15)}.ch-send:disabled{opacity:.3;cursor:not-allowed}

      /* INGEST */
      .ing{flex:1;overflow-y:auto;padding:24px 28px}
      .ing-t{font-size:16px;font-weight:700;margin-bottom:5px;letter-spacing:-.4px}
      .ing-d{font-size:11px;color:var(--tx3);margin-bottom:18px;line-height:1.7}
      .ing-ta{width:100%;min-height:120px;padding:12px;border-radius:10px;border:1px solid var(--bdr);background:var(--s1);color:var(--tx);font-size:11px;font-family:'IBM Plex Mono',monospace;outline:none;resize:vertical;line-height:1.8;transition:border-color .15s}
      .ing-ta:focus{border-color:var(--cyan)}
      .ing-acts{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
      .ing-btn{padding:10px 22px;border-radius:10px;border:1px solid var(--cyan);background:var(--cyan-d);color:var(--cyan);font-size:12px;font-weight:600;cursor:pointer;font-family:'Sora';transition:all .15s}
      .ing-btn:hover{background:rgba(34,211,238,.2)}.ing-btn:disabled{opacity:.3;cursor:not-allowed}
      .ing-btn.v{border-color:var(--violet);background:var(--violet-d);color:var(--violet)}.ing-btn.v:hover{background:rgba(167,139,250,.2)}
      .ing-btn.g{border-color:var(--green);background:var(--green-d);color:var(--green)}.ing-btn.g:hover{background:rgba(52,211,153,.2)}
      .ing-btn.o{border-color:var(--orange);background:var(--orange-d);color:var(--orange)}.ing-btn.o:hover{background:rgba(251,146,60,.2)}

      .warn{background:rgba(244,114,182,.08);border:1px solid rgba(244,114,182,.2);border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:11px;color:var(--rose);font-family:'IBM Plex Mono',monospace}
      .ing-src{margin-top:24px}
      .src-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--s1);border-radius:6px;margin-bottom:3px;font-size:10px;font-family:'IBM Plex Mono',monospace;color:var(--tx3)}
      .src-d{width:5px;height:5px;border-radius:50%;background:var(--green);flex-shrink:0}
      .src-acts{margin-left:auto;display:flex;gap:4px}

      /* DATA VIEW */
      .dv{flex:1;overflow-y:auto;padding:24px 28px}
      .card{background:var(--s1);border:1px solid var(--bdr);border-radius:10px;padding:18px;margin-bottom:18px}
      .card-t{font-size:12px;font-weight:600;margin-bottom:3px}.card-sub{font-size:9px;color:var(--tx3);font-family:'IBM Plex Mono',monospace;margin-bottom:14px}
      .no-data{text-align:center;padding:50px 20px;color:var(--tx3);font-size:12px}.no-data-ic{font-size:36px;margin-bottom:10px;opacity:.3}

      table.dt{width:100%;border-collapse:collapse;font-size:10px;font-family:'IBM Plex Mono',monospace}
      table.dt th{padding:7px 10px;background:var(--s2);color:var(--cyan);text-align:left;border-bottom:1px solid var(--bdr);font-size:9px;letter-spacing:.5px;text-transform:uppercase}
      table.dt td{padding:5px 10px;border-bottom:1px solid var(--bdr);color:var(--tx2)}

      /* SERVER FILES */
      .sf-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--s1);border-radius:6px;margin-bottom:3px;font-size:10px;font-family:'IBM Plex Mono',monospace;color:var(--tx2)}

      /* RIGHT LOG */
      .rp{background:var(--s0);border-left:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden}
      .rp-hd{padding:12px 12px;border-bottom:1px solid var(--bdr);font-size:8px;text-transform:uppercase;letter-spacing:1.8px;color:var(--tx3);font-weight:600;font-family:'IBM Plex Mono',monospace}
      .rp-sc{flex:1;overflow-y:auto;padding:8px}
      .le{padding:7px 8px;border-radius:6px;margin-bottom:3px;background:var(--s1);border-left:3px solid var(--bdr)}
      .le-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:1px}
      .le-ag{font-size:9px;font-weight:700;display:flex;align-items:center;gap:4px;font-family:'IBM Plex Mono',monospace}
      .le-tm{font-size:8px;color:var(--tx3);font-family:'IBM Plex Mono',monospace}
      .le-act{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;font-family:'IBM Plex Mono',monospace}
      .le-det{font-size:9px;color:var(--tx3);margin-top:1px;word-break:break-word}
      .le-empty{padding:20px 12px;text-align:center;color:var(--tx3);font-size:10px}

      @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
      .msg{animation:fadeIn .2s ease-out}
    `}</style>

    <div className="shell">
      {/* ICON BAR */}
      <div className="ib">
        <div className="ib-logo">R</div>
        <button className={`ib-btn ${view==='chat'?'on':''}`} onClick={()=>setView('chat')} title="Chat">💬</button>
        <button className={`ib-btn ${view==='ingest'?'on':''}`} onClick={()=>setView('ingest')} title="Ingest">🌐</button>
        <button className={`ib-btn ${view==='data'?'on':''}`} onClick={()=>setView('data')} title="Data & Export">📊</button>
        <div className="ib-sp"/>
        <div className="ib-dot" style={{background:backend==='online'?'var(--green)':backend==='offline'?'var(--rose)':'var(--tx3)'}} title={`Backend: ${backend}`}/>
      </div>

      {/* LEFT PANEL */}
      <div className="lp">
        <div className="lp-hd">
          <div className="lp-t">RAG Agent</div>
          <div className="lp-sub">UNIVERSAL SCRAPER + EXTRACTOR</div>
        </div>
        <div className="lp-body">
          <div className="lp-lbl">System</div>
          <div className="sys-box">
            Status: <span>{backend}</span><br/>
            VectorDB: <span>{backendInfo.vector_db||'—'}</span><br/>
            LLM: <span>{(backendInfo.llm_model||'—').split('/').pop()}</span><br/>
            Tools: <span>{backendInfo.tools?.length||0}</span>
          </div>

          <div className="lp-lbl">Agents</div>
          {Object.values(AGENTS).map(a=>(
            <div key={a.id} className="ag-row">
              <div className="ag-dot" style={{background:a.color}}/>{a.name}
              <span style={{marginLeft:'auto',color:a.color,fontFamily:"'IBM Plex Mono',monospace",fontSize:10}}>{a.icon}</span>
            </div>
          ))}

          <div className="lp-lbl">Indexed ({indexedUrls.length})</div>
          {!indexedUrls.length && <div style={{fontSize:10,color:'var(--tx3)',padding:'2px 8px'}}>No sources</div>}
          {indexedUrls.slice(-6).map((u,i)=>(
            <div key={i} className="idx-row"><div className="idx-d"/>{u.length>30?u.slice(0,30)+'…':u}</div>
          ))}
          {indexedUrls.length>6 && <div style={{fontSize:9,color:'var(--tx3)',padding:'2px 8px'}}>+{indexedUrls.length-6} more</div>}

          <div className="lp-lbl">Quick Actions</div>
          <button className="lp-btn grn" onClick={()=>{ if(exportData?.length) downloadCSV(exportData); }}>↓ Download CSV</button>
          <button className="lp-btn org" onClick={()=>downloadFromServer("contacts_extracted.xlsx")}>↓ Download XLSX</button>
          <button className="lp-btn" onClick={()=>handleDirectExtract("contacts","all")} disabled={status!==ST.IDLE||!indexedUrls.length}>⬡ Extract All Contacts</button>
        </div>
      </div>

      {/* MAIN */}
      <div className="mn">
        <div className="mn-hd">
          <button className={`mn-tab ${view==='chat'?'on':''}`} onClick={()=>setView('chat')}>Chat</button>
          <button className={`mn-tab ${view==='ingest'?'on':''}`} onClick={()=>setView('ingest')}>Ingest</button>
          <button className={`mn-tab ${view==='data'?'on':''}`} onClick={()=>setView('data')}>Data</button>
          <div className="mn-st">
            <div className={`mn-dot ${status!==ST.IDLE?'bk':''}`} style={{background:status===ST.IDLE?'var(--green)':'var(--cyan)'}}/>
            {status===ST.IDLE?'READY':statusLabel||'WORKING'}
          </div>
          <div className="exp-bar">
            <button className="exp-b" onClick={()=>{ if(exportData?.length) downloadCSV(exportData); }}>CSV ↓</button>
            <button className="exp-b dl" onClick={()=>downloadFromServer("contacts_extracted.csv")}>Server CSV ↓</button>
            <button className="exp-b dl" onClick={()=>downloadFromServer("contacts_extracted.xlsx")}>XLSX ↓</button>
          </div>
        </div>

        {/* CHAT VIEW */}
        {view==='chat' && (<>
          <div className="ch-scroll">
            {backend==='offline' && <div className="warn">⚠ Backend offline at {API} — start the server first.</div>}
            {messages.map((m,i)=>(
              <div key={i} className={`msg ${m.role}`}>
                {m.agent && <div className="msg-tag" style={{color:m.agent.color}}>{m.agent.icon} {m.agent.name}</div>}
                <div dangerouslySetInnerHTML={{__html: m.content.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br/>')}}/>
                {m.role==='assistant' && (
                  <div className="msg-acts">
                    <button className="ma-btn" onClick={()=>navigator.clipboard.writeText(m.content)}>COPY</button>
                    {m.exportData?.length>0 && <>
                      <button className="ma-btn" onClick={()=>downloadCSV(m.exportData,`extract_${Date.now()}.csv`)}>↓ CSV</button>
                      <button className="ma-btn dl" onClick={()=>downloadFromServer("contacts_extracted.xlsx")}>↓ XLSX</button>
                    </>}
                  </div>
                )}
              </div>
            ))}
            {status===ST.WORKING && <div className="think"><div/><div/><div/></div>}
            <div ref={chatEnd}/>
          </div>
          <div className="ch-bar">
            <input className="ch-in" placeholder={backend==='offline'?"Start backend…":"Ask anything, extract data, or type a URL to scrape…"}
              value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&handleSend()}
              disabled={status!==ST.IDLE}/>
            <button className="ch-send" onClick={handleSend} disabled={status!==ST.IDLE||!input.trim()}>Send</button>
          </div>
        </>)}

        {/* INGEST VIEW */}
        {view==='ingest' && (
          <div className="ing">
            <div className="ing-t">Scrape & Index Web Pages</div>
            <div className="ing-d">
              Paste URLs (one per line). The system scrapes each page, chunks content, generates embeddings, and stores them.
              After indexing, you can extract emails, phone numbers, or any structured data.
            </div>
            {backend==='offline' && <div className="warn">⚠ Backend offline</div>}
            <textarea className="ing-ta" placeholder={"https://example.com/contact\nhttps://example.com/team\nhttps://example.com/about"}
              value={urls} onChange={e=>setUrls(e.target.value)} disabled={status!==ST.IDLE}/>
            <div className="ing-acts">
              <button className="ing-btn" onClick={handleIngest} disabled={status!==ST.IDLE||!urls.trim()}>
                {status===ST.WORKING?'Working…':'◆ Scrape & Index'}
              </button>
              {urls.trim().split('\n').filter(Boolean).length===1 && (
                <button className="ing-btn v" onClick={()=>{
                  const u=urls.trim();
                  apiSummarize(u).then(r=>setMessages(p=>[...p,{role:'assistant',content:`**Summary of ${u}:**\n\n${r.summary}`,agent:AGENTS.SUMMARIZER,ts:Date.now()}])).catch(()=>{});
                }} disabled={status!==ST.IDLE}>◇ Summarize Only</button>
              )}
              <button className="ing-btn g" onClick={()=>handleDirectExtract("contacts","all")}
                disabled={status!==ST.IDLE||!indexedUrls.length}>⬡ Extract All Contacts</button>
              <button className="ing-btn o" onClick={()=>{
                const q=prompt("What data to extract? (e.g. 'all product names and prices')");
                if(q) handleDirectExtract("custom",q);
              }} disabled={status!==ST.IDLE||!indexedUrls.length}>⬡ Custom Extract</button>
            </div>

            {indexedUrls.length>0 && (
              <div className="ing-src">
                <div className="lp-lbl">Indexed Sources ({indexedUrls.length})</div>
                {indexedUrls.map((u,i)=>(
                  <div key={i} className="src-row">
                    <div className="src-d"/><span style={{flex:1}}>{u}</span>
                    <div className="src-acts">
                      <button className="ma-btn" onClick={()=>handleDirectExtract("contacts",u)} style={{fontSize:7}}>EXTRACT</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* DATA VIEW */}
        {view==='data' && (
          <div className="dv">
            <div className="ing-t">Extracted Data & Exports</div>
            <div className="ing-d">Data extracted from scraped content. Download as CSV or XLSX.</div>

            {exportData?.length ? (<>
              {/* Chart */}
              {chartData.length>=1 && (
                <div className="card">
                  <div className="card-t">Data Breakdown</div>
                  <div className="card-sub">{chartData.length} categories</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2636"/>
                      <XAxis dataKey="name" tick={{fill:'#505a6e',fontSize:9}}/>
                      <YAxis tick={{fill:'#505a6e',fontSize:9}}/>
                      <Tooltip contentStyle={{background:'#111620',border:'1px solid #1e2636',borderRadius:8,fontSize:11,color:'#d4dae6'}}/>
                      <Bar dataKey="value" radius={[4,4,0,0]}>
                        {chartData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Table */}
              <div className="card">
                <div className="card-t">Extracted Records ({exportData.length})</div>
                <div className="card-sub">Scroll to view all • Click buttons below to export</div>
                <div style={{overflowX:'auto',maxHeight:400,overflowY:'auto'}}>
                  <table className="dt">
                    <thead><tr>{Object.keys(exportData[0]).map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>{exportData.map((r,i)=>(
                      <tr key={i}>{Object.values(r).map((v,j)=><td key={j}>{String(v)}</td>)}</tr>
                    ))}</tbody>
                  </table>
                </div>
                <div style={{display:'flex',gap:8,marginTop:14}}>
                  <button className="ing-btn g" onClick={()=>downloadCSV(exportData)}>↓ Download CSV</button>
                  <button className="ing-btn o" onClick={()=>downloadFromServer("contacts_extracted.xlsx")}>↓ Download XLSX</button>
                  <button className="ing-btn" onClick={()=>downloadFromServer("custom_extraction.csv")}>↓ Custom CSV</button>
                </div>
              </div>
            </>) : (
              <div className="no-data">
                <div className="no-data-ic">📊</div>
                No extracted data yet.<br/>
                <span style={{fontSize:10,marginTop:6,display:'block'}}>
                  Scrape URLs → then ask "extract every email and phone number" or use the Extract buttons.
                </span>
              </div>
            )}

            {/* Server-side export files */}
            <div style={{marginTop:20}}>
              <div className="lp-lbl" style={{display:'flex',alignItems:'center',gap:8}}>
                Server Export Files
                <button className="ma-btn" onClick={refreshExports} style={{fontSize:7}}>REFRESH</button>
              </div>
              {serverExports.length ? serverExports.map((f,i)=>(
                <div key={i} className="sf-row">
                  <span>{f}</span>
                  <button className="ma-btn dl" onClick={()=>downloadFromServer(f)}>↓</button>
                </div>
              )) : <div style={{fontSize:10,color:'var(--tx3)',padding:'4px 0'}}>No files yet — extract data first</div>}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT LOG */}
      <div className="rp">
        <div className="rp-hd">Agent Activity</div>
        <div className="rp-sc">
          {!logs.length && <div className="le-empty">Actions appear here as agents run.</div>}
          {logs.slice().reverse().map((e,i)=>(
            <div key={i} className="le" style={{borderLeftColor:e.agent.color}}>
              <div className="le-hd">
                <div className="le-ag" style={{color:e.agent.color}}>{e.agent.icon} {e.agent.name}</div>
                <div className="le-tm">{e.time}</div>
              </div>
              <div className="le-act" style={{color:e.agent.color}}>{e.action}</div>
              <div className="le-det">{e.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </>);
}