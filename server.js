const express=require("express"),helmet=require("helmet"),rateLimit=require("express-rate-limit"),crypto=require("crypto"),fs=require("fs"),path=require("path");
const app=express(); app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:null}}}));
app.use(express.json({limit:"30kb"}));
const PORT=Number(process.env.PORT||3000), USER=process.env.PANEL_USERNAME||"", PASS=process.env.PANEL_PASSWORD||"", SECRET=process.env.SESSION_SECRET||"", PUBLISH_TOKEN=process.env.PANEL_PUBLISH_TOKEN||"";
const DATA=path.join(__dirname,"data","summary.json"), HISTORY=path.join(__dirname,"data","history.json"), sessions=new Map(), attempts=new Map();
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
app.post("/api/publish",(req,res)=>{
  const auth=String(req.get("authorization")||"");
  const expected="Bearer "+PUBLISH_TOKEN;
  if(!eq(auth,expected)) return res.status(401).json({error:"No autorizado"});
  const d=req.body||{};
  const cleanText=(v,max=12000)=>typeof v==="string"?v.slice(0,max):"";
  const list=(v)=>Array.isArray(v)?v.slice(0,12).map(x=>cleanText(typeof x==="string"?x:(x?.text||x?.question||""),500)).filter(Boolean):[];
  const payload={
    updatedAt:new Date().toISOString(),
    status:"live",
    summary:cleanText(d.summary,5000)||"Sin resumen general disponible.",
    recentFeedback:cleanText(d.recentFeedback,12000),
    currentTalk:cleanText(d.currentTalk,300),
    talkSummary:cleanText(d.talkSummary,5000),
    topics:list(d.topics),
    questions:list(d.questions),
    issues:list(d.issues)
  };
  try {
    fs.mkdirSync(path.dirname(DATA), { recursive: true });
    let reports = readJsonFile(HISTORY, []);
    if (!Array.isArray(reports)) reports = [];

    // Conserva el informe actual anterior si viene de una versión previa del panel.
    const previous = readJsonFile(DATA, null);
    if (isRealReport(previous) && !reports.some(r => r && r.updatedAt === previous.updatedAt)) {
      reports.push(previous);
    }

    // Cada publicación se guarda como una entrada independiente; no sustituye informes anteriores.
    reports = reports.filter(r => r && r.updatedAt !== payload.updatedAt);
    reports.push(payload);
    reports = reports.slice(-300);

    writeJsonAtomic(HISTORY, reports);
    writeJsonAtomic(DATA, payload);
    res.json({ ok: true, updatedAt: payload.updatedAt, savedReports: reports.length });
  } catch(e) {
    for (const file of [DATA + ".tmp", HISTORY + ".tmp"]) {
      try { fs.unlinkSync(file); } catch {}
    }
    console.error("No se pudo guardar el informe:", e.message);
    res.status(500).json({ error: "No se pudo guardar el informe" });
  }
});
app.get("/api/public-summary",(req,res)=>{
  res.set("Cache-Control","no-store");
  res.json(readJsonFile(DATA, {updatedAt:null,status:"waiting",summary:"El análisis todavía no publicó resultados.",topics:[],questions:[],issues:[]}));
});
app.get("/api/public-history",(req,res)=>{
  res.set("Cache-Control","no-store");
  let reports = readJsonFile(HISTORY, []);
  if (!Array.isArray(reports)) reports = [];
  const current = readJsonFile(DATA, null);
  if (isRealReport(current) && !reports.some(r => r && r.updatedAt === current.updatedAt)) reports.push(current);
  reports = reports.filter(isRealReport)
    .sort((a,b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .slice(-300);
  res.json({ reports });
});
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public",sess(req)?"admin.html":"login.html")));
app.post("/api/login",(req,res)=>{const ip=req.ip||"unknown",now=Date.now(),recent=(attempts.get(ip)||[]).filter(t=>now-t<15*60*1000);if(recent.length>=5)return res.status(429).json({error:"Demasiados intentos. Probá de nuevo en 15 minutos."});if(!eq(req.body?.username||"",USER)||!eq(req.body?.password||"",PASS)){recent.push(now);attempts.set(ip,recent);return res.status(401).json({error:"Usuario o contraseña incorrectos."})}attempts.delete(ip);res.json({ok:true,csrf:newSession(res)})});
app.get("/api/admin/status",admin,(req,res)=>res.json({authenticated:true,csrf:req.panelSession.csrf,hosting:"online",integration:"pending",note:"La conexión segura con Python todavía no está configurada."}));
app.post("/api/logout",admin,csrf,(req,res)=>{sessions.delete(req.panelSession.token);res.clearCookie("panel_session",{httpOnly:true,secure:process.env.COOKIE_SECURE!=="0",sameSite:"strict",path:"/"});res.json({ok:true})});
app.use(express.static(path.join(__dirname,"public"),{index:"index.html",dotfiles:"deny"}));app.use((req,res)=>res.status(404).send("No encontrado"));
app.listen(PORT,"0.0.0.0",()=>console.log("Panel iniciado en puerto "+PORT));