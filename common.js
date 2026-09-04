const VERSION = "1.0.0";
const STORAGE_KEYS = {
  articles: "erp_articles",
  movements: "erp_movements",
  productionOrders: "erp_production_orders"
};

function load(key, fallback = []) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function getArticles() { return load(STORAGE_KEYS.articles, []); }
function getMovements() { return load(STORAGE_KEYS.movements, []); }
function getProductionOrders() { return load(STORAGE_KEYS.productionOrders, []); }

function setArticles(v) { save(STORAGE_KEYS.articles, v); }
function setMovements(v) { save(STORAGE_KEYS.movements, v); }
function setProductionOrders(v) { save(STORAGE_KEYS.productionOrders, v); }

function initStorage() {
  if (localStorage.getItem(STORAGE_KEYS.articles) === null) setArticles([]);
  if (localStorage.getItem(STORAGE_KEYS.movements) === null) setMovements([]);
  if (localStorage.getItem(STORAGE_KEYS.productionOrders) === null) setProductionOrders([]);
}

function uid(prefix="ID") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function typeLabel(type) {
  return {raw:"Raw", semi:"Semi-Finished", finished:"Finished"}[type] || type;
}
function articleMap() { return Object.fromEntries(getArticles().map(a => [a.head, a])); }

function addMovement(head, direction, qty, reason, sourceId=null) {
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("Quantity must be a positive whole number.");
  const articles = getArticles();
  const article = articles.find(a => a.head === head);
  if (!article) throw new Error("Article not found.");
  if (direction === "out" && article.qty < qty) {
    throw new Error(`Insufficient stock for ${article.name}: short by ${qty - article.qty}.`);
  }
  article.qty += direction === "in" ? qty : -qty;
  setArticles(articles);
  const movement = {
    id: uid("MOV"), head, direction, qty,
    reason: reason || "Manual adjustment",
    timestamp: new Date().toISOString(),
    sourceId
  };
  const movements = getMovements();
  movements.unshift(movement);
  setMovements(movements);
  return movement;
}

function bomValidation(article, bom) {
  const articles = articleMap();
  for (const [head, qty] of Object.entries(bom)) {
    if (!articles[head]) return `Component ${head} does not exist.`;
    if (!Number.isInteger(qty) || qty <= 0) return `Component quantity for ${head} must be a positive whole number.`;
    const allowed = article.type === "semi" ? ["raw"] : ["raw", "semi"];
    if (!allowed.includes(articles[head].type)) {
      return `${article.type} article ${article.head} cannot use ${articles[head].type} component ${head}.`;
    }
  }
  return null;
}

function canDeleteArticle(head) {
  const articles = getArticles();
  if (getMovements().some(m => m.head === head)) return "This article has stock movement history.";
  if (getProductionOrders().some(o => o.output_head === head)) return "This article has production order history.";
  for (const a of articles) {
    if (a.bom && Object.prototype.hasOwnProperty.call(a.bom, head)) {
      return `Article ${a.head} references this article in its BOM.`;
    }
  }
  return null;
}

function saveArticle(data, editingHead=null) {
  const articles = getArticles();
  const head = data.head.trim();
  const name = data.name.trim();
  if (!head || !name) throw new Error("Head and name are required.");
  if (!["raw","semi","finished"].includes(data.type)) throw new Error("Invalid article type.");
  if (!Number.isInteger(Number(data.qty)) || Number(data.qty) < 0) throw new Error("Stock quantity must be a non-negative whole number.");
  if (data.type === "raw" && (!Number.isInteger(Number(data.min_qty)) || Number(data.min_qty) < 0)) {
    throw new Error("Minimum quantity must be a non-negative whole number.");
  }
  const duplicate = articles.find(a => a.head === head && a.head !== editingHead);
  if (duplicate) throw new Error("Head must be unique.");
  if (editingHead && head !== editingHead) {
    if (getMovements().some(m => m.head === editingHead) ||
        getProductionOrders().some(o => o.output_head === editingHead) ||
        articles.some(a => a.bom && a.bom[editingHead] !== undefined)) {
      throw new Error("Head cannot be changed after the article is referenced or has history.");
    }
  }
  const bom = data.type === "raw" ? {} : data.bom || {};
  const temp = {head, name, type:data.type, qty:Number(data.qty), min_qty:data.type==="raw"?Number(data.min_qty):0, bom};
  const error = bomValidation(temp, bom);
  if (error) throw new Error(error);
  const idx = editingHead ? articles.findIndex(a => a.head === editingHead) : -1;
  if (idx >= 0) articles[idx] = temp; else articles.push(temp);
  setArticles(articles);
  return temp;
}

function runProduction(outputHead, plannedQty, producedQty, scrapQty) {
  const articles = getArticles();
  const output = articles.find(a => a.head === outputHead);
  if (!output) throw new Error("Output article not found.");
  if (output.type === "raw") throw new Error("Raw articles cannot be produced.");
  plannedQty = Number(plannedQty); producedQty = Number(producedQty); scrapQty = Number(scrapQty);
  if (![plannedQty,producedQty,scrapQty].every(Number.isInteger) || plannedQty <= 0 || producedQty < 0 || scrapQty < 0) {
    throw new Error("Quantities must be whole numbers; planned quantity must be positive.");
  }
  if (producedQty + scrapQty !== plannedQty) throw new Error("Produced + scrap must equal planned quantity.");
  const shortages = [];
  for (const [head, perUnit] of Object.entries(output.bom || {})) {
    const component = articles.find(a => a.head === head);
    const required = perUnit * plannedQty;
    if (!component || component.qty < required) {
      shortages.push({
        head, name: component?.name || head,
        required, available: component?.qty || 0, shortfall: required - (component?.qty || 0)
      });
    }
  }
  if (shortages.length) {
    const detail = shortages.map(s => `${s.name}: need ${s.required}, have ${s.available} (short ${s.shortfall})`).join("; ");
    throw new Error(`Production blocked — ${detail}`);
  }

  const order = { id: uid("PO"), output_head: outputHead, planned_qty: plannedQty,
    produced_qty: producedQty, scrap_qty: scrapQty, timestamp: new Date().toISOString() };

  const movements = getMovements();
  for (const [head, perUnit] of Object.entries(output.bom || {})) {
    const required = perUnit * plannedQty;
    const component = articles.find(a => a.head === head);
    component.qty -= required;
    movements.unshift({id:uid("MOV"), head, direction:"out", qty:required,
      reason:`Production ${order.id} — ${output.name}`, timestamp:order.timestamp, sourceId:order.id});
  }
  output.qty += producedQty;
  movements.unshift({id:uid("MOV"), head:outputHead, direction:"in", qty:producedQty,
    reason:`Production ${order.id} — finished output`, timestamp:order.timestamp, sourceId:order.id});
  setArticles(articles);
  setMovements(movements);
  const orders = getProductionOrders();
  orders.unshift(order);
  setProductionOrders(orders);
  return order;
}

function producibleQty(article) {
  const bom = article.bom || {};
  const components = Object.entries(bom);
  if (!components.length) return 0;
  const articlesByHead = articleMap();
  return Math.min(...components.map(([head, qty]) => Math.floor((articlesByHead[head]?.qty || 0) / qty)));
}

function formatDate(iso) {
  return new Date(iso).toLocaleString([], {dateStyle:"medium", timeStyle:"short"});
}

function nav(page) {
  const current = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.getAttribute("href") === current));
}

function toast(message, kind="success") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el);
  }
  el.className = `toast ${kind}`;
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => el.classList.remove("show"), 3200);
}

function renderShell(title, subtitle="") {
  document.title = `${title} · ParasERP`;
  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">P</div><div><strong>Parasnath</strong><small>Electronics</small></div></div>
        <nav>
          <a data-nav href="index.html"><span>⌂</span> Dashboard</a>
          <a data-nav href="articles.html"><span>▦</span> Articles</a>
          <a data-nav href="stock.html"><span>⇄</span> Stock Movements</a>
          <a data-nav href="production.html"><span>⚙</span> Production</a>
        </nav>
        <div class="sidebar-foot"><span class="dot"></span>Version ${VERSION}</div>
      </aside>
      <main class="main">
        <header class="topbar"><div><div class="eyebrow">MANUFACTURING ERP</div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:""}</div><div class="top-actions" id="top-actions"></div></header>
        <section id="page-content"></section>
      </main>
    </div>
  `;
  nav();
}

function injectStyles() {
  const css = `
  :root{--bg:#f5f7fb;--panel:#fff;--ink:#162033;--muted:#687386;--line:#e5e9f0;--accent:#3157d5;--accent2:#eef2ff;--green:#15803d;--greenbg:#ecfdf3;--red:#c2413b;--redbg:#fff1f2;--amber:#b7791f;--amberbg:#fff8e6;--shadow:0 8px 30px rgba(22,32,51,.06)}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px}
  .app-shell{min-height:100vh;display:flex}.sidebar{width:245px;background:#111827;color:#cbd5e1;padding:24px 16px;display:flex;flex-direction:column;position:fixed;inset:0 auto 0 0}.brand{display:flex;align-items:center;gap:11px;color:#fff;padding:4px 10px 30px}.brand strong{display:block;font-size:17px;letter-spacing:-.3px}.brand small{display:block;color:#7f8da3;font-size:10px;margin-top:2px}.brand-mark{width:34px;height:34px;border-radius:10px;background:#3157d5;display:grid;place-items:center;font-weight:800}.sidebar nav{display:grid;gap:5px}.sidebar nav a{color:#9aa7ba;text-decoration:none;padding:11px 12px;border-radius:9px;display:flex;gap:11px;align-items:center;font-weight:600}.sidebar nav a span{width:18px;text-align:center;font-size:16px}.sidebar nav a:hover,.sidebar nav a.active{background:#1f2937;color:#fff}.sidebar nav a.active{box-shadow:inset 3px 0 #6381ff}.sidebar-foot{margin-top:auto;font-size:11px;color:#738197;padding:10px}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#36c275;margin-right:7px}
  .main{margin-left:245px;width:calc(100% - 245px);padding:0 38px 48px}.topbar{padding:31px 0 25px;display:flex;justify-content:space-between;align-items:flex-end}.eyebrow{font-size:10px;letter-spacing:1.5px;color:#8090a6;font-weight:800;margin-bottom:6px}.topbar h1{margin:0;font-size:27px;letter-spacing:-.7px}.topbar p{margin:7px 0 0;color:var(--muted)}.top-actions{display:flex;gap:9px}
  .grid{display:grid;gap:16px}.grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}.card{background:var(--panel);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow)}.stat{padding:19px}.stat .label{font-size:12px;color:var(--muted);font-weight:650}.stat .value{font-size:30px;font-weight:800;margin:7px 0 2px;letter-spacing:-1px}.stat .hint{font-size:11px;color:#8993a5}.card-head{padding:17px 19px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}.card-head h2{font-size:15px;margin:0}.card-body{padding:18px}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse}.table th{text-align:left;font-size:11px;color:#7c8799;text-transform:uppercase;letter-spacing:.7px;padding:11px 15px;background:#fafbfc;border-bottom:1px solid var(--line)}.table td{padding:13px 15px;border-bottom:1px solid var(--line);vertical-align:middle}.table tr:last-child td{border-bottom:0}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.muted{color:var(--muted)}.empty{padding:35px;text-align:center;color:var(--muted)}
  .badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800}.badge.raw{background:#f1f5f9;color:#475569}.badge.semi{background:#eef2ff;color:#4338ca}.badge.finished{background:#ecfdf5;color:#047857}.badge.in{background:var(--greenbg);color:var(--green)}.badge.out{background:var(--redbg);color:var(--red)}.badge.low{background:var(--redbg);color:var(--red)}.badge.ok{background:var(--greenbg);color:var(--green)}
  .btn{border:1px solid var(--line);background:#fff;color:var(--ink);padding:9px 13px;border-radius:8px;font-weight:700;cursor:pointer;font-size:12px}.btn:hover{background:#f8fafc}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn.danger{color:var(--red);border-color:#fecaca}.btn.small{padding:6px 9px;font-size:11px}.btn:disabled{opacity:.45;cursor:not-allowed}
  .toolbar{display:flex;gap:10px;align-items:center;margin-bottom:15px}.toolbar .grow{flex:1}.search{width:260px}.field{display:grid;gap:6px}.field label{font-size:11px;font-weight:750;color:#536075}.field input,.field select,.field textarea{width:100%;padding:10px 11px;border:1px solid #d8dee8;border-radius:8px;background:#fff;color:var(--ink);outline:none;font:inherit}.field input:focus,.field select:focus,.field textarea:focus{border-color:#8da3f2;box-shadow:0 0 0 3px #eef2ff}.form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.full{grid-column:1/-1}.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:center;justify-content:center;padding:20px;z-index:10}.modal-backdrop.show{display:flex}.modal{width:min(680px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 25px 80px rgba(0,0,0,.22)}.modal-head{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}.modal-head h2{margin:0;font-size:17px}.modal-body{padding:20px}.close{border:0;background:transparent;font-size:22px;cursor:pointer;color:#64748b}
  .bom-row{display:grid;grid-template-columns:1fr 120px 36px;gap:8px;margin-bottom:8px}.bom-box{padding:13px;border:1px dashed #ccd5e4;border-radius:9px;background:#fbfcfe}.section-label{font-size:11px;font-weight:800;color:#536075;text-transform:uppercase;letter-spacing:.6px;margin-bottom:9px}.alert{padding:12px 14px;border-radius:9px;background:var(--redbg);color:#9f2f2b;font-size:12px;margin-bottom:15px}.success{background:var(--greenbg);color:#166534}.kpi-list{display:grid;gap:8px}.kpi-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}.kpi-row:last-child{border-bottom:0}.number-pill{min-width:38px;text-align:center;padding:5px 8px;border-radius:7px;background:#f1f5f9;font-weight:800}.production-card{padding:18px}.production-card h3{font-size:14px;margin:0 0 5px}.production-card p{margin:0 0 14px;color:var(--muted);font-size:12px}.progress{height:6px;background:#edf0f5;border-radius:99px;overflow:hidden}.progress>span{display:block;height:100%;background:var(--accent)}.toast{position:fixed;right:24px;bottom:24px;background:#172033;color:#fff;padding:12px 16px;border-radius:9px;box-shadow:0 10px 35px rgba(0,0,0,.2);opacity:0;transform:translateY(8px);transition:.2s;z-index:50;font-size:12px}.toast.show{opacity:1;transform:none}.toast.error{background:#8e2929}
  @media(max-width:900px){.sidebar{width:190px}.main{margin-left:190px;width:calc(100% - 190px);padding:0 20px}.grid-4{grid-template-columns:repeat(2,1fr)}.grid-3{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}}@media(max-width:650px){.sidebar{position:static;width:100%;height:auto}.app-shell{display:block}.sidebar nav{grid-template-columns:repeat(4,1fr)}.sidebar nav a{justify-content:center;font-size:0}.sidebar nav a span{font-size:16px}.sidebar-foot{display:none}.main{margin:0;width:100%}.grid-4,.grid-2{grid-template-columns:1fr}.topbar{align-items:flex-start;gap:12px;flex-direction:column}.search{width:100%}}
  `;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
}
