import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  Bell,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Filter,
  Globe,
  LayoutDashboard,
  LoaderCircle,
  MessageCircle,
  Plus,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Video,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";

const labels = {
  positive: "Tích cực",
  neutral: "Trung tính",
  negative: "Tiêu cực",
};
function BrandLogo({ compact = false }) {
  return (
    <div className={compact ? "brand-logo compact" : "brand-logo"} aria-label="Nhịp đập thương hiệu">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="brand-green" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#006103" />
            <stop offset="1" stopColor="#22ad39" />
          </linearGradient>
        </defs>
        <path d="M13 48V17h18c9 0 15 5 15 13 0 5-3 9-8 11l12 9v6H37L25 45v11H13z" fill="url(#brand-green)" opacity=".94" />
        <path d="M7 34h11l5-14 7 27 7-18h19" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M41 14c8 0 13 2 17 7m0 0-1-7m1 7-7 1" fill="none" stroke="#006103" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <div className="brand-logo-text"><strong>Nhịp<span>Đập</span></strong><small>THƯƠNG HIỆU</small></div>}
    </div>
  );
}
const fmt = (n) =>
  n == null ? '—' : new Intl.NumberFormat("vi-VN", {
    notation: n >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);
async function api(path, body, method = "POST") {
  const r = await fetch(
    "/api" + path,
    body === undefined
      ? {}
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {}
    throw new Error(e?.error || "Không thể kết nối máy chủ");
  }
  return r.json();
}
function TicketDesk({ brandId, notify, refreshDashboard }) {
  const [tickets, setTickets] = useState([]), [selected, setSelected] = useState(null), [drafts, setDrafts] = useState([]), [edited, setEdited] = useState(''), [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { setTickets(await api(`/tickets?brand=${brandId}`)); } catch (e) { notify(e.message); } finally { setLoading(false); } };
  useEffect(() => { setSelected(null); setDrafts([]); load(); }, [brandId]);
  const update = async (id, status, note = '') => { try { await api(`/tickets/${id}`, { status, note, actor: 'Administrator' }, 'PATCH'); await load(); await refreshDashboard(); notify(status === 'closed' ? 'Đã đóng ticket và ghi nhận SLA.' : 'Đã cập nhật ticket.'); } catch (e) { notify(e.message); } };
  const getDrafts = async (ticket) => { try { await api(`/tickets/${ticket.id}/view`, { actor: 'Administrator' }); const [result, detail] = await Promise.all([api(`/tickets/${ticket.id}/ai-drafts`, {}), api(`/tickets/${ticket.id}`)]); setSelected(detail); setDrafts(result.drafts); setEdited(result.drafts[0]); } catch (e) { notify(e.message); } };
  const approve = async () => { try { await api(`/tickets/${selected.id}/responses`, { content: edited, actor: 'Administrator' }); const detail = await api(`/tickets/${selected.id}`); setSelected(detail); await load(); notify('Đã duyệt phản hồi. Bước tiếp theo: phát hành lên kênh mạng xã hội.'); } catch (e) { notify(e.message); } };
  const publish = async (response) => { try { await api(`/tickets/${selected.id}/responses/${response.id}/publish`, { mode: 'manual', actor: 'Administrator' }); const detail = await api(`/tickets/${selected.id}`); setSelected(detail); await load(); notify('Đã ghi nhận phản hồi đã phát hành. Có thể đóng ticket khi hoàn tất.'); } catch (e) { notify(e.message); } };
  return <section className="card padded">
    <div className="card-heading"><div><h2>Trung tâm xử lý khủng hoảng</h2><p>Ticket chỉ được đóng sau khi phản hồi đã được duyệt và phát hành. Ticket quá SLA được đánh dấu đỏ.</p></div><span className="count-badge">{tickets.filter(t => t.status !== 'closed').length} mở</span></div>
    {loading ? <p className="muted">Đang tải ticket…</p> : !tickets.length ? <div className="empty"><ShieldCheck size={36}/><b>Chưa có ticket cần xử lý</b><p>Các tín hiệu rủi ro thấp chỉ được lưu để theo dõi.</p></div> : <div className="ticket-list">{tickets.map(t => <article className={`alert-row ${t.escalated_at ? 'ticket-overdue' : ''}`} key={t.id}>
      <div className="metric-icon orange"><Bell size={20}/></div><div className="ticket-body"><b>#{t.id} · {t.severity === 'critical' ? 'Khủng hoảng PR' : 'CSKH'} · {t.risk_score}/100</b><p>{t.comment_text || t.caption || 'Không còn nội dung nguồn'}</p><small>Phân công: {t.assignee_name || 'Chưa phân công'} · SLA: {new Date(t.due_at).toLocaleString('vi-VN')} {t.escalated_at ? ' · QUÁ HẠN' : ''}</small></div>
      <div className="ticket-actions"><button className="button outline" onClick={() => getDrafts(t)}>Xử lý / Duyệt</button>{t.status === 'open' && <button className="button outline" onClick={() => update(t.id, 'monitoring')}>Đang theo dõi</button>}{t.status !== 'closed' && <button className="button primary" onClick={() => update(t.id, 'closed', 'Đã hoàn tất xử lý sau khi phát hành phản hồi')}>Đóng ticket</button>}</div>
    </article>)}</div>}
    {selected && <div className="ai-drafts"><div className="card-heading"><div><h3>Gợi ý phản hồi AI · Ticket #{selected.id}</h3><p>Luồng bắt buộc: chỉnh sửa → duyệt → phát hành → đóng ticket.</p></div><button className="icon-button" onClick={() => setSelected(null)}><X size={18}/></button></div>{drafts.map((draft, i) => <div className="ai-draft" key={i}><b>Phương án {String.fromCharCode(65+i)}</b><p>{draft}</p><button className="button outline" onClick={() => setEdited(draft)}>Chọn phương án</button></div>)}<label>Phản hồi cần duyệt<textarea value={edited} maxLength={5000} onChange={e => setEdited(e.target.value)} /></label><button className="button primary" disabled={!edited.trim()} onClick={approve}>Duyệt phản hồi</button>{selected.responses?.map(r => <div className="ai-draft" key={r.id}><b>Phản hồi #{r.id} · {r.status.startsWith('archived_') ? 'Lịch sử vòng trước' : r.status === 'published' ? 'Đã phát hành' : 'Đã duyệt'}</b><p>{r.content}</p>{r.status === 'approved' && <button className="button primary" onClick={() => publish(r)}>Ghi nhận phát hành thủ công</button>}</div>)}<details className="channel-help"><summary>Nhật ký ticket ({selected.actions?.length || 0})</summary>{selected.actions?.map(a => <p key={a.id}><b>{a.action}</b> · {a.actor} · {new Date(a.created_at).toLocaleString('vi-VN')}<br/>{a.detail}</p>)}</details></div>}
  </section>;
}
function SLAReport({ brandId, notify }) {
  const [report, setReport] = useState(null);
  useEffect(() => { api(`/analytics/sla?brand=${brandId}`).then(setReport).catch(e => notify(e.message)); }, [brandId]);
  if (!report) return <p className="muted">Đang tải báo cáo SLA…</p>;
  return <section className="card padded"><div className="card-heading"><div><h2>Hiệu suất SLA & nhân sự</h2><p>Tỷ lệ đúng hạn được tính từ thời điểm đóng ticket so với SLA cam kết.</p></div></div><div className="metrics-grid"><div className="metric-card"><small>TICKET TỔNG</small><b>{report.total}</b></div><div className="metric-card"><small>ĐÃ XỬ LÝ</small><b>{report.resolved}</b></div><div className="metric-card"><small>ĐÚNG HẠN</small><b>{report.on_time_rate}%</b></div></div><h3>Bảng xếp hạng xử lý</h3><div className="table-scroll"><table><thead><tr><th>NHÂN SỰ</th><th>VAI TRÒ</th><th>ĐÃ XỬ LÝ</th><th>ĐÚNG HẠN</th></tr></thead><tbody>{report.staff.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.role}</td><td>{s.handled || 0}</td><td>{s.handled ? Math.round((s.on_time || 0) / s.handled * 100) : 0}%</td></tr>)}</tbody></table></div><h3>Bản đồ nhiệt rủi ro</h3><p className="muted">{report.heatmap.length ? report.heatmap.map(x => `Thứ ${x.weekday + 1}, ${String(x.hour).padStart(2,'0')}:00: ${x.total}`).join(' · ') : 'Chưa có dữ liệu ticket để xác định khung giờ rủi ro.'}</p></section>;
}
function App() {
  const refreshId=useRef(0);
  const [brands, setBrands] = useState([]),
    [brandId, setBrandId] = useState(1),
    [tab, setTab] = useState("home"),
    [days, setDays] = useState(7),
    [source,setSource] = useState('live'),
    [videoLinks,setVideoLinks] = useState(''),
    [data, setData] = useState({
      posts: [],
      comments: [],
      alerts: [],
      jobs: [],
    }),
    [health, setHealth] = useState({}),
    [query, setQuery] = useState(""),
    [sentiment, setSentiment] = useState("all"),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const current = brands.find((x) => x.id === brandId);
  const refresh = async () => {
    const requestId=++refreshId.current;
    try {
      const [b, d, h] = await Promise.all([
        api("/brands"),
        api(`/dashboard?brand=${brandId}&days=${days}&source=${source}`),
        api("/health"),
      ]);
      if(requestId!==refreshId.current)return;
      setBrands(b);
      setData(d);
      setHealth(h);
      setLoaded(true);
    } catch (e) {
      setToast(e.message);
    }
  };
  useEffect(() => {
    setLoaded(false);
    refresh();
    const t = setInterval(refresh, 15000);
    return () => {clearInterval(t);refreshId.current++;};
  }, [brandId, days, source]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const action = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (message) setToast(message);
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const counts = useMemo(() => {
    const r = { positive: 0, neutral: 0, negative: 0 };
    for (const p of data.posts) r[p.sentiment]++;
    return r;
  }, [data]);
  const filtered = data.posts.filter(
    (p) =>
      (sentiment === "all" || p.sentiment === sentiment) &&
      `${p.caption} ${p.author}`.toLowerCase().includes(query.toLowerCase()),
  );
  const activeAlerts = data.alerts.filter((a) => a.status === "open");
  const trend = useMemo(
    () =>
      Array.from({ length: days }, (_, i) => {
        const d = new Date(Date.now() - (days - 1 - i) * 86400000);
        const key = d.toLocaleDateString("sv-SE");
        const ps = data.posts.filter(
          (p) => new Date(p.created_at).toLocaleDateString("sv-SE") === key,
        );
        return {
          date: d.toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
          }),
          total: ps.length,
          negative: ps.filter((p) => p.sentiment === "negative").length,
        };
      }),
    [data, days],
  );
  const exportCSV = () => {
    const clean = (v) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const csv =
      "\uFEFF" +
      [
        ["Nội dung", "Tác giả", "Lượt xem", "Cảm xúc", "Nguồn", "URL"],
        ...filtered.map((p) => [
          p.caption,
          p.author,
          p.views,
          labels[p.sentiment],
          p.source,
          p.video_url,
        ]),
      ]
        .map((r) => r.map(clean).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "brandpulse-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const navigate = (t) => {
    setTab(t);
    setQuery("");
    setSentiment("all");
  };
  const showWorkflow = () => {
    const section = document.getElementById("quy-trinh");
    if (!section) return;
    section.focus({ preventScroll: true });
    section.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "center",
    });
  };
  return (
    <div className="app-shell">
      {tab !== "home" && (
      <aside className="sidebar">
        <a className="logo" href="#" onClick={() => navigate("home")}>
          <BrandLogo />
        </a>
        <div className="workspace">
          <span className="workspace-avatar">B</span>
          <div>
            <b>Brand workspace</b>
            <small>Không gian nghiên cứu</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            [Sparkles, "home", "Trang chủ"],
            [LayoutDashboard, "overview", "Tổng quan"],
            [Radio, "feed", "Nguồn nhắc đến"],
            [Bell, "alerts", "Cảnh báo"],
            [ShieldCheck, "tickets", "Ticket khủng hoảng"],
            [Tag, "brands", "Thương hiệu"],
          ].map(([Icon, id, label]) => (
            <button
              className={tab === id ? "nav-item active" : "nav-item"}
              key={id}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "alerts" && activeAlerts.length > 0 && (
                <i>{activeAlerts.length}</i>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label system-label">HỆ THỐNG</div>
        <button
          className={tab === "crawler" ? "nav-item active" : "nav-item"}
          onClick={() => navigate("crawler")}
        >
          <Globe size={19} />
          Trình thu thập
        </button>
        <button
          className={tab === "settings" ? "nav-item active" : "nav-item"}
          onClick={() => navigate("settings")}
        >
          <Settings size={19} />
          Cấu hình cảnh báo
        </button>
        <button className={tab === "analytics" ? "nav-item active" : "nav-item"} onClick={() => navigate("analytics")}><ChartNoAxesCombined size={19} /> Báo cáo SLA</button>
        <div className="sidebar-bottom">
          <div className="listening-card">
            <div>
              <span className="live-dot" /> Lắng nghe để thấu hiểu
            </div>
            <p>Mọi cuộc trò chuyện đều mang một tín hiệu.</p>
            <Activity size={80} strokeWidth={1} />
          </div>
          <div className="profile">
            <div className="avatar">AD</div>
            <div>
              <b>Administrator</b>
              <small>Không gian cục bộ</small>
            </div>
            <ShieldCheck size={18} />
          </div>
        </div>
      </aside>
      )}
      <main className={tab === "home" ? "public-main" : ""}>
        <header className={tab === "home" ? "home-nav" : "topbar"}>
          {tab === "home" ? (
            <>
              <a className="home-brand" href="#" onClick={() => navigate("home")}>
                <BrandLogo />
              </a>
              <div className="home-nav-links"><a href="#giai-phap">Giải pháp</a><a href="#quy-trinh">Khám phá</a><a href="#tinh-nang">Tính năng</a></div>
              <button className="home-settings-icon" aria-label="Mở cấu hình cảnh báo" onClick={() => navigate("settings")}>
                <Settings size={19}/><span>Cài đặt cảnh báo</span>
              </button>
            </>
          ) : (
            <>
          <div className="breadcrumb">
            Không gian làm việc <span>/</span>
            <b>
              {
                {
                  home: "Trang chủ",
                  overview: "Tổng quan",
                  feed: "Nguồn nhắc đến",
                  alerts: "Cảnh báo",
                  tickets: "Ticket khủng hoảng",
                  brands: "Thương hiệu",
                  crawler: "Trình thu thập",
                  settings: "Cấu hình cảnh báo",
                  analytics: "Báo cáo SLA",
                }[tab]
              }
            </b>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <span className={health.api ? "live-dot" : "offline-dot"} />
              {health.api ? "Hệ thống sẵn sàng" : "Đang kết nối"}
            </span>
            <button
              aria-label="Mở cảnh báo"
              className="icon-button"
              onClick={() => navigate("alerts")}
            >
              <Bell size={19} />
              {activeAlerts.length > 0 && <span className="notification-dot" />}
            </button>
            <div className="avatar small">AD</div>
          </div>
            </>
          )}
        </header>
        <div className={tab === "home" ? "page home-page" : tab === "settings" ? "page settings-page" : "page"}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">HỆ THỐNG LẮNG NGHE MẠNG XÃ HỘI</div>
              <h1>
                {
                  {
                    home: "Lắng nghe. Thấu hiểu. Dẫn đầu.",
                    overview: "Lắng nghe thương hiệu của bạn",
                    feed: "Mọi cuộc trò chuyện, một nơi",
                    alerts: "Phát hiện sớm. Phản hồi kịp thời.",
                     tickets: "Xử lý có chủ đích. Khép lại đúng hạn.",
                    brands: "Thương hiệu đang theo dõi",
                    crawler: "Kết nối những tín hiệu",
                    settings: "Cấu hình cảnh báo",
                     analytics: "Hiệu suất phản hồi",
                  }[tab]
                }
              </h1>
              <p>
                {tab === "settings" ? "Chọn tín hiệu cần theo dõi và nơi bạn muốn nhận thông báo." : "Theo dõi cuộc trò chuyện, nắm bắt cảm xúc và chủ động trước rủi ro."}
              </p>
            </div>
            {tab !== "settings" && tab !== "tickets" && tab !== "analytics" && <button className="button outline" onClick={exportCSV}>
              <Download size={16} />
              Xuất báo cáo
            </button>}
          </div>
          <div className="filterbar">
            <div className="filters-left">
              <span className="brand-icon">
                {current?.name?.slice(0, 1) || "B"}
              </span>
              <select
                aria-label="Thương hiệu"
                value={brandId}
                onChange={(e) => setBrandId(Number(e.target.value))}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <span className="divider" />
              <span className="platform-icon">♪</span>
              <span className="platform-label">TikTok</span>
              <span className="platform-badge">WEB CÔNG KHAI</span>
            </div>
            {tab !== "settings" && <div className="filters-right">
              <select aria-label="Nguồn dữ liệu" value={source} onChange={e=>setSource(e.target.value)}><option value="live">TikTok · dữ liệu thật</option><option value="demo">Demo · minh họa</option></select>
              <select
                aria-label="Khoảng thời gian"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={1}>24 giờ qua</option>
                <option value={7}>7 ngày qua</option>
                <option value={30}>30 ngày qua</option>
              </select>
              <button
                className="button primary"
                disabled={busy || data.jobs.some((j) => j.status === "running")}
                onClick={() =>
                  action(
                    () => api("/crawl", { brand_id: brandId }),
                    "Đã bắt đầu thu thập. Xem tiến độ tại Trình thu thập.",
                  )
                }
              >
                <Radio size={16} />
                Thu thập ngay
              </button>
            </div>}
          </div>
          {tab !== 'settings' && source==='live'&&<div className="insight-strip"><Radio size={20}/><div><b>Dữ liệu TikTok thật · {data.posts.length} bài · {data.comments.length} bình luận đã tải</b><p>{data.comments.filter(c=>c.sentiment==='negative').length} bình luận tiêu cực. Chỉ số không lấy được hiển thị “—”. Biểu đồ tính theo thời điểm thu thập; dữ liệu demo được tách riêng.</p></div><button onClick={()=>navigate('crawler')}>Lịch quét từ khóa <ArrowRight size={16}/></button></div>}
          {data.posts.some((p) => p.source === "demo") && (
            <div className="demo-note">
              <Sparkles size={14} />
              <span>
                Chế độ minh họa · Các bản ghi gắn nhãn DEMO là dữ liệu giả lập,
                không phải bài đăng TikTok thực tế.
              </span>
            </div>
          )}
          {!loaded && tab !== "home" ? (
            <div className="empty">
              <LoaderCircle className="spin" />
              Đang kết nối backend…
            </div>
          ) : (
            <>
              {tab === "home" && (
                <section className="home">
                  <div className="home-hero">
                    <div className="hero-backdrop" aria-hidden="true">
                    <div className="hero-grid" aria-hidden="true" />
                    <div className="hero-glow-bubbles" aria-hidden="true">
                      {Array.from({ length: 44 }, (_, i) => {
                        // Fixed positions keep particles stable during dashboard refreshes.
                        const x = i < 30 ? 2 + i * 3.3 : 58 + ((i * 17) % 39);
                        const y = i < 30
                          ? 82 - 23 * Math.exp(-(((x - 75) / 25) ** 2)) - ((i * 7) % 13)
                          : 16 + ((i * 13) % 43);
                        return <span key={i} className="hero-glow-bubble" style={{
                          left: `${x}%`, top: `${y}%`,
                          '--bubble-size': `${i % 9 === 0 ? 7 : 2 + (i % 4)}px`,
                          '--bubble-duration': `${4 + (i % 5)}s`,
                          '--bubble-delay': `${-i * .73}s`,
                          '--bubble-drift': `${i % 2 === 0 ? 5 : -5}px`,
                        }} />;
                      })}
                    </div>
                    <svg className="hero-data-waves" viewBox="0 0 1200 190" preserveAspectRatio="none" aria-hidden="true">
                      <defs>
                        <linearGradient id="wave-green" x1="0" x2="1"><stop stopColor="#0b7d42" stopOpacity=".25"/><stop offset=".36" stopColor="#4eff78" stopOpacity=".95"/><stop offset=".62" stopColor="#8dffa3" stopOpacity="1"/><stop offset="1" stopColor="#13b95a" stopOpacity=".3"/></linearGradient>
                        <filter id="wave-glow"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                      </defs>
                      <g fill="none" stroke="url(#wave-green)">
                        {Array.from({length: 16}, (_, i) => <path key={i} strokeWidth=".7" opacity={.16 + i * .025} d={`M-20,${110+i*3} C150,${118+i*4} 230,${220-i} 400,${173-i*1.5} S690,${95+i*2} 830,${80+i*3} S1090,${135-i*2} 1220,${20+i*5}`} />)}
                      </g>
                      <path className="wave-fill" d="M0,155 C112,113 190,174 290,153 C397,130 426,83 524,100 C640,120 678,157 780,132 C888,104 963,87 1066,111 C1141,128 1175,119 1200,104 L1200,190 L0,190 Z" />
                      <path className="wave-line line-one" d="M-20,155 C112,113 190,174 290,153 C397,130 426,83 524,100 C640,120 678,157 780,132 C888,104 963,87 1066,111 C1141,128 1175,119 1220,104" />
                      <path className="wave-line line-two" d="M-20,169 C101,132 196,187 304,168 C407,149 447,105 535,119 C640,136 690,171 791,150 C897,128 960,111 1063,129 C1142,143 1186,136 1220,124" />
                      <path className="wave-line line-three" d="M-20,180 C102,151 201,195 316,180 C422,164 454,125 544,136 C650,150 698,181 803,163 C906,145 979,133 1072,145 C1153,156 1189,151 1220,144" />
                      <g className="wave-sparks"><circle cx="83" cy="146" r="2"/><circle cx="218" cy="166" r="1.6"/><circle cx="414" cy="119" r="2.4"/><circle cx="535" cy="96" r="1.6"/><circle cx="738" cy="145" r="2.4"/><circle cx="961" cy="105" r="1.6"/><circle cx="1111" cy="120" r="2.5"/></g>
                    </svg>
                    <svg className="hero-bottom-ribbon" viewBox="0 0 1200 100" preserveAspectRatio="none" focusable="false">
                      <path fill="#27b96c" d="M0 62 C240 130 440 78 650 30 C850 -10 1040 20 1200 56 L1200 100 H0Z" />
                      <path fill="#10896e" d="M410 100 C700 44 910 -25 1200 30 L1200 100Z" />
                    </svg>
                    <svg className="hero-luminous-lines" viewBox="0 0 1200 600" preserveAspectRatio="none" focusable="false">
                      <defs>
                        <linearGradient id="hero-lime-light" x1="0" y1="0" x2="1" y2="0">
                          <stop stopColor="#9dff24" stopOpacity=".5" />
                          <stop offset=".35" stopColor="#bcff38" />
                          <stop offset=".65" stopColor="#e6ff9b" />
                          <stop offset="1" stopColor="#a3ff12" stopOpacity=".75" />
                        </linearGradient>
                        <filter id="hero-lime-glow" x="-10%" y="-50%" width="120%" height="200%">
                          <feGaussianBlur stdDeviation="4" />
                        </filter>
                        <path id="hero-crest-line" pathLength="1000" d="M0 537 C280 592 580 452 740 392 S1030 342 1200 452" />
                      </defs>
                      <g fill="none" stroke="url(#hero-lime-light)">
                        <use className="hero-crest-halo" href="#hero-crest-line" strokeWidth="15" opacity=".65" filter="url(#hero-lime-glow)" />
                        <use href="#hero-crest-line" strokeWidth="3" />
                        <use href="#hero-crest-line" stroke="#f3ffd1" strokeWidth=".9" />
                        {Array.from({length: 8}, (_, i) => <use key={i} href="#hero-crest-line" transform={`translate(0, ${-8-i*5})`} strokeWidth=".7" opacity={.4-i*.04} />)}
                        <use className="hero-crest-flow flow-glow" href="#hero-crest-line" stroke="#c5ff32" strokeWidth="10" filter="url(#hero-lime-glow)" />
                        <use className="hero-crest-flow" href="#hero-crest-line" stroke="#f4ffd4" strokeWidth="3.5" />
                      </g>
                      <g fill="#dfff80" className="hero-crest-sparks">
                        {[[65,538],[182,543],[309,516],[430,484],[546,437],[657,407],[770,370],[893,355],[1037,378],[1140,409]].map(([cx,cy], i) => <circle key={cx} cx={cx} cy={cy} r={i%3===0 ? 2.5 : 1.5} />)}
                      </g>
                    </svg>
                    </div>
                    <div className="home-copy">
                      <div className="home-kicker"><span className="pulse-dot" /> NỀN TẢNG THẤU HIỂU THƯƠNG HIỆU</div>
                      <h1>Đánh thức nhịp<br /><em>đập thương hiệu</em><br />của bạn.</h1>
                      <p>
                        Theo dõi các cuộc trò chuyện công khai, hiểu cảm xúc khách hàng và phát hiện tín hiệu cần phản hồi đúng lúc.
                      </p>
                      <div className="home-actions">
                        <button type="button" className="button primary home-primary" onClick={() => navigate("overview")}>
                          Vào bảng điều khiển <ArrowRight size={17} />
                        </button>
                        <button type="button" className="button outline home-secondary" onClick={showWorkflow}>
                          <span className="play-icon">▶</span> Xem quy trình
                        </button>
                      </div>
                      <div className="home-trust"><ShieldCheck size={16} /> Chỉ xử lý dữ liệu công khai từ TikTok Web</div>
                    </div>
                    <div className="hero-visual" aria-label="Minh hoạ dữ liệu thương hiệu theo thời gian thực">
                      <div className="scene-orbit orbit-a" /><div className="scene-orbit orbit-b" />
                      <div className="float-cube cube-a"><MessageCircle size={15}/></div>
                      <div className="float-cube cube-b">#</div>
                      <div className="float-cube cube-c"><Activity size={15}/></div>
                      <div className="dashboard-drop">
                      <div className="dashboard-3d">
                        <div className="dashboard-top"><span><span className="pulse-dot" /> LIVE INSIGHT</span><span>● ● ●</span></div>
                        <div className="dashboard-grid">
                          <div className="dashboard-chart">
                            <small>Tín hiệu thương hiệu</small>
                            <strong>+{fmt(data.posts.length)}</strong>
                            <div className="chart-wave"><i /><i /><i /><i /><i /><i /><i /></div>
                          </div>
                          <div className="dashboard-score"><span>Độ phủ</span><b>{Math.min(99, Math.max(42, data.posts.length + 42))}%</b><i /></div>
                          <div className="dashboard-bars"><small>Xu hướng</small><div><i /><i /><i /><i /><i /></div></div>
                        </div>
                        <div className="dashboard-footer"><span><Activity size={14}/> Đang lắng nghe</span><b>{fmt(data.comments.length)} bình luận</b></div>
                      </div>
                      </div>
                      <div className="scene-base"><i /><i /><i /></div>
                    </div>
                  </div>

                  <div className="home-lower">
                  <div className="home-stats">
                    <div><span className="stat-icon"><MessageCircle size={20}/></span><b>{fmt(data.posts.length)}</b><span>Bài viết theo dõi</span></div>
                    <div><span className="stat-icon"><Activity size={20}/></span><b>{fmt(data.comments.length)}</b><span>Bình luận phân tích</span></div>
                    <div><span className="stat-icon"><Bell size={20}/></span><b>{activeAlerts.length}</b><span>Tín hiệu cần chú ý</span></div>
                  </div>

                  <section className="home-section" id="giai-phap" aria-labelledby="solutions-title">
                    <div className="home-section-title"><div><span>KHÁM PHÁ NĂNG LỰC</span><h2 id="solutions-title">Lắng nghe sâu hơn.<br /><em>Hiểu thương hiệu rõ hơn.</em></h2></div><p>Kết nối những cuộc trò chuyện rời rạc thành góc nhìn rõ ràng để đội ngũ của bạn hành động đúng lúc.</p></div>
                    <div className="solution-grid">
                      {[[Radio,"Lắng nghe liên tục","Theo dõi bài viết và bình luận công khai theo bộ từ khóa thương hiệu."],[Sparkles,"Hiểu sắc thái","Phân loại cảm xúc tiếng Việt để nhận ra điều đang tạo ra hài lòng hoặc bức xúc."],[ChartNoAxesCombined,"Nhìn ra xu hướng","Tổng hợp tín hiệu thành biểu đồ và cảnh báo để đội ngũ ưu tiên đúng việc."]].map(([Icon,title,text],i)=><article className="solution-card" key={title}><span>0{i+1} / {['LẮNG NGHE','THẤU HIỂU','HÀNH ĐỘNG'][i]}</span><div className={`solution-art solution-art-${i}`} aria-hidden="true"><div className="solution-orbit"/><div className="solution-icon"><Icon size={42}/></div><i/><i/><i/><svg viewBox="0 0 300 90" fill="none"><path d={['M0 60H65L85 35L105 76L130 15L150 60H300','M0 70C65 70 65 20 120 35S210 85 300 15','M0 80L60 65L105 73L155 38L200 48L260 10L300 18'][i]} /></svg></div><h3>{title}</h3><p>{text}</p><button className="solution-link" type="button" onClick={() => navigate(['feed','overview','overview'][i])}>Khám phá <ArrowRight size={16}/></button></article>)}
                    </div>
                  </section>

                  <section className="home-section home-workflow" id="quy-trinh" tabIndex={-1} aria-labelledby="workflow-title">
                    <div className="home-section-title"><span>QUY TRÌNH HỆ THỐNG</span><h2 id="workflow-title">Từ tín hiệu công khai đến quyết định chủ động</h2></div>
                    <div className="flow-grid">
                      {[
                        [Search, "01", "Quét từ khóa", "Tự động tìm các bài viết công khai nhắc đến thương hiệu."],
                        [Globe, "02", "Thu thập dữ liệu", "Lưu bài viết, chỉ số tương tác và bình luận công khai."],
                        [Sparkles, "03", "Phân tích AI", "Phân loại cảm xúc tiếng Việt và nhận diện tín hiệu tiêu cực."],
                        [Bell, "04", "Cảnh báo sớm", "Thông báo khi mức tiêu cực hoặc độ lan truyền tăng bất thường."],
                      ].map(([Icon, number, title, text]) => <article className="flow-card" key={number}><span>{number}</span><Icon size={22}/><h3>{title}</h3><p>{text}</p></article>)}
                    </div>
                  </section>

                  <section className="home-cta" id="tinh-nang">
                    <div><span>SẴN SÀNG LẮNG NGHE</span><h2>Thương hiệu của bạn đang được nói đến như thế nào?</h2><p>Bắt đầu từ Bảng điều khiển để xem dữ liệu và kiểm soát lịch quét theo từ khóa.</p></div>
                    <button type="button" className="button primary" aria-controls="quy-trinh" onClick={showWorkflow}>Xem quy trình <ArrowRight size={17}/></button>
                  </section>
                  </div>
                </section>
              )}
              {tab === "overview" && (
                <>
                  <div className="metrics">
                    {[
                      [
                        MessageCircle,
                        "Lượt nhắc đến",
                        data.posts.length,
                        "Bài viết trong khoảng đã chọn",
                        "mint",
                      ],
                      [
                        Video,
                        "Tổng lượt xem",
                        data.posts.some(p=>p.views!=null)?data.posts.reduce((n, p) => n + (p.views||0), 0):'—',
                        `Có chỉ số ở ${data.posts.filter(p=>p.views!=null).length}/${data.posts.length} bài`,
                        "blue",
                      ],
                      [
                        ChartNoAxesCombined,
                        "Cảm xúc tích cực",
                        `${data.posts.length ? Math.round((counts.positive / data.posts.length) * 100) : 0}%`,
                        `${counts.positive} bài viết có cảm xúc tích cực`,
                        "green",
                      ],
                      [
                        ShieldCheck,
                        "Cảnh báo đang mở",
                        activeAlerts.length,
                        "Theo dõi để phản hồi kịp thời",
                        "orange",
                      ],
                    ].map(([Icon, label, value, sub, color]) => (
                      <div className="metric-card" key={label}>
                        <div className="metric-top">
                          <span>{label}</span>
                          <span className={"metric-icon " + color}>
                            <Icon size={19} />
                          </span>
                        </div>
                        <strong>
                          {typeof value === "number" ? fmt(value) : value}
                        </strong>
                        <div className="metric-footer">
                          <span className={"tiny-dot " + color} />
                          {sub}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="charts-grid">
                    <section className="card trend-card">
                      <div className="card-heading">
                        <div>
                          <h2>Xu hướng thảo luận</h2>
                          <p>Nhịp đập thương hiệu theo thời gian</p>
                        </div>
                        <span className="subtle-tag">Theo ngày</span>
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i className="legend-dot green" />
                          Tổng nhắc đến
                        </span>
                        <span>
                          <i className="legend-dot coral" />
                          Tiêu cực
                        </span>
                      </div>
                      <div className="chart-box">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={trend}
                            margin={{
                              top: 10,
                              right: 16,
                              left: -25,
                              bottom: 0,
                            }}
                          >
                            <defs>
                              <linearGradient
                                id="greenFill"
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor="#167047"
                                  stopOpacity={0.18}
                                />
                                <stop
                                  offset="100%"
                                  stopColor="#167047"
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              strokeDasharray="3 5"
                              vertical={false}
                              stroke="#e9eeeb"
                            />
                            <XAxis
                              dataKey="date"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 11, fill: "#8b9892" }}
                              dy={10}
                            />
                            <YAxis
                              allowDecimals={false}
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 11, fill: "#8b9892" }}
                            />
                            <Tooltip
                              contentStyle={{
                                borderRadius: 12,
                                border: "1px solid #e4eae6",
                                fontSize: 12,
                              }}
                            />
                            <Area
                              name="Tổng nhắc đến"
                              type="monotone"
                              dataKey="total"
                              stroke="#13683f"
                              strokeWidth={2.5}
                              fill="url(#greenFill)"
                            />
                            <Area
                              name="Tiêu cực"
                              type="monotone"
                              dataKey="negative"
                              stroke="#f06b19"
                              strokeWidth={2}
                              fill="transparent"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                    <section className="card sentiment-card">
                      <div className="card-heading">
                        <div>
                          <h2>Sắc thái cảm xúc</h2>
                          <p>Phân bố cảm xúc bài viết</p>
                        </div>
                        <span className="info-icon">i</span>
                      </div>
                      <div className="donut-wrap">
                        <div
                          className="donut"
                          style={{
                            background: data.posts.length
                              ? `conic-gradient(#27876f 0 ${(counts.positive / data.posts.length) * 100}%, #edb9a2 ${(counts.positive / data.posts.length) * 100}% ${((counts.positive + counts.negative) / data.posts.length) * 100}%, #dbe3df 0 100%)`
                              : "#dbe3df",
                          }}
                        >
                          <div>
                            <span>TỔNG NHẮC ĐẾN</span>
                            <strong>{fmt(data.posts.length)}</strong>
                            <small>cuộc trò chuyện</small>
                          </div>
                        </div>
                      </div>
                      <div className="sentiment-list">
                        {Object.entries(labels).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => {
                              setTab("feed");
                              setSentiment(key);
                            }}
                          >
                            <span>
                              <i className={"legend-dot " + key} />
                              {label}
                            </span>
                            <b>
                              {data.posts.length
                                ? Math.round(
                                    (counts[key] / data.posts.length) * 100,
                                  )
                                : 0}
                              % <small>{counts[key]}</small>
                            </b>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                  <div className="insight-strip">
                    <div className="insight-icon">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <b>Góc nhìn từ dữ liệu</b>
                      <p>
                        {data.posts.length
                          ? `${current?.name} có ${counts.negative} bài viết tiêu cực trong ${days} ngày qua. Theo dõi nội dung để hiểu rõ ngữ cảnh trước khi phản hồi.`
                          : "Chưa có dữ liệu. Thu thập bài công khai hoặc nạp bộ dữ liệu minh họa để khám phá dashboard."}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        navigate(data.posts.length ? "feed" : "crawler")
                      }
                    >
                      Khám phá <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {(tab === "overview" || tab === "feed") && (
                <section className="card feed-card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        Nguồn nhắc đến gần đây{" "}
                        <span className="count-badge">{data.posts.length}</span>
                      </h2>
                      <p>Những cuộc trò chuyện đang định hình thương hiệu</p>
                    </div>
                    {tab === "overview" && (
                      <button
                        className="text-button"
                        onClick={() => navigate("feed")}
                      >
                        Xem tất cả <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                  <div className="table-controls">
                    <div className="sentiment-tabs">
                      {[["all", "Tất cả"], ...Object.entries(labels)].map(
                        ([key, label]) => (
                          <button
                            className={sentiment === key ? "selected" : ""}
                            onClick={() => setSentiment(key)}
                            key={key}
                          >
                            {label}
                          </button>
                        ),
                      )}
                    </div>
                    <label className="search">
                      <Search size={15} />
                      <input
                        placeholder="Tìm nội dung, tác giả…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>NỘI DUNG BÀI VIẾT</th>
                          <th>CẢM XÚC</th>
                          <th>LƯỢT XEM</th>
                          <th>TƯƠNG TÁC</th>
                          <th>THỜI GIAN</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered
                          .slice(0, tab === "overview" ? 5 : 100)
                          .map((p) => (
                            <tr key={p.id}>
                              <td>
                                <button
                                  className="post-content"
                                  onClick={() =>
                                    setModal({ type: "post", post: p })
                                  }
                                >
                                  <div
                                    className={"post-thumb thumb-" + (p.id % 4)}
                                  >
                                    <Video size={19} />
                                    <span>♪</span>
                                  </div>
                                  <div>
                                    <b>{p.caption}</b>
                                    <small>
                                      @{p.author} <span>·</span>{" "}
                                      {p.source === "demo" ? (
                                        <em>DEMO</em>
                                      ) : (
                                        "TikTok"
                                      )}
                                    </small>
                                  </div>
                                </button>
                              </td>
                              <td>
                                <span
                                  className={"sentiment-badge " + p.sentiment}
                                >
                                  <i />
                                  {labels[p.sentiment]}
                                </span>
                              </td>
                              <td className="number-cell">{fmt(p.views)}</td>
                              <td className="number-cell">
                                {fmt(p.likes)} <small>thích</small>
                              </td>
                              <td className="date-cell">
                                {new Date(p.created_at).toLocaleDateString(
                                  "vi-VN",
                                  { day: "2-digit", month: "2-digit" },
                                )}
                                <small>
                                  {new Date(p.created_at).toLocaleTimeString(
                                    "vi-VN",
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </small>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label="Xem chi tiết bài viết"
                                  onClick={() =>
                                    setModal({ type: "post", post: p })
                                  }
                                >
                                  <ArrowUpRight size={17} />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {filtered.length === 0 && (
                    <div className="empty">
                      <MessageCircle size={28} />
                      <b>Chưa có cuộc trò chuyện nào</b>
                      <p>Thử đổi bộ lọc hoặc nạp dữ liệu minh họa.</p>
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() =>
                          action(
                            () => api("/demo", { brand_id: brandId }),
                            "Đã nạp dữ liệu minh họa",
                          )
                        }
                      >
                        Nạp dữ liệu demo
                      </button>
                    </div>
                  )}
                  <div className="table-footer">
                    Hiển thị{" "}
                    {Math.min(filtered.length, tab === "overview" ? 5 : 100)} /{" "}
                    {filtered.length} bài viết{" "}
                    <span>
                      <span className="live-dot" /> Làm mới mỗi 15 giây
                    </span>
                  </div>
                </section>
              )}
              {tab === "tickets" && <TicketDesk brandId={brandId} notify={setToast} refreshDashboard={refresh} />}
              {tab === "analytics" && <SLAReport brandId={brandId} notify={setToast} />}
              {tab === "alerts" && (
                <section className="card padded">
                  <h2>Trung tâm cảnh báo</h2>
                  <p className="muted">
                    Cảnh báo phát sinh từ bình luận thực thu thập trong một giờ,
                    tối thiểu 5 bình luận. Dữ liệu demo không kích hoạt cảnh
                    báo.
                  </p>
                  {data.alerts.length === 0 ? (
                    <div className="empty">
                      <ShieldCheck size={38} />
                      <b>Chưa có cảnh báo</b>
                      <p>
                        Ngưỡng hiện tại: trên {current?.threshold}% bình luận
                        tiêu cực.
                      </p>
                    </div>
                  ) : (
                    data.alerts.map((a) => (
                      <div className="alert-row" key={a.id}>
                        <div className="metric-icon orange">
                          <Bell size={20} />
                        </div>
                        <div>
                          <b>{a.reason}</b>
                          <small>
                            {new Date(a.created_at).toLocaleString("vi-VN")}
                          </small>
                          <small>{a.delivery}</small>
                        </div>
                        {a.status === "open" ? (
                          <button
                            className="button outline"
                            onClick={() =>
                              action(
                                () => api("/alerts/" + a.id, {}, "PATCH"),
                                "Đã đánh dấu xử lý",
                              )
                            }
                          >
                            Đánh dấu đã xử lý
                          </button>
                        ) : (
                          <span className="sentiment-badge positive">
                            <Check size={14} />
                            Đã xử lý
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </section>
              )}
              {tab === "brands" && (
                <>
                  <div className="section-toolbar">
                    <h2>{brands.length} thương hiệu trong workspace</h2>
                    <button
                      className="button primary"
                      onClick={() => setModal({ type: "brand" })}
                    >
                      <Plus size={16} />
                      Thêm thương hiệu
                    </button>
                  </div>
                  <div className="brand-grid">
                    {brands.map((b, i) => (
                      <section className="card brand-card" key={b.id}>
                        <div className={"brand-avatar brand-" + (i % 3)}>
                          {b.name[0]}
                        </div>
                        <h2>{b.name}</h2>
                        <p>{b.keywords}</p>
                        <div>
                          <span className="live-dot" />
                          Ngưỡng cảnh báo: {b.threshold}%
                        </div>
                        <button
                          className="button outline"
                          onClick={() => {
                            setBrandId(b.id);
                            navigate("overview");
                          }}
                        >
                          Xem tổng quan <ArrowRight size={16} />
                        </button>
                      </section>
                    ))}
                  </div>
                </>
              )}
              {tab === "crawler" && (
                <section className="card padded">
                  <div className="card-heading">
                    <div>
                      <h2>Thu thập TikTok công khai</h2>
                      <p>
                        Python Playwright → Node.js → Python NLP → Bảng điều khiển
                      </p>
                    </div>
                    <Globe size={25} />
                  </div>
                  <div className="pipeline">
                    {[
                      "TikTok Public Web",
                      "Playwright Crawler",
                      `Node.js + ${health.database === 'postgres' ? 'PostgreSQL' : health.database === 'mysql' ? 'MySQL' : health.database === 'sqlite' ? 'SQLite' : 'Database'}`,
                      "Python Sentiment",
                    ].map((s, i) => (
                      <React.Fragment key={s}>
                        <div>
                          <span>0{i + 1}</span>
                          <b>{s}</b>
                        </div>
                        {i < 3 && <ArrowRight size={20} />}
                      </React.Fragment>
                    ))}
                  </div>
                  <p className="muted">
                    Crawler tự tìm theo từ khóa thương hiệu, cuộn kết quả, mở từng video rồi tải bình luận và phản hồi công khai. Giới hạn mỗi lượt được cấu hình bên dưới. Khi bị yêu cầu xác minh, tác vụ dừng và ghi lại lý do.
                  </p>
                  <CrawlSettings key={brandId} brandId={brandId} notify={setToast}/>
                  <div className="crawler-actions">
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() =>
                        action(
                          () => api("/demo", { brand_id: brandId }),
                          "Đã nạp dữ liệu demo",
                        )
                      }
                    >
                      <Sparkles size={16} />
                      Nạp bộ dữ liệu minh họa
                    </button>
                    <span className="muted">
                      NLP:{" "}
                      {health.nlp
                        ? "đang hoạt động · bộ từ khóa tiếng Việt"
                        : "chưa kết nối cổng 8001"}
                    </span>
                  </div>
                  <details><summary className="muted">Tùy chọn bổ sung: thu thập một số URL cụ thể</summary><form onSubmit={e=>{e.preventDefault();const urls=videoLinks.split(/\s+/).filter(Boolean);action(()=>api('/crawl',{brand_id:brandId,urls}),'Đã bắt đầu đọc bài và bình luận trực tiếp từ TikTok.');setSource('live');}}>
                    <label>Nhập video TikTok thật<textarea value={videoLinks} onChange={e=>setVideoLinks(e.target.value)} placeholder="https://www.tiktok.com/@tacgia/video/123456789…" required rows={4}/><small>Tối đa 10 link đầy đủ, mỗi dòng một link. Chỉ nhập các video liên quan thương hiệu đang chọn. Không nhập link rút gọn.</small></label>
                    <button className="button primary" disabled={busy||data.jobs.some(j=>j.status==='running')}><Download size={16}/>Lấy dữ liệu thật từ link</button>
                    <p className="muted">Đọc caption, tác giả, lượt xem/thích và tổng bình luận từ metadata TikTok. Tổng bình luận không phải số bình luận đã tải. Nếu trang tìm kiếm không trả kết quả cho crawler, dùng link video trực tiếp. Link không truy cập được sẽ được báo lỗi, không tạo bản ghi giả.</p>
                  </form></details>
                  <CrawlHistory key={brandId} brandId={brandId} revision={data.jobs} refresh={refresh} notify={setToast}/>
                </section>
              )}
              {tab === "settings" && current && (
                <div className="settings-layout">
                  <SettingsPanel
                    key={current.id + current.threshold + current.keywords}
                    current={current}
                    busy={busy}
                    save={(body) =>
                      action(
                        () => api("/brands/" + brandId, body, "PATCH"),
                        "Đã lưu cấu hình cảnh báo",
                      )
                    }
                  />
                  <ChannelsPanel
                    current={current}
                    busy={busy}
                    save={(body) =>
                      action(
                        () =>
                          api(
                            "/brands/" + brandId + "/channels",
                            body,
                            "PATCH",
                          ),
                        "Đã lưu kênh nhận thông báo",
                      )
                    }
                  />
                </div>
              )}
            </>
          )}
          <footer>
            <span>
              <Activity size={14} /> Nhịp đập thương hiệu{" "}
              <span className="footer-separator">/</span> Hiểu đúng tín hiệu.
              Chủ động tương lai.
            </span>
            <span>Đồ án Social Listening · v1.0</span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Đóng thông báo" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal.type === "brand" ? "Thêm thương hiệu" : "Chi tiết bài viết"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Đóng"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal.type === "brand" ? (
              <BrandForm
                busy={busy}
                submit={(body) =>
                  action(async () => {
                    const b = await api("/brands", body);
                    setBrandId(b.id);
                    setModal(null);
                  }, "Đã thêm thương hiệu")
                }
              />
            ) : (
              <>
                <span className={"sentiment-badge " + modal.post.sentiment}>
                  {labels[modal.post.sentiment]}
                </span>
                <h2 className="post-title">{modal.post.caption}</h2>
                <p className="muted">
                  @{modal.post.author} · {fmt(modal.post.views)} lượt xem ·{" "}
                  {modal.post.source === "demo"
                    ? "Dữ liệu minh họa"
                    : "Dữ liệu công khai"}
                </p>
                {modal.post.video_url && (
                  <a
                    className="button outline"
                    href={modal.post.video_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Mở trên TikTok <ExternalLink size={15} />
                  </a>
                )}
                {modal.post.source==='live'&&<div className="setting-explanation" style={{marginTop:16}}><div><b>Nguồn xác minh: TikTok</b><p>ID: {modal.post.video_id}<br/>Thu thập: {new Date(modal.post.observed_at||modal.post.created_at).toLocaleString('vi-VN')}<br/>Ngày đăng: {modal.post.published_at?new Date(modal.post.published_at).toLocaleString('vi-VN'):'Chưa có'}<br/>Phương thức: {modal.post.collection_method||'public web'}<br/>Tổng bình luận trên TikTok: {fmt(modal.post.comment_count)} · Đã tải: {data.comments.filter(c=>c.post_id===modal.post.id).length}</p></div></div>}
                <h3>Bình luận đã thu thập</h3>
                <div className="comments">
                  {data.comments
                    .filter((c) => c.post_id === modal.post.id)
                    .map((c) => (
                      <div className="comment" key={c.id}>
                        <b>@{c.author}</b>
                        {c.parent_id&&<small className="muted"> · Phản hồi bình luận #{c.parent_id}</small>}
                        <p>{c.text}</p>
                        {modal.post.source==='live'&&<p className="muted">{fmt(c.like_count)} lượt thích · {c.published_at?new Date(c.published_at).toLocaleString('vi-VN'):'Chưa có ngày đăng'} · ID {c.id}</p>}
                        <span className={"sentiment-badge " + c.sentiment}>
                          {labels[c.sentiment]}
                        </span>
                      </div>
                    ))}
                  {!data.comments.some((c) => c.post_id === modal.post.id) && (
                    <p className="muted">
                      Chưa thu thập được bình luận công khai cho bài viết này.
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function BrandForm({ submit, busy }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        submit({
          name: d.get("name"),
          keywords: d.get("keywords"),
          threshold: Number(d.get("threshold")),
        });
      }}
    >
      <span className="eyebrow">MỞ RỘNG GÓC NHÌN</span>
      <h2>Thêm thương hiệu</h2>
      <label>
        Tên thương hiệu
        <input
          name="name"
          placeholder="Ví dụ: Nhà sách Fahasa"
          maxLength={100}
          required
          autoFocus
        />
      </label>
      <label>
        Từ khóa theo dõi
        <input
          name="keywords"
          placeholder="Fahasa, nhà sách Fahasa"
          maxLength={500}
          required
        />
      </label>
      <label>
        Ngưỡng tiêu cực (%)
        <input
          name="threshold"
          type="number"
          min={1}
          max={100}
          defaultValue={40}
          required
        />
      </label>
      <button className="button primary" disabled={busy}>
        Thêm thương hiệu <Plus size={16} />
      </button>
    </form>
  );
}
function SettingsPanel({ current, save, busy }) {
  const [threshold, setThreshold] = useState(current.threshold);
  return (
    <section className="card padded settings-panel">
      <div className="settings-card-heading"><span className="settings-step">01</span><div><h2>Điều kiện cảnh báo</h2><p>Thiết lập riêng cho {current.name}</p></div><ShieldCheck size={24}/></div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({
            keywords: new FormData(e.currentTarget).get("keywords"),
            threshold,
          });
        }}
      >
        <label>
          Từ khóa theo dõi
          <textarea
            name="keywords"
            defaultValue={current.keywords}
            required
            maxLength={500}
          />
          <small>
            Phân tách các từ khóa bằng dấu phẩy. Ví dụ: VinFast, VF 3, VF 8.
          </small>
        </label>
        <label>
          Ngưỡng bình luận tiêu cực{" "}
          <strong className="threshold-value">{threshold}%</strong>
          <div className="threshold-control">
            <input
              aria-label="Ngưỡng phần trăm tiêu cực"
              type="range"
              min="1"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
            <input
              aria-label="Nhập ngưỡng phần trăm"
              className="threshold-input"
              type="number"
              min="1"
              max="100"
              value={threshold}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value)) setThreshold(Math.max(1, Math.min(100, value)));
              }}
            />
          </div>
          <small>Kéo thanh hoặc nhập trực tiếp từ 1 đến 100%.</small>
        </label>
        <div className="setting-explanation">
          <ShieldCheck size={20} />
          <p>
            Kích hoạt khi tỷ lệ tiêu cực <b>vượt {threshold}%</b> trong 1 giờ,
            với tối thiểu 5 bình luận. Giới hạn một cảnh báo mỗi thương hiệu mỗi
            giờ.
          </p>
        </div>
        <button className="button primary" disabled={busy}>
          <Check size={16} />
          Lưu điều kiện cảnh báo
        </button>
      </form>
    </section>
  );
}
function ChannelsPanel({ current, busy, save }) {
  return (
    <section className="card padded settings-panel channels-panel">
      <div className="settings-card-heading"><span className="settings-step">02</span><div><h2>Kênh nhận thông báo</h2><p>Nhận tin ở nơi thuận tiện với bạn</p></div><Bell size={24}/></div>
      <div className="channel settings-app-channel"><Bell size={20}/><div><b>Trong ứng dụng</b><small>Tự động làm mới mỗi 15 giây</small></div><span className="channel-enabled"><Check size={12}/> Đang bật</span></div>
      <div className="settings-channel-divider"><span>KÊNH BỔ SUNG</span><small>Không bắt buộc</small></div>
      <form
        key={current.id}
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          save({
            email: d.get("email").trim(),
            telegram: d.get("telegram").trim(),
          });
        }}
      >
        <label>
          Email nhận cảnh báo
          <input
            name="email"
            type="email"
            maxLength={254}
            defaultValue={current.email || ""}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Telegram Chat ID
          <input
            name="telegram"
            pattern="-?[0-9]{1,30}"
            defaultValue={current.telegram || ""}
            placeholder="Ví dụ: -100123456789"
          />
        </label>
        <p className="muted">
          Để trống để tắt kênh tương ứng. Chỉ gửi thông báo khi có cảnh báo mới từ dữ liệu thật.
        </p>
        <details className="channel-help"><summary>Điều kiện gửi Email và Telegram</summary><p>Máy chủ cần được kết nối với dịch vụ Email và bot Telegram. Liên hệ quản trị viên nếu bạn đã lưu địa chỉ nhưng chưa nhận được tin.</p></details>
        <button className="button primary" disabled={busy}>
          <Check size={16} />
          Lưu kênh thông báo
        </button>
      </form>
    </section>
  );
}
const stopLabels={post_limit:'Đạt giới hạn bài/lượt',comment_limit:'Đạt giới hạn bình luận',scroll_limit:'Đạt giới hạn cuộn',no_new_results:'Không tải thêm kết quả',end_of_search_response:'TikTok báo hết trang tìm kiếm',end_of_public_comments:'TikTok báo hết trang bình luận công khai',no_more_loaded:'Không tải thêm bình luận',comments_unavailable:'Không tải được bình luận',page_error:'Lỗi trang',access_required:'Cần đăng nhập/xác minh',not_loaded:'Chưa tải'};
function JobReport({job}){let r;try{r=JSON.parse(job.report);}catch{}if(!r)return null;return <div className="job-report"><p><b>{r.mode==='keywords'?'Tìm theo từ khóa':'URL tùy chọn'}: {(r.search?.map(s=>s.keyword) || r.keywords)?.join(', ')}</b><br/>{r.discovered} bài phát hiện · {r.saved_posts} bài lưu · {r.saved_comments} bình luận tải · {r.posts_with_comments} bài có bình luận</p><p>Giới hạn: {r.limits?.posts} bài/lượt, {r.limits?.comments_per_post} bình luận/bài. “Hoàn tất lượt” không có nghĩa là đã lấy toàn bộ TikTok.</p><details><summary>Phạm vi dữ liệu từng bài</summary>{r.comment_coverage?.map(c=><p key={c.video_id}>#{c.video_id}: {c.collected}/{c.reported_total??'không rõ'} bình luận · {stopLabels[c.stop_reason]||c.stop_reason}</p>)}</details></div>}
function CrawlHistory({brandId,revision,refresh,notify}) {
  const [checked,setChecked]=useState([]);
  const selectable=job=>job.status!=='running'&&Boolean(job.tracked_job_id)&&!job.deleted_at;
  const [page,setPage]=useState({jobs:[],has_more:false}), [cursors,setCursors]=useState([null]);
  const [loading,setLoading]=useState(true), [error,setError]=useState(''), [selection,setSelection]=useState(null);
  const [previewing,setPreviewing]=useState(null), [deleting,setDeleting]=useState(false);
  const dialog=useRef(null), alive=useRef(true), trigger=useRef(null);
  const before=cursors[cursors.length-1];
  useEffect(()=>{setChecked([]);},[brandId,before]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false};},[]);
  useEffect(()=>{
    let current=true;
    setLoading(true);setError('');
    api(`/brands/${brandId}/jobs${before?`?before=${before}`:''}`).then(result=>{if(current)setPage(result);})
      .catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false};
  },[brandId,before,revision]);
  useEffect(()=>{
    if(selection) dialog.current?.showModal();
    else {dialog.current?.close();trigger.current?.focus();}
  },[selection]);
  async function review(job,event) {
    trigger.current=event.currentTarget;
    setPreviewing(job.id);
    try { const summary=await api(`/jobs/${job.id}/data`); if(alive.current)setSelection({job,summary}); }
    catch(e){notify(e.message);}
    finally{if(alive.current)setPreviewing(null);}
  }
  async function reviewMany(event) {
    trigger.current=event.currentTarget;
    setPreviewing('bulk');
    try {
      const jobs=page.jobs.filter(job=>checked.includes(job.id)&&selectable(job));
      const summaries=await Promise.all(jobs.map(job=>api(`/jobs/${job.id}/data`)));
      if(alive.current&&jobs.length)setSelection({jobs,summaries});
    } catch(e){notify(e.message);}
    finally{if(alive.current)setPreviewing(null);}
  }
  async function remove() {
    setDeleting(true);
    if(selection.jobs) {
      const done=[],failed=[];
      let posts=0,comments=0;
      for(const job of selection.jobs) {
        try {
          const result=await api(`/jobs/${job.id}/data`,{confirm_job_id:job.id},'DELETE');
          done.push(job.id);posts+=result.posts;comments+=result.comments;
        } catch(e){failed.push(`#${job.id}: ${e.message}`);}
      }
      if(alive.current){setChecked(ids=>ids.filter(id=>!done.includes(id)));setSelection(null);setDeleting(false);}
      notify(`Đã xoá dữ liệu ${done.length}/${selection.jobs.length} lượt: ${posts} bài, ${comments} bình luận.${failed.length?' Chưa xoá: '+failed.join('; '):''}`);
      if(alive.current&&failed.length)setError('Chưa xoá: '+failed.join('; '));
      await refresh();
      return;
    }
    try {
      const result=await api(`/jobs/${selection.job.id}/data`,{confirm_job_id:selection.job.id},'DELETE');
      notify(`Đã xoá ${result.posts} bài và ${result.comments} bình luận của lượt #${selection.job.id}.`);
      if(alive.current)setSelection(null);
      await refresh();
    } catch(e){notify(e.message);}
    finally{if(alive.current)setDeleting(false);}
  }
  return <div className="crawl-history">
    <h2 className="jobs-heading">Lịch sử thu thập</h2>
    <p className="muted">Xoá dữ liệu riêng của một lượt quét đã kết thúc. Dữ liệu dùng chung với lượt khác được giữ lại.</p>
    <div className="job-data-actions">
      <label><input type="checkbox" aria-label="Chọn tất cả lượt có thể xoá trên trang" disabled={loading||deleting||previewing!==null||!page.jobs.some(selectable)} checked={page.jobs.some(selectable)&&page.jobs.filter(selectable).every(job=>checked.includes(job.id))} onChange={e=>setChecked(e.target.checked?page.jobs.filter(selectable).map(job=>job.id):[])}/> Chọn tất cả trên trang</label>
      <button type="button" className="button danger-outline" disabled={!checked.length||loading||deleting||previewing!==null} onClick={reviewMany}><Trash2 size={15}/>{previewing==='bulk'?'Đang kiểm tra…':`Xoá dữ liệu các lượt đã chọn (${checked.length})`}</button>
    </div>
    {error&&<p role="alert">{error}</p>}
    {loading&&!page.jobs.length&&<p role="status">Đang tải lịch sử…</p>}
    {!loading&&!error&&!page.jobs.length&&<div className="empty">Chưa có tác vụ nào. Chọn “Thu thập ngay” để bắt đầu.</div>}
    {page.jobs.map(job=><div className="job" key={job.id}>
      <span className={'job-status '+job.status}>{job.status==='running'?'Đang chạy':job.status==='completed'?'Hoàn tất lượt':job.status==='partial'?'Dữ liệu một phần':'Không thành công'}</span>
      <div className="job-content">
        <label><input type="checkbox" aria-label={`Chọn lượt #${job.id}`} disabled={!selectable(job)||deleting||previewing!==null} checked={checked.includes(job.id)} onChange={e=>setChecked(ids=>e.target.checked?[...ids,job.id]:ids.filter(id=>id!==job.id))}/> Chọn lượt này</label>
        <b>Tác vụ #{job.id}</b>
        {job.deleted_at&&<p className="job-data-deleted">Đã xoá dữ liệu lượt này · {new Date(job.deleted_at).toLocaleString('vi-VN')}</p>}
        <JobReport job={job}/>
        <details open={job.status==='running'}><summary>Nhật ký chi tiết</summary><pre>{job.message}</pre></details>
        <small>{new Date(job.created_at).toLocaleString('vi-VN')}</small>
        <div className="job-data-actions">
          <button type="button" className="button danger-outline" aria-label={`Xoá dữ liệu lượt #${job.id}`}
            disabled={job.status==='running'||!job.tracked_job_id||Boolean(job.deleted_at)||previewing!==null||deleting}
            onClick={event=>review(job,event)}><Trash2 size={15}/>{previewing===job.id?'Đang kiểm tra…':'Xoá dữ liệu lượt này'}</button>
          {!job.tracked_job_id&&<small>Lượt cũ chưa ghi liên kết dữ liệu, không thể xoá riêng an toàn.</small>}
          {job.status==='running'&&<small>Chỉ xoá được sau khi lượt quét kết thúc.</small>}
        </div>
      </div>
    </div>)}
    <div className="history-pagination">
      <button type="button" className="button outline" disabled={loading||deleting||previewing!==null||cursors.length===1} onClick={()=>setCursors(c=>c.slice(0,-1))}>Lượt mới hơn</button>
      <span>Trang {cursors.length}</span>
      <button type="button" className="button outline" disabled={loading||deleting||previewing!==null||!page.has_more} onClick={()=>setCursors(c=>[...c,page.jobs.at(-1).id])}>Lượt cũ hơn</button>
    </div>
    <dialog ref={dialog} className="delete-run-dialog" aria-labelledby="delete-run-title" onCancel={event=>{event.preventDefault();if(!deleting)setSelection(null);}}>
      {selection?.jobs&&<>
        <h2 id="delete-run-title">Xoá dữ liệu {selection.jobs.length} lượt đã chọn?</h2>
        <p>Các lượt: {selection.jobs.map(job=>`#${job.id}`).join(', ')}.</p>
        <p>Xoá lần lượt từng lượt đã chọn. Dữ liệu chỉ dùng chung giữa các lượt đã chọn có thể được xoá ở lượt cuối; dữ liệu còn dùng bởi lượt khác hoặc dữ liệu cũ được giữ lại.</p>
        <p>Không thể hoàn tác. Lịch sử tác vụ, cảnh báo và file evidence được giữ lại. Nếu có lượt lỗi, các lượt đã xoá thành công vẫn được giữ kết quả và lỗi sẽ được báo riêng.</p>
        {selection.summaries.filter(s=>!s.can_delete).map(s=><p role="alert" key={s.job_id}>#{s.job_id}: {s.reason}</p>)}
        <div className="delete-run-actions">
          <button type="button" className="button outline" autoFocus disabled={deleting} onClick={()=>setSelection(null)}>Huỷ</button>
          <button type="button" className="button danger" disabled={deleting||selection.summaries.some(s=>!s.can_delete)} onClick={remove}>{deleting?'Đang xoá…':'Xác nhận xoá các lượt đã chọn'}</button>
        </div>
      </>}
      {selection&&!selection.jobs&&<>
        <h2 id="delete-run-title">Xoá dữ liệu lượt #{selection.job.id}?</h2>
        {selection.summary.can_delete?<>
          <p>Sẽ xoá <b>{selection.summary.posts} bài viết</b> và <b>{selection.summary.comments} bình luận</b> chỉ thuộc lượt này.</p>
          <p>Giữ lại {selection.summary.retained_posts} bài và {selection.summary.retained_comments} bình luận dùng chung hoặc đã có từ trước.</p>
          <p>Thao tác không thể hoàn tác trong ứng dụng. Dashboard sẽ cập nhật sau khi xoá. Lịch sử tác vụ, cảnh báo và file evidence được giữ lại; báo cáo quét vẫn thể hiện kết quả ban đầu.</p>
        </>:<p role="status">{selection.summary.reason}</p>}
        <div className="delete-run-actions">
          <button type="button" className="button outline" autoFocus disabled={deleting} onClick={()=>setSelection(null)}>Huỷ</button>
          {selection.summary.can_delete&&<button type="button" className="button danger" disabled={deleting} onClick={remove}>{deleting?'Đang xoá…':'Xác nhận xoá dữ liệu'}</button>}
        </div>
      </>}
    </dialog>
  </div>;
}
function CrawlSettings({brandId,notify}){
 const [value,setValue]=useState(null),[saving,setSaving]=useState(false);
 useEffect(()=>{let alive=true;api(`/brands/${brandId}/schedule`).then(s=>{if(alive)setValue({...s,enabled:Boolean(s.enabled)});}).catch(e=>notify(e.message));return()=>{alive=false};},[brandId]);
 if(!value)return <p className="muted">Đang tải cấu hình quét…</p>;
 return <form className="crawl-settings" onSubmit={async e=>{e.preventDefault();setSaving(true);try{const s=await api(`/brands/${brandId}/schedule`,value,'PUT');setValue({...s,enabled:Boolean(s.enabled)});notify('Đã lưu lịch quét và giới hạn thu thập');}catch(e){notify(e.message);}finally{setSaving(false);}}}>
 <h2>Lịch quét từ khóa tự động</h2><label className="schedule-toggle"><input type="checkbox" checked={value.enabled} onChange={e=>setValue({...value,enabled:e.target.checked})}/>Bật quét định kỳ cho thương hiệu này</label>
 <div className="crawl-fields">{[['interval_minutes','Chu kỳ (phút)',15,1440],['max_posts','Bài tối đa mỗi lượt',1,30],['max_comments','Bình luận tối đa mỗi bài',1,200],['max_scrolls','Lượt cuộn tối đa',1,30]].map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} required value={value[key]} onChange={e=>setValue({...value,[key]:Number(e.target.value)})}/></label>)}</div>
 <p className="muted">Luân phiên từ khóa bắt đầu giữa các lượt; giới hạn bài áp dụng cho cả lượt. Tải bình luận cấp 1 và thử mở phản hồi công khai; không bảo đảm toàn bộ bình luận được TikTok cung cấp. Lịch chỉ chạy khi backend và máy đang bật.</p>
 <p className="muted">Lượt tiếp theo: {value.enabled&&value.next_run_at?new Date(value.next_run_at).toLocaleString('vi-VN'):'Chưa bật hoặc chưa lưu lịch'}</p>
 <button className="button primary" disabled={saving}><Check size={16}/>Lưu lịch quét</button></form>
}
createRoot(document.getElementById("root")).render(<App />);
