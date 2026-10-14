const express=require("express"),helmet=require("helmet"),rateLimit=require("express-rate-limit"),crypto=require("crypto"),fs=require("fs"),path=require("path");
const app=express(); app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:null}}}));
app.use(express.json({limit:"30kb"}));
const PORT=Number(process.env.PORT||3000), USER=process.env.PANEL_USERNAME||"", PASS=process.env.PANEL_PASSWORD||"", SECRET=process.env.SESSION_SECRET||"", PUBLISH_TOKEN=process.env.PANEL_PUBLISH_TOKEN||"";
const DATA=path.join(__dirname,"data","summary.json"), HISTORY=path.join(__dirname,"data","history.json"), AUDIENCE=path.join(__dirname,"data","audience.json"), sessions=new Map(), attempts=new Map();
if(!USER||!PASS||!SECRET||!PUBLISH_TOKEN){console.error("Faltan PANEL_USERNAME, PANEL_PASSWORD, SESSION_SECRET y PANEL_PUBLISH_TOKEN en las variables de entorno.");process.exit(1)}
if(PASS.length<14||SECRET.length<32){console.error("PANEL_PASSWORD debe tener al menos 14 caracteres y SESSION_SECRET al menos 32.");process.exit(1)}
const limiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:"draft-7",legacyHeaders:false,message:{error:"Demasiados intentos. Esperá 15 minutos."}});app.use("/api/login",limiter);
function eq(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function cookies(h=""){const o={};for(const p of h.split(";")){const i=p.indexOf("=");if(i>0)o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())}return o}
function sess(req){const token=cookies(req.headers.cookie).panel_session;if(!token||!sessions.has(token))return null;const s=sessions.get(token);if(s.expires<Date.now()){sessions.delete(token);return null}return{token,...s}}
function admin(req,res,next){const s=sess(req);if(!s){if(req.path.startsWith("/api/"))return res.status(401).json({error:"No autorizado"});return res.redirect("/admin")}req.panelSession=s;next()}
function csrf(req,res,next){const s=sess(req);if(!s||!eq(req.get("x-csrf-token")||"",s.csrf))return res.status(403).json({error:"Solicitud no válida"});next()}
function newSession(res){const token=crypto.randomBytes(32).toString("hex"),tokenCsrf=crypto.randomBytes(24).toString("hex");sessions.set(token,{csrf:tokenCsrf,expires:Date.now()+8*60*60*1000});res.cookie("panel_session",token,{httpOnly:true,secure:process.env.COOKIE_SECURE!=="0",sameSite:"strict",path:"/",maxAge:8*60*60*1000});return tokenCsrf}
app.get("/health",(req,res)=>res.json({ok:true}));
function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
}
function isRealReport(report) {
  if (!report || !report.updatedAt) return false;
  const summary = String(report.summary || "").trim();
  return Boolean(summary || report.recentFeedback || report.talkSummary)
    && !/^PRUEBA DE CONEXI[ÓO]N/i.test(summary);
}
function publisherAuthorized(req, res) {
  const auth = String(req.get("authorization") || "");
  if (!eq(auth, "Bearer " + PUBLISH_TOKEN)) {
    res.status(401).json({ error: "No autorizado" });
    return false;
  }
  return true;
}
function validVideoId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(value);
}
function emptyVideoSummary(videoId, status = "running") {
  const now = new Date().toISOString();
  return {
    updatedAt: null, status, videoId, startedAt: now, stoppedAt: null,
    heartbeatAt: now, summary: "", recentFeedback: "", currentTalk: "",
    talkSummary: "", topics: [], questions: [], issues: [], keyPhrases: [],
    talkMessageCount: 0, eventMessageCount: 0, irrelevantMessages: 0, eventIrrelevantMessages: 0,
    talkIssues: [], eventIssues: [], talkQuestions: [], eventQuestions: []
  };
}
function activateVideo(videoId) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  const current = readJsonFile(DATA, null);
  if (!current || current.videoId !== videoId) {
    // Legacy history has no reliable video ID, so discard it from the public timeline.
    writeJsonAtomic(HISTORY, []);
    const fresh = emptyVideoSummary(videoId, "running");
    writeJsonAtomic(DATA, fresh);
    writeJsonAtomic(AUDIENCE, { videoId, agenda: [], agendaEnabled: false, samples: [] });
    return { changed: true, summary: fresh };
  }
  const now = new Date().toISOString();
  const resumed = { ...current, status: "running", startedAt: now, stoppedAt: null, heartbeatAt: now, videoId };
  writeJsonAtomic(DATA, resumed);
  return { changed: false, summary: resumed };
}
app.post("/api/session/start", (req, res) => {
  if (!publisherAuthorized(req, res)) return;
  const videoId = req.body?.videoId;
  if (!validVideoId(videoId)) return res.status(400).json({ error: "videoId inválido" });
  try {
    const result = activateVideo(videoId);
    res.json({ ok: true, videoId, historyReset: result.changed, status: "running" });
  } catch (e) {
    console.error("No se pudo iniciar la sesión del panel:", e.message);
    res.status(500).json({ error: "No se pudo iniciar la sesión" });
  }
});
app.post("/api/session/stop", (req, res) => {
  if (!publisherAuthorized(req, res)) return;
  const videoId = req.body?.videoId;
  if (!validVideoId(videoId)) return res.status(400).json({ error: "videoId inválido" });
  try {
    const current = readJsonFile(DATA, null);
    if (!current || current.videoId !== videoId) {
      return res.json({ ok: true, stopped: false, reason: "La sesión activa pertenece a otro video." });
    }
    const now = new Date().toISOString();
    writeJsonAtomic(DATA, { ...current, status: "stopped", stoppedAt: now, heartbeatAt: now });
    res.json({ ok: true, stopped: true, videoId, status: "stopped" });
  } catch (e) {
    console.error("No se pudo detener la sesión del panel:", e.message);
    res.status(500).json({ error: "No se pudo detener la sesión" });
  }
});
app.post("/api/session/heartbeat", (req, res) => {
  if (!publisherAuthorized(req, res)) return;
  const videoId = req.body?.videoId;
  if (!validVideoId(videoId)) return res.status(400).json({ error: "videoId inválido" });
  try {
    const current = readJsonFile(DATA, null);
    if (!current || current.videoId !== videoId || current.status !== "running") {
      return res.json({ ok: true, refreshed: false });
    }
    const now = new Date().toISOString();
    writeJsonAtomic(DATA, { ...current, heartbeatAt: now });
    res.json({ ok: true, refreshed: true });
  } catch (e) {
    console.error("No se pudo actualizar el estado de la sesión:", e.message);
    res.status(500).json({ error: "No se pudo actualizar el estado" });
  }
});
app.post("/api/publish", (req, res) => {
  if (!publisherAuthorized(req, res)) return;
  const d = req.body || {};
  const videoId = d.videoId;
  if (!validVideoId(videoId)) return res.status(400).json({ error: "videoId inválido o ausente" });
  const cleanText = (v, max = 12000) => typeof v === "string" ? v.slice(0, max) : "";
  const textList = (v, maxItems = 12) => Array.isArray(v) ? v.slice(0, maxItems).map(x => cleanText(typeof x === "string" ? x : (x?.text || ""), 500)).filter(Boolean) : [];
  const questionList = (v) => Array.isArray(v) ? v.slice(0, 12).map(x => ({
    question: cleanText(typeof x === "string" ? x : (x?.question || x?.text || ""), 500),
    count: Math.max(1, Number.parseInt(x?.count ?? 1, 10) || 1),
    kind: x?.kind === "organizativa" ? "organizativa" : "contenido",
    repetitive: x?.repetitive === true,
    example: cleanText(x?.example, 240)
  })).filter(x => x.question) : [];
  const issueList = (v) => Array.isArray(v) ? v.slice(0, 12).map(x => ({
    type: cleanText(typeof x === "string" ? x : (x?.type || x?.text || "Problema técnico"), 300),
    count: Math.max(1, Number.parseInt(x?.count ?? 1, 10) || 1),
    severity: ["baja","media","alta","crítica"].includes(x?.severity) ? x.severity : "media",
    certainty: ["indicio","repetido","confirmado","claro"].includes(x?.certainty) ? x.certainty : "indicio",
    example: cleanText(x?.example, 240), needsAction: x?.needsAction === true
  })).filter(x => x.type) : [];
  const number = v => Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0;
  const payload = {
    updatedAt: new Date().toISOString(), status: "running", videoId,
    summary: cleanText(d.summary, 5000) || "Sin resumen general disponible.",
    recentFeedback: cleanText(d.recentFeedback, 5000),
    currentTalk: cleanText(d.currentTalk, 300), talkSummary: cleanText(d.talkSummary, 3000),
    topics: textList(d.topics, 8), questions: questionList(d.questions), issues: issueList(d.issues),
    keyPhrases: Array.isArray(d.keyPhrases) ? d.keyPhrases.slice(0, 3).map(x => ({text: cleanText(x?.text, 300), timestamp: cleanText(x?.timestamp, 30)})).filter(x => x.text) : [],
    talkMessageCount: number(d.talkMessageCount), eventMessageCount: number(d.eventMessageCount),
    irrelevantMessages: number(d.irrelevantMessages), eventIrrelevantMessages: number(d.eventIrrelevantMessages),
    talkIssues: issueList(d.talkIssues), eventIssues: issueList(d.eventIssues),
    talkQuestions: questionList(d.talkQuestions), eventQuestions: questionList(d.eventQuestions),
    agenda: Array.isArray(d.agenda) ? d.agenda.slice(0, 30).map(x => ({time: cleanText(x?.time, 10), title: cleanText(x?.title, 300)})).filter(x => x.time && x.title) : [],
    agendaEnabled: d.agendaEnabled === true
  };
  try {
    fs.mkdirSync(path.dirname(DATA), { recursive: true });
    const current = readJsonFile(DATA, null);
    if (!current || current.videoId !== videoId) activateVideo(videoId);
    let reports = readJsonFile(HISTORY, []);
    if (!Array.isArray(reports)) reports = [];
    // Only reports for the currently active video are retained in the public timeline.
    reports = reports.filter(r => r && r.videoId === videoId && r.updatedAt !== payload.updatedAt);
    reports.push(payload);
    reports = reports.slice(-300);
    writeJsonAtomic(HISTORY, reports);
    writeJsonAtomic(DATA, { ...payload, startedAt: readJsonFile(DATA, {}).startedAt || new Date().toISOString(), stoppedAt: null, heartbeatAt: new Date().toISOString() });
    res.json({ ok: true, updatedAt: payload.updatedAt, videoId, savedReports: reports.length });
  } catch (e) {
    for (const file of [DATA + ".tmp", HISTORY + ".tmp"]) {
      try { fs.unlinkSync(file); } catch {}
    }
    console.error("No se pudo guardar el informe:", e.message);
    res.status(500).json({ error: "No se pudo guardar el informe" });
  }
});
app.post("/api/audience/publish", (req, res) => {
  if (!publisherAuthorized(req, res)) return;
  const d = req.body || {};
  const videoId = d.videoId;
  if (!validVideoId(videoId)) return res.status(400).json({ error: "videoId inválido o ausente" });
  const timestamp = typeof d.timestamp === "string" && !Number.isNaN(Date.parse(d.timestamp))
    ? new Date(d.timestamp).toISOString() : new Date().toISOString();
  const viewers = d.viewers === null || d.viewers === undefined || d.viewers === ""
    ? null : Number(d.viewers);
  if (viewers !== null && (!Number.isInteger(viewers) || viewers < 0)) {
    return res.status(400).json({ error: "viewers debe ser un entero no negativo o null" });
  }
  const cleanText = (v, max = 300) => typeof v === "string" ? v.slice(0, max) : "";
  const agenda = Array.isArray(d.agenda) ? d.agenda.slice(0, 30).map(x => ({
    time: cleanText(x?.time, 10), title: cleanText(x?.title, 300)
  })).filter(x => x.time && x.title) : [];
  try {
    fs.mkdirSync(path.dirname(AUDIENCE), { recursive: true });
    let data = readJsonFile(AUDIENCE, null);
    if (!data || data.videoId !== videoId) data = { videoId, agenda: [], agendaEnabled: false, samples: [] };
    const sample = { timestamp, viewers, currentTalk: cleanText(d.currentTalk, 300) || "Charla no identificada" };
    let samples = Array.isArray(data.samples) ? data.samples.filter(x => x && x.timestamp !== timestamp) : [];
    samples.push(sample);
    samples.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    data = {
      videoId,
      agenda: agenda.length ? agenda : (Array.isArray(data.agenda) ? data.agenda : []),
      agendaEnabled: d.agendaEnabled === true,
      samples: samples.slice(-2000),
      updatedAt: timestamp
    };
    writeJsonAtomic(AUDIENCE, data);
    res.json({ ok: true, videoId, viewers, samples: data.samples.length });
  } catch (e) {
    try { fs.unlinkSync(AUDIENCE + ".tmp"); } catch {}
    console.error("No se pudo guardar la muestra de audiencia:", e.message);
    res.status(500).json({ error: "No se pudo guardar la muestra de audiencia" });
  }
});
app.get("/api/public-audience", (req, res) => {
  res.set("Cache-Control", "no-store");
  const data = readJsonFile(AUDIENCE, { videoId: null, agenda: [], agendaEnabled: false, samples: [] });
  res.json(data && typeof data === "object" ? data : { videoId: null, agenda: [], agendaEnabled: false, samples: [] });
});
app.get("/api/public-summary", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(readJsonFile(DATA, { updatedAt: null, status: "waiting", videoId: null, summary: "El análisis todavía no publicó resultados.", topics: [], questions: [], issues: [] }));
});
app.get("/api/public-history", (req, res) => {
  res.set("Cache-Control", "no-store");
  const current = readJsonFile(DATA, null);
  const videoId = current?.videoId || null;
  let reports = readJsonFile(HISTORY, []);
  if (!Array.isArray(reports)) reports = [];
  if (videoId && isRealReport(current) && !reports.some(r => r && r.updatedAt === current.updatedAt && r.videoId === videoId)) reports.push(current);
  reports = reports.filter(r => isRealReport(r) && videoId && r.videoId === videoId)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)).slice(-300);
  const status = current?.status || "waiting";
  const heartbeatAt = current?.heartbeatAt || null;
  // If Python disappears without running its shutdown handler, do not leave the panel live forever.
  const heartbeatAge = heartbeatAt ? Date.now() - Date.parse(heartbeatAt) : Infinity;
  const effectiveStatus = status === "running" && heartbeatAge > 180000 ? "stale" : status;
  res.json({ reports, videoId, status: effectiveStatus, startedAt: current?.startedAt || null, stoppedAt: current?.stoppedAt || null });
});
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public",sess(req)?"admin.html":"login.html")));
app.post("/api/login",(req,res)=>{const ip=req.ip||"unknown",now=Date.now(),recent=(attempts.get(ip)||[]).filter(t=>now-t<15*60*1000);if(recent.length>=5)return res.status(429).json({error:"Demasiados intentos. Probá de nuevo en 15 minutos."});if(!eq(req.body?.username||"",USER)||!eq(req.body?.password||"",PASS)){recent.push(now);attempts.set(ip,recent);return res.status(401).json({error:"Usuario o contraseña incorrectos."})}attempts.delete(ip);res.json({ok:true,csrf:newSession(res)})});
app.get("/api/admin/status",admin,(req,res)=>res.json({authenticated:true,csrf:req.panelSession.csrf,hosting:"online",integration:"pending",note:"La conexión segura con Python todavía no está configurada."}));
app.post("/api/logout",admin,csrf,(req,res)=>{sessions.delete(req.panelSession.token);res.clearCookie("panel_session",{httpOnly:true,secure:process.env.COOKIE_SECURE!=="0",sameSite:"strict",path:"/"});res.json({ok:true})});
app.use(express.static(path.join(__dirname,"public"),{index:"index.html",dotfiles:"deny"}));app.use((req,res)=>res.status(404).send("No encontrado"));
app.listen(PORT,"0.0.0.0",()=>console.log("Panel iniciado en puerto "+PORT));