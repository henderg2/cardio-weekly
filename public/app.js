// ── Service Worker ───────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  // Bust old cache on each load to avoid stale content
  navigator.serviceWorker.register("/sw.js").catch(function() {});
}

// ── DOM refs ────────────────────────────────────────────────────────
var researchList = document.getElementById("researchList");
var newsList = document.getElementById("newsList");
var loading = document.getElementById("loading");
var periodEl = document.getElementById("period");
var refreshBtn = document.getElementById("refreshBtn");
var researchCount = document.getElementById("researchCount");
var newsCount = document.getElementById("newsCount");

// ── Refresh ─────────────────────────────────────────────────────────
refreshBtn.addEventListener("click", function() { loadDigest(); });

// ── Render helpers ──────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr || dateStr === "Unknown") return dateStr || "";
  try {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch (e) {
    return dateStr;
  }
}

function escHtml(s) {
  var d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function renderResearch(articles) {
  if (!articles.length) {
    researchList.innerHTML = '<p class="empty-msg">No research articles this week.</p>';
    return;
  }

  var html = "";
  for (var i = 0; i < articles.length; i++) {
    var a = articles[i];
    var href = a.doi
      ? "https://doi.org/" + encodeURI(a.doi)
      : "https://pubmed.ncbi.nlm.nih.gov/" + encodeURIComponent(a.pmid) + "/";
    html += '<a class="card" href="' + escHtml(href) + '" target="_blank" rel="noopener">'
      + '<span class="card-journal">' + escHtml(a.journal) + '</span>'
      + '<div class="card-title">' + escHtml(a.title) + '</div>'
      + '<div class="card-meta">' + escHtml(a.authors) + '</div>'
      + '<div class="card-meta">' + escHtml(a.date) + '</div>'
      + '</a>';
  }
  researchList.innerHTML = html;
}

function renderNews(news) {
  if (!news.length) {
    newsList.innerHTML = '<p class="empty-msg">No news items this week.</p>';
    return;
  }

  var html = "";
  for (var i = 0; i < news.length; i++) {
    var n = news[i];
    var tag = n.link ? "a" : "div";
    var hrefAttr = n.link ? ' href="' + escHtml(n.link) + '" target="_blank" rel="noopener"' : "";
    html += '<' + tag + ' class="card"' + hrefAttr + '>'
      + '<span class="card-source">' + escHtml(n.source) + '</span>'
      + '<div class="card-title">' + escHtml(n.title) + '</div>'
      + '<div class="card-meta">' + formatDate(n.date) + '</div>'
      + (n.summary ? '<div class="card-summary">' + escHtml(n.summary) + '</div>' : '')
      + '</' + tag + '>';
  }
  newsList.innerHTML = html;
}

function showSkeletons(container, count) {
  var html = "";
  for (var i = 0; i < (count || 3); i++) {
    html += '<div class="skeleton"></div>';
  }
  container.innerHTML = html;
}

// ── Load data ───────────────────────────────────────────────────────
function loadDigest() {
  refreshBtn.classList.add("spinning");
  loading.classList.remove("hidden");
  showSkeletons(researchList, 3);
  showSkeletons(newsList, 3);

  fetch("/api/digest?days=7&max=30")
    .then(function(res) {
      if (!res.ok) throw new Error("Server error");
      return res.json();
    })
    .then(function(data) {
      // Period
      var start = new Date(data.period.start);
      var end = new Date(data.period.end);
      var opts = { month: "short", day: "numeric" };
      var endOpts = { month: "short", day: "numeric", year: "numeric" };
      periodEl.textContent = start.toLocaleDateString("en-US", opts) + " \u2013 " + end.toLocaleDateString("en-US", endOpts);

      // Counts
      researchCount.textContent = data.research.length;
      newsCount.textContent = data.news.length;

      renderResearch(data.research);
      renderNews(data.news);

      loading.classList.add("hidden");
    })
    .catch(function() {
      loading.innerHTML = '<p style="color:var(--red)">Failed to load. Tap refresh to try again.</p>';
      researchList.innerHTML = "";
      newsList.innerHTML = "";
    })
    .finally(function() {
      refreshBtn.classList.remove("spinning");
    });
}

// ── Init ────────────────────────────────────────────────────────────
loadDigest();
