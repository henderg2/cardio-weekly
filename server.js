const express = require("express");
const https = require("https");
const http = require("http");
const path = require("path");
const Parser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ── Config ──────────────────────────────────────────────────────────────

const HIGH_IMPACT_JOURNALS = [
  "The New England Journal of Medicine",
  "The Lancet",
  "JAMA",
  "JAMA cardiology",
  "European heart journal",
  "Circulation",
  "Journal of the American College of Cardiology",
  "Nature medicine",
  "JACC. Heart failure",
  "Circulation research",
  "European journal of heart failure",
  "JAMA internal medicine",
  "BMJ",
];

const NEWS_FEEDS = [
  {
    name: "FierceBiotech",
    url: "https://www.fiercebiotech.com/rss/xml",
    keywords: ["cardio", "heart", "cardiac", "atrial", "cardiovascular",
               "stent", "ablation", "valve", "pacemaker", "arrhythm"],
  },
  {
    name: "FiercePharma",
    url: "https://www.fiercepharma.com/rss/xml",
    keywords: ["cardio", "heart", "cardiac", "cardiovascular",
               "cholesterol", "lipid", "hypertension", "anticoagul"],
  },
  {
    name: "MedPage Today - Cardiology",
    url: "https://www.medpagetoday.com/rss/cardiology.xml",
    keywords: null,
  },
  {
    name: "American Heart Association News",
    url: "https://newsroom.heart.org/rss/news-releases.xml",
    keywords: null,
  },
  {
    name: "ACC Latest in Cardiology",
    url: "https://www.acc.org/Latest-in-Cardiology.rss",
    keywords: null,
  },
];

const PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// ── Helpers ─────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve, reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function stripHtml(str) {
  return (str || "").replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").trim();
}

function safeStr(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try { return String(v); } catch { return JSON.stringify(v) || ""; }
}

// ── Priority keywords for re-ranking ────────────────────────────────────
// Articles matching these get boosted to the top of the results.

const PRIORITY_TERMS = [
  // Structural cardiology
  "structural heart", "structural intervention",
  // Transcatheter valve therapies
  "transcatheter", "tavr", "tavi", "tmvr", "teer", "mitraclip",
  "valve replacement", "valve repair", "valve intervention",
  "aortic valve", "mitral valve", "tricuspid valve", "pulmonic valve",
  "aortic stenosis", "aortic regurgitation",
  "mitral regurgitation", "mitral stenosis",
  "tricuspid regurgitation",
  "paravalvular leak", "valve-in-valve", "balloon valvuloplasty",
  // Coronary artery disease
  "coronary artery disease", "coronary intervention",
  "percutaneous coronary", "pci", "cabg", "coronary bypass",
  "stent", "drug-eluting", "bare-metal",
  "acute coronary syndrome", "myocardial infarction",
  "ischemic heart", "angina", "revascularization",
  "bifurcation lesion", "left main", "chronic total occlusion",
  "intravascular ultrasound", "ivus", "oct", "ffr",
  // Cardiovascular imaging
  "cardiac imaging", "cardiovascular imaging", "cardiac magnetic resonance",
  "cardiac mri", "cmr", "cardiac ct", "coronary ct", "ccta",
  "echocardiography", "echocardiographic", "transthoracic echo",
  "transesophageal echo", "strain imaging", "speckle tracking",
  "stress echo", "dobutamine stress",
  "cardiac pet", "myocardial perfusion", "perfusion imaging",
  "nuclear cardiology", "spect",
  "calcium score", "coronary calcium", "cac score",
  "ct angiography", "mra", "cardiac angiography",
  "t1 mapping", "t2 mapping", "late gadolinium", "gadolinium enhancement",
  "4d flow", "strain rate", "global longitudinal strain",
  "cardiac computed tomography", "cardiac catheterization",
];

function scorePriority(text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of PRIORITY_TERMS) {
    if (lower.includes(term)) score++;
  }
  return score;
}

// ── PubMed ──────────────────────────────────────────────────────────────

async function fetchPubMed(days, maxResults) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - days);

  const pad = (d) => `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  const dateRange = `${pad(start)}:${pad(today)}[dp]`;
  const journalFilter = HIGH_IMPACT_JOURNALS.map(j => `"${j}"[journal]`).join(" OR ");

  // Broad cardiology query + structural/transcatheter/CAD terms for wider recall
  const query = `(cardiology OR cardiovascular OR cardiac OR heart failure`
    + ` OR structural heart OR transcatheter OR TAVR OR TAVI`
    + ` OR aortic stenosis OR mitral regurgitation OR valve replacement`
    + ` OR coronary artery disease OR percutaneous coronary intervention`
    + ` OR myocardial infarction OR acute coronary syndrome`
    + ` OR revascularization OR stent OR CABG`
    + ` OR cardiac imaging OR echocardiography OR cardiac MRI`
    + ` OR coronary CT angiography OR myocardial perfusion OR cardiac PET)`
    + ` AND (${journalFilter}) AND ${dateRange}`;

  // Overfetch from PubMed so we have a larger pool to re-rank
  const fetchCount = Math.min(maxResults * 3, 100);
  const searchUrl = `${PUBMED_BASE}/esearch.fcgi?db=pubmed&retmode=json&retmax=${fetchCount}&sort=relevance&term=${encodeURIComponent(query)}`;

  const raw = await httpGet(searchUrl);
  const ids = JSON.parse(raw)?.esearchresult?.idlist || [];
  if (ids.length === 0) return [];

  const fetchUrl = `${PUBMED_BASE}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`;
  const xml = await httpGet(fetchUrl);

  const articles = [];
  const artMatches = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];

  for (const artXml of artMatches) {
    const title = (artXml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1] || "No title").replace(/<[^>]*>/g, "");
    const journal = artXml.match(/<Title>([\s\S]*?)<\/Title>/)?.[1] || "Unknown";

    const authorMatches = artXml.match(/<Author[\s\S]*?<\/Author>/g) || [];
    const names = [];
    for (const a of authorMatches.slice(0, 3)) {
      const last = a.match(/<LastName>(.*?)<\/LastName>/)?.[1] || "";
      const init = a.match(/<Initials>(.*?)<\/Initials>/)?.[1] || "";
      if (last) names.push(`${last} ${init}`.trim());
    }
    let authors = names.join(", ");
    if (authorMatches.length > 3) authors += " et al.";

    const year = artXml.match(/<PubDate>[\s\S]*?<Year>(\d+)<\/Year>/)?.[1] || "";
    const month = artXml.match(/<PubDate>[\s\S]*?<Month>(.*?)<\/Month>/)?.[1] || "";
    const day = artXml.match(/<PubDate>[\s\S]*?<Day>(\d+)<\/Day>/)?.[1] || "";
    const date = [year, month, day].filter(Boolean).join(" ");

    const pmid = artXml.match(/<PMID[^>]*>(.*?)<\/PMID>/)?.[1] || "";
    const doiMatch = artXml.match(/<ArticleId IdType="doi">(.*?)<\/ArticleId>/);
    const doi = doiMatch?.[1] || "";

    // Extract abstract for better priority scoring
    const abstractText = (artXml.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [])
      .map(m => m.replace(/<[^>]*>/g, "")).join(" ");

    const priority = scorePriority(title + " " + abstractText);

    articles.push({ title, authors, journal, date, pmid, doi, priority });
  }

  // Sort: priority keywords first (descending), then preserve PubMed relevance order
  articles.sort((a, b) => b.priority - a.priority);

  // Return capped results (strip internal priority field)
  return articles.slice(0, maxResults).map(({ priority, ...rest }) => rest);
}

// ── RSS News ────────────────────────────────────────────────────────────

async function fetchNews(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const parser = new Parser({ timeout: 10000 });
  const items = [];

  for (const feedCfg of NEWS_FEEDS) {
    let feed;
    try {
      feed = await parser.parseURL(feedCfg.url);
    } catch {
      continue;
    }

    for (const entry of feed.items || []) {
      const pubDate = entry.pubDate || entry.isoDate;
      if (pubDate) {
        const pd = new Date(pubDate);
        if (!isNaN(pd.getTime()) && pd < cutoff) continue;
      }

      if (feedCfg.keywords) {
        const text = (safeStr(entry.title) + " " + safeStr(entry.contentSnippet || entry.content)).toLowerCase();
        if (!feedCfg.keywords.some(k => text.includes(k))) continue;
      }

      let summary = stripHtml(safeStr(entry.contentSnippet || entry.content));
      if (summary.length > 200) {
        summary = summary.slice(0, 200).replace(/\s+\S*$/, "") + "...";
      }

      items.push({
        title: stripHtml(safeStr(entry.title) || "No title"),
        source: feedCfg.name,
        date: pubDate || "Unknown",
        link: entry.link || "",
        summary,
      });
    }
  }

  const seen = new Set();
  return items.filter(item => {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── API Routes ──────────────────────────────────────────────────────────

app.get("/api/digest", async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const maxArticles = Math.min(parseInt(req.query.max) || 30, 100);

  try {
    const [research, news] = await Promise.all([
      fetchPubMed(days, maxArticles).catch(() => []),
      fetchNews(days).catch(() => []),
    ]);

    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - days);

    res.json({
      period: {
        start: start.toISOString(),
        end: today.toISOString(),
        days,
      },
      research,
      news,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Cardio Weekly running at http://localhost:${PORT}\n`);
});
