const $ = (id) => document.getElementById(id);

function appendInline(parent, text) {
  // Renderizado limitado de Markdown usando nodos de texto: no interpreta HTML ni scripts.
  const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let match;
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > last) {
      parent.append(document.createTextNode(text.slice(last, match.index)));
    }
    const token = match[0];
    let element;
    if (token.startsWith("**") || token.startsWith("__")) {
      element = document.createElement("strong");
      element.textContent = token.slice(2, -2);
    } else if (token.startsWith("`")) {
      element = document.createElement("code");
      element.textContent = token.slice(1, -1);
    } else {
      element = document.createElement("em");
      element.textContent = token.slice(1, -1);
    }
    parent.append(element);
    last = tokenPattern.lastIndex;
  }
  if (last < text.length) {
    parent.append(document.createTextNode(text.slice(last)));
  }
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

  text = text
    .replace(/\r\n?/g, "\n")
    // Algunos informes traen títulos Markdown incrustados en el mismo párrafo.
    .replace(/[ \t]+(#{1,4}\s+(?=\d+\.|[A-ZÁÉÍÓÚÑ]))/g, "\n\n$1")
    // Separa viñetas consecutivas con rótulos en negrita, sin dividir frases normales.
    .replace(/[ \t]+-\s+(?=\*\*[^*\n]+\*\*:)/g, "\n- ");

  const lines = text.split("\n");
  let paragraph = [];
  let list = null;
  let listKind = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    appendInline(p, paragraph.join(" ").trim());
    target.append(p);
    paragraph = [];
  };
  const flushList = () => {
    if (list) target.append(list);
    list = null;
    listKind = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 2, 6);
      const h = document.createElement(`h${level}`);
      appendInline(h, heading[2]);
      target.append(h);
      continue;
    }

    if (/^([-*_])\1\1+\s*$/.test(line)) {
      flushParagraph();
      flushList();
      const hr = document.createElement("hr");
      target.append(hr);
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      const kind = unordered ? "ul" : "ol";
      if (!list || listKind !== kind) {
        flushList();
        list = document.createElement(kind);
        listKind = kind;
      }
      const li = document.createElement("li");
      appendInline(li, (unordered || ordered)[1]);
      list.append(li);
      continue;
    }

    if (quote) {
      flushParagraph();
      flushList();
      const blockquote = document.createElement("blockquote");
      appendInline(blockquote, quote[1]);
      target.append(blockquote);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
}

function fillList(id, values) {
  const list = $(id);
  list.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) return false;

  values.slice(0, 12).forEach((value) => {
    const li = document.createElement("li");
    const text = typeof value === "string"
      ? value
      : (value?.text || value?.question || JSON.stringify(value));
    appendInline(li, String(text));
    list.append(li);
  });
  return true;
}

async function refresh() {
  try {
    const response = await fetch("/api/public-summary", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el informe");
    const data = await response.json();

    $("connection").textContent = data.status === "live" ? "En vivo" : "Panel conectado";
    $("connection").classList.toggle("is-live", data.status === "live");

    renderMarkdown(
      $("summary"),
      data.summary,
      "El análisis todavía no publicó resultados."
    );

    const hasTalk = Boolean((data.currentTalk || "").trim() || (data.talkSummary || "").trim());
    $("talk-section").hidden = !hasTalk;
    $("current-talk-title").textContent = data.currentTalk || "Título de la charla no disponible";
    renderMarkdown($("talk-summary"), data.talkSummary, "Todavía no hay un resumen de la charla actual.");

    renderMarkdown(
      $("recent-feedback"),
      data.recentFeedback,
      "Todavía no hay un análisis reciente."
    );

    const hasTopics = fillList("topics", data.topics);
    const hasQuestions = fillList("questions", data.questions);
    const hasIssues = fillList("issues", data.issues);
    $("structured-results").hidden = !(hasTopics || hasQuestions || hasIssues);

    const updated = data.updatedAt ? new Date(data.updatedAt) : null;
    $("updated").textContent = updated && !Number.isNaN(updated.getTime())
      ? "Última actualización: " + updated.toLocaleString("es-AR")
      : "Esperando el primer informe…";
  } catch (error) {
    $("connection").textContent = "Sin conexión";
    $("connection").classList.remove("is-live");
  }
}

refresh();
setInterval(refresh, 120000);
