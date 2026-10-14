const $ = (id) => document.getElementById(id);
const seenReports = new Set();
let reportNumber = 0;
let pendingUpdates = 0;
let firstLoad = true;
let activeVideoId = null;
let videoInitialized = false;

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

function addIndicatorList(container, title, values, fallback = "Sin datos relevantes en este período.") {
  const section = document.createElement("section"); section.className = "indicator";
  const heading = document.createElement("h5"); heading.textContent = title; section.append(heading);
  const list = document.createElement("ul");
  const items = Array.isArray(values) ? values.slice(0, 8) : [];
  if (!items.length) {
    const li = document.createElement("li"); li.className = "muted"; li.textContent = fallback; list.append(li);
  } else {
    items.forEach(value => {
      const li = document.createElement("li");
      if (typeof value === "string") {
        appendInline(li, value);
      } else {
        const main = value?.question || value?.type || value?.text || "";
        appendInline(li, String(main));
        const meta = [];
        if (Number.isFinite(Number(value?.count))) meta.push(`${value.count} mensaje${Number(value.count) === 1 ? "" : "s"}`);
        if (value?.kind === "organizativa") meta.push("consulta organizativa");
        if (value?.severity) meta.push(`gravedad ${value.severity}`);
        if (value?.certainty) meta.push(`certeza ${value.certainty}`);
        if (value?.repetitive) meta.push("repetida");
        if (meta.length) {
          const detail = document.createElement("span"); detail.className = "detail-meta";
          detail.textContent = meta.join(" · "); li.append(detail);
        }
        if (value?.example) {
          const example = document.createElement("span"); example.className = "detail-meta";
          example.textContent = `Ejemplo: “${value.example}”`; li.append(example);
        }
      }
      list.append(li);
    });
  }
  section.append(list); container.append(section);
}
function addKeyPhrases(container, phrases) {
  if (!Array.isArray(phrases) || !phrases.length) return;
  const block = document.createElement("section"); block.className = "report-block";
  const heading = document.createElement("h4"); heading.textContent = "Frases clave del audio"; block.append(heading);
  const list = document.createElement("div"); list.className = "key-phrases";
  phrases.slice(0, 3).forEach(item => {
    if (!item?.text) return;
    const quote = document.createElement("blockquote"); quote.className = "key-phrase";
    quote.textContent = `“${item.text}”`;
    if (item.timestamp) {
      const time = document.createElement("time"); time.textContent = item.timestamp;
      quote.append(time);
    }
    list.append(quote);
  });
  if (list.childElementCount) { block.append(list); container.append(block); }
}
function addReportStats(container, report) {
  const stats = document.createElement("div"); stats.className = "report-stats";
  const values = [
    ["Mensajes de esta charla", report.talkMessageCount],
    ["Mensajes de todo el video", report.eventMessageCount],
    ["Ruido en esta charla", report.irrelevantMessages],
    ["Ruido acumulado del evento", report.eventIrrelevantMessages]
  ];
  values.forEach(([label, value]) => {
    const item = document.createElement("div"); item.className = "report-stat";
    const name = document.createElement("span"); name.textContent = label;
    const number = document.createElement("strong"); number.textContent = Number.isFinite(Number(value)) ? Number(value).toLocaleString("es-AR") : "—";
    item.append(name, number); stats.append(item);
  });
  container.append(stats);
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
  addBlock("Análisis reciente", report.recentFeedback, "No se detectaron novedades accionables en este período.");
  addReportStats(content, report);
  addKeyPhrases(content, report.keyPhrases);
  const indicators = document.createElement("div"); indicators.className = "report-indicators";
  addIndicatorList(indicators, "Temas principales", report.topics, "No se destacaron temas adicionales en esta ventana.");
  addIndicatorList(indicators, "Consultas y aportes relevantes", report.questions, "No hay preguntas relevantes que requieran seguimiento en esta ventana.");
  addIndicatorList(indicators, "Problemas técnicos", report.issues, "Sin incidencias técnicas detectadas en este período.");
  content.append(indicators);
  const accumulated = document.createElement("details"); accumulated.className = "accumulated-details";
  const accumulatedTitle = document.createElement("summary"); accumulatedTitle.textContent = "Ver consultas e incidencias acumuladas";
  accumulated.append(accumulatedTitle);
  const all = document.createElement("div"); all.className = "report-indicators";
  addIndicatorList(all, "Problemas de esta charla", report.talkIssues, "No hay problemas acumulados para esta charla.");
  addIndicatorList(all, "Problemas de toda la jornada", report.eventIssues, "No hay problemas acumulados en el evento.");
  addIndicatorList(all, "Consultas de esta charla", report.talkQuestions, "No hay consultas acumuladas para esta charla.");
  addIndicatorList(all, "Consultas de toda la jornada", report.eventQuestions, "No hay consultas acumuladas en el evento.");
  accumulated.append(all); content.append(accumulated);
  details.append(content); article.append(details);
  details.addEventListener("toggle", () => { icon.textContent = details.open ? "−" : "＋"; });
  return article;
}
function updateMeta(reports, status) {
  if (!reports.length) {
    $("updated").textContent = status === "running" ? "Ejecución iniciada; esperando el primer informe…" :
      status === "stopped" ? "Ejecución detenida." : "Esperando el primer informe…";
    $("report-count").textContent = "Todavía no hay informes guardados para este video.";
  } else {
    const latest = reports[reports.length - 1];
    $("updated").textContent = "Último informe recibido: " + formatDate(latest.updatedAt);
    $("report-count").textContent = reports.length + (reports.length === 1 ? " informe conservado" : " informes conservados") + ".";
  }
  const labels = { running: "En vivo", stopped: "Detenido", stale: "Sin señal de Python", waiting: "Esperando ejecución" };
  $("connection").textContent = labels[status] || "Estado desconocido";
  $("connection").classList.toggle("is-live", status === "running");
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
function svgNode(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}
function localClockMinutes(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find(p => p.type === "hour")?.value);
  const minute = Number(parts.find(p => p.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}
function shortTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("es-AR", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });
}
function renderAudience(data) {
  const chart = $("audience-chart"), table = $("audience-agenda");
  chart.replaceChildren(); table.replaceChildren();
  const samples = Array.isArray(data.samples) ? data.samples : [];
  const valid = samples.filter(x => Number.isInteger(x.viewers) && x.viewers >= 0).sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const latestSample = samples.length ? samples[samples.length - 1] : null;
  $("audience-updated").textContent = latestSample ? `Última muestra: ${shortTime(latestSample.timestamp)} · ${latestSample.viewers === null ? "dato no disponible" : latestSample.viewers.toLocaleString("es-AR") + " espectadores"}` : "Sin muestras todavía";
  if (!valid.length) {
    const empty = document.createElement("p"); empty.className = "empty-state";
    empty.textContent = samples.length ? "YouTube todavía no facilitó una cifra de espectadores simultáneos. El gráfico se completará cuando el dato esté disponible." : "El gráfico está preparado; la primera muestra se registrará al iniciar el seguimiento.";
    chart.append(empty);
  } else {
    const width = Math.max(600, valid.length * 62), height = 220, left = 48, right = 18, top = 18, bottom = 34;
    const max = Math.max(1, ...valid.map(x => x.viewers));
    const y = value => height - bottom - (value / max) * (height - top - bottom);
    const x = index => valid.length === 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (valid.length - 1);
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Evolución de espectadores simultáneos cada 15 minutos" });
    [0, max / 2, max].forEach(value => {
      const yy = y(value);
      svg.append(svgNode("line", { x1: left, y1: yy, x2: width-right, y2: yy, stroke: "#dbe4ef", "stroke-width": 1 }));
      const label = svgNode("text", { x: left-9, y: yy+4, "text-anchor": "end", fill: "#718096", "font-size": 11 });
      label.textContent = Math.round(value).toLocaleString("es-AR"); svg.append(label);
    });
    const points = valid.map((item, index) => `${x(index)},${y(item.viewers)}`).join(" ");
    svg.append(svgNode("polyline", { points, fill: "none", stroke: "#356da8", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    valid.forEach((item, index) => {
      const circle = svgNode("circle", { cx: x(index), cy: y(item.viewers), r: 4, fill: "#356da8" });
      const title = svgNode("title"); title.textContent = `${shortTime(item.timestamp)} · ${item.viewers.toLocaleString("es-AR")} espectadores`;
      circle.append(title); svg.append(circle);
    });
    const start = svgNode("text", { x: left, y: height-9, fill: "#718096", "font-size": 11 }); start.textContent = shortTime(valid[0].timestamp); svg.append(start);
    const end = svgNode("text", { x: width-right, y: height-9, "text-anchor": "end", fill: "#718096", "font-size": 11 }); end.textContent = shortTime(valid[valid.length-1].timestamp); svg.append(end);
    chart.append(svg);
  }

  if (!data.agendaEnabled || !Array.isArray(data.agenda) || !data.agenda.length) {
    const empty = document.createElement("p"); empty.className = "empty-state";
    empty.textContent = "La tabla con las charlas programadas se habilita únicamente para el video oficial del congreso."; table.append(empty); return;
  }
  const tableEl = document.createElement("table"); tableEl.className = "audience-table";
  const thead = document.createElement("thead"), headRow = document.createElement("tr");
  ["Horario", "Charla programada", "Muestras", "Último dato", "Máximo observado"].forEach(label => { const th = document.createElement("th"); th.textContent = label; headRow.append(th); });
  thead.append(headRow); tableEl.append(thead);
  const tbody = document.createElement("tbody");
  const agenda = data.agenda;
  agenda.forEach((talk, index) => {
    const startParts = String(talk.time || "").split(":").map(Number);
    const startMinute = startParts.length === 2 ? startParts[0] * 60 + startParts[1] : null;
    const next = agenda[index + 1];
    const nextParts = next ? String(next.time || "").split(":").map(Number) : null;
    const endMinute = nextParts?.length === 2 ? nextParts[0] * 60 + nextParts[1] : 24 * 60;
    const slot = samples.filter(sample => {
      const minute = localClockMinutes(sample.timestamp);
      return minute !== null && startMinute !== null && minute >= startMinute && minute < endMinute;
    });
    const withValues = slot.filter(sample => Number.isInteger(sample.viewers) && sample.viewers >= 0);
    const last = withValues.length ? withValues[withValues.length-1].viewers : null;
    const peak = withValues.length ? Math.max(...withValues.map(sample => sample.viewers)) : null;
    const row = document.createElement("tr");
    const timeCell = document.createElement("td"); timeCell.textContent = talk.time || "—";
    const titleCell = document.createElement("td"); titleCell.textContent = talk.title || "Charla sin título";
    const sampleCell = document.createElement("td"); sampleCell.textContent = String(slot.length);
    const lastCell = document.createElement("td"); lastCell.textContent = last === null ? "Sin datos" : last.toLocaleString("es-AR");
    const peakCell = document.createElement("td"); peakCell.textContent = peak === null ? "Sin datos" : peak.toLocaleString("es-AR");
    row.append(timeCell, titleCell, sampleCell, lastCell, peakCell); tbody.append(row);
  });
  tableEl.append(tbody); table.append(tableEl);
}
async function refreshAudience() {
  try {
    const response = await fetch("/api/public-audience?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar la audiencia");
    renderAudience(await response.json());
  } catch {
    $("audience-updated").textContent = "No se pudo actualizar la audiencia";
  }
}

async function refreshHistory() {
  try {
    const response = await fetch("/api/public-history?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el historial");
    const data = await response.json();
    const reports = Array.isArray(data.reports) ? data.reports : [];
    const returnedVideoId = data.videoId || null;
    const container = $("reports");

    if (!videoInitialized) {
      activeVideoId = returnedVideoId;
      videoInitialized = true;
    } else if (returnedVideoId !== activeVideoId) {
      // The server has switched videos: clear all client-side history and render only the new one.
      activeVideoId = returnedVideoId;
      container.replaceChildren();
      seenReports.clear();
      reportNumber = 0;
      pendingUpdates = 0;
      firstLoad = true;
      updateNewButton();
    }

    const unseen = reports.filter(r => r && r.updatedAt && !seenReports.has(r.updatedAt));
    if (firstLoad) {
      unseen.slice().reverse().forEach((report, index) => {
        const card = renderReport(report, index === 0);
        if (card) container.append(card);
      });
      firstLoad = false;
    } else if (unseen.length) {
      const anchor = getViewportAnchor();
      const oldTop = anchor ? anchor.top : null;
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
    updateMeta(reports, data.status || "waiting");
    if (!container.querySelector(".report-entry")) {
      $("empty-state")?.remove();
      const empty = document.createElement("div");
      empty.id = "empty-state"; empty.className = "empty-state";
      empty.textContent = data.status === "running" ? "Esperando el primer análisis de Gemini…" : "Todavía no hay informes para este video.";
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
refreshAudience();
setInterval(refreshHistory, 10000);
setInterval(refreshAudience, 60000);
// Si el usuario llega al informe más reciente, ocultamos el botón flotante.
window.addEventListener("scroll", updateNewButton, { passive: true });
window.addEventListener("resize", updateNewButton);
