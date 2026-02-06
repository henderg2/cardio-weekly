#!/usr/bin/env node
/**
 * Cardiology Weekly Digest
 * Compiles the week's highest-impact cardiology research and business news.
 *
 * Usage:
 *   node cardio-weekly.js              # default 7-day look-back
 *   node cardio-weekly.js --days 14    # 14-day look-back
 *   node cardio-weekly.js -o digest.md # also save as markdown
 */

const https = require("https");
const http = require("http");
const { parseString } = require("xml2js");
const Parser = require("rss-parser");
const chalk = require("chalk");
const fs = require("fs");
const path = require("path");

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

function xmlParse(xml) {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function fmtDate(d) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function stripHtml(str) {
  return (str || "").replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").trim();
}

// ── PubMed research ─────────────────────────────────────────────────────

async function fetchPubMedArticles(days = 7, maxResults = 15) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - days);

  const pad = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}/${m}/${dd}`;
  };

  const dateRange = `${pad(start)}:${pad(today)}[dp]`;
  const journalFilter = HIGH_IMPACT_JOURNALS.map((j) => `"${j}"[journal]`).join(" OR ");
  const query = `(cardiology OR cardiovascular OR cardiac OR heart failure) AND (${journalFilter}) AND ${dateRange}`;

  const searchUrl =
    `${PUBMED_BASE}/esearch.fcgi?db=pubmed&retmode=json&retmax=${maxResults}&sort=relevance&term=${encodeURIComponent(query)}`;

  console.log(chalk.dim("  Searching PubMed..."));

  let ids;
  try {
    const raw = await httpGet(searchUrl);
    const data = JSON.parse(raw);
    ids = data?.esearchresult?.idlist || [];
    console.log(chalk.dim(`  Found ${ids.length} PubMed results`));
  } catch (e) {
    console.log(chalk.red(`  PubMed search failed: ${e.message}`));
    return [];
  }

  if (ids.length === 0) return [];

  const fetchUrl = `${PUBMED_BASE}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`;
  let xml;
  try {
    xml = await httpGet(fetchUrl);
  } catch (e) {
    console.log(chalk.red(`  PubMed fetch failed: ${e.message}`));
    return [];
  }

  // Parse XML manually for reliability
  const articles = [];
  const artMatches = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];

  for (const artXml of artMatches) {
    const title = (artXml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1] || "No title").replace(/<[^>]*>/g, "");
    const journal = artXml.match(/<Title>([\s\S]*?)<\/Title>/)?.[1] || "Unknown";

    // Authors
    const authorMatches = artXml.match(/<Author[\s\S]*?<\/Author>/g) || [];
    const names = [];
    for (const a of authorMatches.slice(0, 3)) {
      const last = a.match(/<LastName>(.*?)<\/LastName>/)?.[1] || "";
      const init = a.match(/<Initials>(.*?)<\/Initials>/)?.[1] || "";
      if (last) names.push(`${last} ${init}`.trim());
    }
    let authors = names.join(", ");
    if (authorMatches.length > 3) authors += " et al.";

    // Date
    const year = artXml.match(/<PubDate>[\s\S]*?<Year>(\d+)<\/Year>/)?.[1] || "";
    const month = artXml.match(/<PubDate>[\s\S]*?<Month>(.*?)<\/Month>/)?.[1] || "";
    const day = artXml.match(/<PubDate>[\s\S]*?<Day>(\d+)<\/Day>/)?.[1] || "";
    const dateStr = [year, month, day].filter(Boolean).join(" ");

    const pmid = artXml.match(/<PMID[^>]*>(.*?)<\/PMID>/)?.[1] || "";

    // DOI
    const doiMatch = artXml.match(/<ArticleId IdType="doi">(.*?)<\/ArticleId>/);
    const doi = doiMatch?.[1] || "";

    articles.push({ title, authors, journal, date: dateStr, pmid, doi });
  }

  return articles;
}

// ── RSS business news ───────────────────────────────────────────────────

async function fetchNews(days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const parser = new Parser({ timeout: 10000 });
  const items = [];

  for (const feedCfg of NEWS_FEEDS) {
    process.stdout.write(chalk.dim(`  Fetching ${feedCfg.name}...`));
    let feed;
    try {
      feed = await parser.parseURL(feedCfg.url);
      process.stdout.write(chalk.dim(` ${(feed.items || []).length} items\n`));
    } catch {
      process.stdout.write(chalk.yellow(" skipped\n"));
      continue;
    }

    for (const entry of feed.items || []) {
      // Date filter
      const pubDate = entry.pubDate || entry.isoDate;
      if (pubDate) {
        const pd = new Date(pubDate);
        if (pd < cutoff) continue;
      }

      // Keyword filter
      const safeStr = (v) => {
        if (typeof v === "string") return v;
        if (v == null) return "";
        try { return String(v); } catch { return JSON.stringify(v) || ""; }
      };
      if (feedCfg.keywords) {
        const text = (safeStr(entry.title) + " " + safeStr(entry.contentSnippet || entry.content)).toLowerCase();
        if (!feedCfg.keywords.some((k) => text.includes(k))) continue;
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

  // Deduplicate
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Rendering ───────────────────────────────────────────────────────────

function renderTerminal(articles, news, days) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  const header = `Cardiology Weekly Digest  (${fmtDate(start)} – ${fmtDate(today)})`;

  const divider = "═".repeat(66);

  console.log();
  console.log(chalk.bold.blue(`╔${"═".repeat(header.length + 2)}╗`));
  console.log(chalk.bold.blue(`║ ${header} ║`));
  console.log(chalk.bold.blue(`╚${"═".repeat(header.length + 2)}╝`));

  // Research
  console.log();
  console.log(chalk.cyan.bold("  ┌─ Research Publications ─────────────────────────────────────┐"));
  if (articles.length === 0) {
    console.log(chalk.dim("  │ No articles found for this period.                         │"));
  }
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    console.log();
    console.log(`  ${chalk.bold.white(`${i + 1}.`)} ${a.title}`);
    console.log(chalk.dim(`     ${a.authors}`));
    console.log(`     ${chalk.italic(a.journal)} ${chalk.dim(`| ${a.date}`)}`);
    if (a.doi) {
      console.log(chalk.blue(`     https://doi.org/${a.doi}`));
    } else if (a.pmid) {
      console.log(chalk.dim(`     PMID: ${a.pmid}`));
    }
  }
  console.log();
  console.log(chalk.cyan("  └─────────────────────────────────────────────────────────────┘"));

  // News
  console.log();
  console.log(chalk.green.bold("  ┌─ Business & Industry News ──────────────────────────────────┐"));
  if (news.length === 0) {
    console.log(chalk.dim("  │ No news items found for this period.                       │"));
  }
  for (let i = 0; i < news.length; i++) {
    const n = news[i];
    console.log();
    console.log(`  ${chalk.bold.white(`${i + 1}.`)} ${n.title}`);
    const dateDisplay = (() => {
      try {
        const d = new Date(n.date);
        return isNaN(d.getTime()) ? n.date : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      } catch { return n.date; }
    })();
    console.log(chalk.dim(`     ${n.source} | ${dateDisplay}`));
    if (n.summary) console.log(`     ${chalk.dim(n.summary)}`);
    if (n.link) console.log(chalk.blue(`     ${n.link}`));
  }
  console.log();
  console.log(chalk.green("  └─────────────────────────────────────────────────────────────┘"));
  console.log();
  console.log(chalk.dim(`  ${divider}`));
  console.log(chalk.dim(`  ${articles.length} research articles · ${news.length} news items`));
  console.log();
}

function saveMarkdown(articles, news, days, outputFile) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  const header = `Cardiology Weekly Digest (${fmtDate(start)} – ${fmtDate(today)})`;

  const lines = [`# ${header}\n`];

  lines.push("## Research Publications\n");
  if (articles.length === 0) {
    lines.push("*No articles found for this period.*\n");
  }
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    lines.push(`### ${i + 1}. ${a.title}\n`);
    lines.push(`**${a.authors}**  `);
    lines.push(`*${a.journal}* | ${a.date}  `);
    if (a.doi) {
      lines.push(`[DOI](https://doi.org/${a.doi}) | PMID: ${a.pmid}\n`);
    } else {
      lines.push(`PMID: ${a.pmid}\n`);
    }
  }

  lines.push("---\n");
  lines.push("## Business & Industry News\n");
  if (news.length === 0) {
    lines.push("*No news items found for this period.*\n");
  }
  for (let i = 0; i < news.length; i++) {
    const n = news[i];
    lines.push(`### ${i + 1}. ${n.title}\n`);
    lines.push(`*${n.source}* | ${n.date}  `);
    if (n.summary) lines.push(`${n.summary}  `);
    if (n.link) lines.push(`[Read more](${n.link})\n`);
  }

  fs.writeFileSync(outputFile, lines.join("\n"), "utf-8");
  console.log(chalk.green(`  Saved to ${outputFile}`));
}

// ── CLI ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let days = 7;
  let maxArticles = 15;
  let outputFile = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--days" || args[i] === "-d") && args[i + 1]) {
      days = parseInt(args[++i], 10);
    } else if ((args[i] === "--max" || args[i] === "-n") && args[i + 1]) {
      maxArticles = parseInt(args[++i], 10);
    } else if ((args[i] === "--output" || args[i] === "-o") && args[i + 1]) {
      outputFile = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
  ${chalk.bold("Cardiology Weekly Digest")}

  ${chalk.dim("Usage:")}
    node cardio-weekly.js [options]

  ${chalk.dim("Options:")}
    -d, --days <n>     Look-back window in days (default: 7)
    -n, --max <n>      Max PubMed articles (default: 15)
    -o, --output <f>   Save digest as markdown file
    -h, --help         Show this help
`);
      process.exit(0);
    }
  }

  console.log(chalk.dim(`\n  Compiling ${days}-day cardiology digest...\n`));

  const [articles, news] = await Promise.all([
    fetchPubMedArticles(days, maxArticles),
    fetchNews(days),
  ]);

  renderTerminal(articles, news, days);

  if (outputFile) {
    saveMarkdown(articles, news, days, outputFile);
  }
}

main().catch((e) => {
  console.error(chalk.red(`Error: ${e.message}`));
  process.exit(1);
});
