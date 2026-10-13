const $ = (id) => document.getElementById(id);
const seenReports = new Set();
let reportNumber = 0;
let pendingUpdates = 0;
let firstLoad = true;

function appendInline(parent, text) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0, match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    const el = document.createElement(token.startsWith("**") || token.startsWith("__") ? "strong" :
      token.startsWith("`") ? "code" : "em");
    el.textContent = token.slice(token.startsWith("**") || token.startsWith("__") ? 2 : 1,
      token.startsWith("**") || token.startsWith("__") ? -2 : -1);
    parent.append(el);
    last = pattern.lastIndex;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

function renderMarkdown(target, source, fallback) {
  target.replaceChildren();
  let text = typeof source === "string" ? source.trim() : "";
  if (!text) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = fallback;
    target.append(p);
    return;
  }
  text = text.replace(/\r\n?/g, "\n")
    .replace(/[ \t]+(#{1,4}\s+(?=\d+\.|[A-ZÁÉÍÓÚÑ]))/g, "\n\n$1")
    .replace(/[ \t]+-\s+(?=\*\*[^*\n]+\*\*:)/g, "\n- ");
  let paragraph = [], list = null, listKind = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    appendInline(p, paragraph.join(" ").trim());
    target.append(p); paragraph = [];
  };
  const flushList = () => { if (list) target.append(list); list = null; listKind = null; };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      const h = document.createElement("h" + Math.min(heading[1].length + 2, 6));
      appendInline(h, heading[2]); target.append(h); continue;
    }
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      const kind = unordered ? "ul" : "ol";
      if (!list || listKind !== kind) { flushList(); list = document.createElement(kind); listKind = kind; }
      const li = document.createElement("li");
      appendInline(li, (unordered || ordered)[1]); list.append(li); continue;
    }
    if (quote) {
      flushParagraph(); flushList();
      const bq = document.createElement("blockquote");
      appendInline(bq, quote[1]); target.append(bq); continue;
    }
    flushList(); paragraph.push(line);
  }
  flushParagraph(); flushList();
}

function addIndicatorList(container, title, values) {
  if (!Array.isArray(values) || !values.length) return;
  const section = document.createElement("section"); section.className = "indicator";
  const heading = document.createElement("h5"); heading.textContent = title; section.append(heading);
  const list = document.createElement("ul");
  values.slice(0, 12).forEach(value => {
    const li = document.createElement("li");
    appendInline(li, String(typeof value === "string" ? value : (value?.text || value?.question || "")));
    list.append(li);
  });
  section.append(list); container.append(section);
}
function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Fecha no disponible";
  return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" });
}
function getViewportAnchor() {
  const nodes = [...document.querySelectorAll(".report-entry")];
  const anchor = nodes.find(node => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });
  return anchor ? { node: anchor, top: anchor.getBoundingClientRect().top } : null;
}
function renderReport(report, openIt = false) {
  if (!report || !report.updatedAt || seenReports.has(report.updatedAt)) return null;
  seenReports.add(report.updatedAt); reportNumber++;
  const article = document.createElement("article");
  article.className = "report-entry";
  article.dataset.updatedAt = report.updatedAt;

  const details = document.createElement("details");
  details.className = "report-details"; details.open = Boolean(openIt);
  const summary = document.createElement("summary");
  const main = document.createElement("span"); main.className = "report-summary-main";
  const number = document.createElement("span"); number.className = "report-number";
  number.textContent = String(reportNumber).padStart(2, "0");
  const meta = document.createElement("span"); meta.className = "report-meta";
  const time = document.createElement("span"); time.className = "report-time"; time.textContent = formatDate(report.updatedAt);
  const talk = document.createElement("span"); talk.className = "report-talk";
  talk.textContent = report.currentTalk || "Informe general del evento";
  meta.append(time, talk); main.append(number, meta);
  const icon = document.createElement("span"); icon.className = "report-chevron"; icon.textContent = details.open ? "−" : "＋";
  summary.append(main, icon); details.append(summary);

  const content = document.createElement("div"); content.className = "report-content";
  function addBlock(label, value, fallback) {
    const block = document.createElement("section"); block.className = "report-block";
    const h = document.createElement("h4"); h.textContent = label;
    const body = document.createElement("div"); body.className = "markdown-body";
    renderMarkdown(body, value, fallback); block.append(h, body); content.append(block);
  }
  addBlock("Resumen general", report.summary, "No hay resumen general en este informe.");
  if ((report.currentTalk || "").trim() || (report.talkSummary || "").trim()) {
    const block = document.createElement("section"); block.className = "report-block";
    const h = document.createElement("h4"); h.textContent = "Contexto de la charla";
    const title = document.createElement("p"); title.className = "talk-title";
    title.textContent = report.currentTalk || "Título no disponible";
    const body = document.createElement("div"); body.className = "markdown-body";
    renderMarkdown(body, report.talkSummary, "No hay resumen específico de la charla.");
    block.append(h, title, body); content.append(block);
  }
  addBlock("Análisis reciente", report.recentFeedback, "No hay análisis reciente en este informe.");
  const indicators = document.createElement("div"); indicators.className = "report-indicators";
  addIndicatorList(indicators, "Temas principales", report.topics);
  addIndicatorList(indicators, "Preguntas frecuentes", report.questions);
  addIndicatorList(indicators, "Dificultades detectadas", report.issues);
  if (indicators.childElementCount) content.append(indicators);
  details.append(content); article.append(details);
  details.addEventListener("toggle", () => { icon.textContent = details.open ? "−" : "＋"; });
  return article;
}
function updateMeta(reports) {
  if (!reports.length) {
    $("updated").textContent = "Esperando el primer informe…";
    $("report-count").textContent = "Todavía no hay informes guardados."; return;
  }
  const latest = reports[reports.length - 1];
  $("updated").textContent = "Último informe recibido: " + formatDate(latest.updatedAt);
  $("report-count").textContent = reports.length + (reports.length === 1 ? " informe conservado" : " informes conservados") + ".";
  const lastReportTime = Date.parse(latest.updatedAt);
  const hasRecentActivity = Number.isFinite(lastReportTime) && (Date.now() - lastReportTime) < 5 * 60 * 1000;
  $("connection").textContent = hasRecentActivity ? "En vivo" : "Sin actividad reciente";
  $("connection").classList.toggle("is-live", hasRecentActivity);
}
function latestReportIsVisible() {
  const latest = document.querySelector(".report-entry");
  if (!latest) return false;
  const rect = latest.getBoundingClientRect();
  // Si el informe más reciente ya está dentro de la pantalla, el aviso sobra.
  return rect.top < window.innerHeight && rect.bottom > 0;
}
function updateNewButton() {
  const button = $("new-updates");
  // Al llegar visualmente al informe más reciente, damos por vistas las novedades.
  if (pendingUpdates > 0 && latestReportIsVisible()) pendingUpdates = 0;
  button.hidden = pendingUpdates === 0;
  button.textContent = pendingUpdates === 1 ? "Hay una nueva actualización ↑" : `Hay ${pendingUpdates} nuevas actualizaciones ↑`;
}
async function refreshHistory() {
  try {
    const response = await fetch("/api/public-history?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el historial");
    const data = await response.json();
    const reports = Array.isArray(data.reports) ? data.reports : [];
    const unseen = reports.filter(r => r && r.updatedAt && !seenReports.has(r.updatedAt));
    const container = $("reports");

    if (firstLoad) {
      // La API devuelve cronológicamente; en pantalla queremos los más recientes primero.
      unseen.slice().reverse().forEach((report, index) => {
        const card = renderReport(report, index === 0);
        if (card) container.append(card);
      });
      firstLoad = false;
    } else if (unseen.length) {
      // Guardamos el punto visible antes de insertar arriba y compensamos el desplazamiento.
      const anchor = getViewportAnchor();
      const oldTop = anchor ? anchor.top : null;
      // Se insertan del más antiguo al más nuevo: el más nuevo termina arriba.
      unseen.forEach(report => {
        const card = renderReport(report, false);
        if (card) container.prepend(card);
      });
      const latestCard = container.querySelector(".report-entry");
      if (latestCard) {
        const details = latestCard.querySelector("details");
        if (details) details.open = true;
        const icon = latestCard.querySelector(".report-chevron");
        if (icon) icon.textContent = "−";
      }
      if (anchor && oldTop !== null && anchor.node.isConnected) {
        const newTop = anchor.node.getBoundingClientRect().top;
        window.scrollBy(0, newTop - oldTop);
      }
      pendingUpdates += unseen.length;
      updateNewButton();
    }
    updateMeta(reports);
    if (!container.querySelector(".report-entry")) {
      $("empty-state")?.remove();
      const empty = document.createElement("div");
      empty.id = "empty-state"; empty.className = "empty-state";
      empty.textContent = "Esperando el primer análisis de Gemini…";
      container.append(empty);
    } else {
      $("empty-state")?.remove();
    }
  } catch (error) {
    $("connection").textContent = "Sin conexión";
    $("connection").classList.remove("is-live");
  }
}
$("new-updates").addEventListener("click", () => {
  pendingUpdates = 0; updateNewButton();
  const latest = document.querySelector(".report-entry");
  if (!latest) return;
  const details = latest.querySelector("details");
  if (details) details.open = true;
  const icon = latest.querySelector(".report-chevron");
  if (icon) icon.textContent = "−";
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("latest-link").addEventListener("click", event => {
  event.preventDefault();
  pendingUpdates = 0; updateNewButton();
  const latest = document.querySelector(".report-entry");
  if (!latest) return;
  const details = latest.querySelector("details");
  if (details) details.open = true;
  const icon = latest.querySelector(".report-chevron");
  if (icon) icon.textContent = "−";
  window.scrollTo({ top: 0, behavior: "smooth" });
});
refreshHistory();
setInterval(refreshHistory, 10000);
// Si el usuario llega al informe más reciente, ocultamos el botón flotante.
window.addEventListener("scroll", updateNewButton, { passive: true });
window.addEventListener("resize", updateNewButton);
