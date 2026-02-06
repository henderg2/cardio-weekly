// ── Service Worker ───────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
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
var savedScreen = document.getElementById("savedScreen");
var savedList = document.getElementById("savedList");
var savedCount = document.getElementById("savedCount");
var savedEmpty = document.getElementById("savedEmpty");
var categoryChips = document.getElementById("categoryChips");
var libraryBtn = document.getElementById("libraryBtn");
var libraryBadge = document.getElementById("libraryBadge");
var savedBackBtn = document.getElementById("savedBackBtn");
var exportBtn = document.getElementById("exportBtn");
var categoryModal = document.getElementById("categoryModal");
var modalChips = document.getElementById("modalChips");
var modalClose = document.getElementById("modalClose");
var newCategoryInput = document.getElementById("newCategoryInput");
var addCategoryBtn = document.getElementById("addCategoryBtn");
var toastEl = document.getElementById("toast");

// ── Bookmark & category state ───────────────────────────────────────
var bookmarks = {};
var categories = [];
var activeCategoryFilter = "All";
var pendingBookmarkArticle = null;

function loadBookmarks() {
  try {
    var raw = localStorage.getItem("cardio-bookmarks");
    if (raw) bookmarks = JSON.parse(raw);
  } catch (e) { bookmarks = {}; }
  try {
    var raw2 = localStorage.getItem("cardio-categories");
    if (raw2) categories = JSON.parse(raw2);
  } catch (e) { categories = []; }
}

function saveBookmarks() {
  localStorage.setItem("cardio-bookmarks", JSON.stringify(bookmarks));
  localStorage.setItem("cardio-categories", JSON.stringify(categories));
}

function getArticleId(article) {
  return article.pmid || article.link || article.title;
}

function isBookmarked(article) {
  return !!bookmarks[getArticleId(article)];
}

loadBookmarks();

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

// ── SVG Icons ───────────────────────────────────────────────────────
var bookmarkOutlineIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
var bookmarkFilledIcon = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
var shareIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
var removeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
var moveIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L12 22"/><path d="M17 7l-5-5-5 5"/><path d="M17 17l-5 5-5-5"/><path d="M2 12h20"/><path d="M7 7L2 12l5 5"/><path d="M17 7l5 5-5 5"/></svg>';

// ── Action bar HTML ─────────────────────────────────────────────────
function buildActionBar(article, type) {
  var id = getArticleId(article);
  var saved = isBookmarked(article);
  var bmIcon = saved ? bookmarkFilledIcon : bookmarkOutlineIcon;
  var bmClass = saved ? "action-btn bookmarked" : "action-btn";
  var badge = "";
  if (saved && bookmarks[id]) {
    badge = '<span class="category-badge">' + escHtml(bookmarks[id].category) + '</span>';
  }
  return '<div class="card-actions">'
    + '<button class="' + bmClass + '" data-action="bookmark" data-type="' + type + '" data-id="' + escHtml(id) + '" aria-label="Bookmark">' + bmIcon + '</button>'
    + '<button class="action-btn" data-action="share" data-type="' + type + '" data-id="' + escHtml(id) + '" aria-label="Share">' + shareIcon + '</button>'
    + badge
    + '</div>';
}

// ── Store article data for later retrieval ──────────────────────────
var articleMap = {};

function storeArticle(article, type) {
  var id = getArticleId(article);
  articleMap[id] = { data: article, type: type };
}

function getArticleHref(a) {
  if (a.doi) return "https://doi.org/" + encodeURI(a.doi);
  if (a.pmid) return "https://pubmed.ncbi.nlm.nih.gov/" + encodeURIComponent(a.pmid) + "/";
  return a.link || "";
}

// ── Render research ─────────────────────────────────────────────────
function renderResearch(articles) {
  if (!articles.length) {
    researchList.innerHTML = '<p class="empty-msg">No research articles this week.</p>';
    return;
  }

  var html = "";
  for (var i = 0; i < articles.length; i++) {
    var a = articles[i];
    storeArticle(a, "research");
    var href = getArticleHref(a);
    html += '<a class="card" href="' + escHtml(href) + '" target="_blank" rel="noopener">'
      + '<span class="card-journal">' + escHtml(a.journal) + '</span>'
      + '<div class="card-title">' + escHtml(a.title) + '</div>'
      + '<div class="card-meta">' + escHtml(a.authors) + '</div>'
      + '<div class="card-meta">' + escHtml(a.date) + '</div>'
      + buildActionBar(a, "research")
      + '</a>';
  }
  researchList.innerHTML = html;
}

// ── Render news ─────────────────────────────────────────────────────
function renderNews(news) {
  if (!news.length) {
    newsList.innerHTML = '<p class="empty-msg">No news items this week.</p>';
    return;
  }

  var html = "";
  for (var i = 0; i < news.length; i++) {
    var n = news[i];
    storeArticle(n, "news");
    var tag = n.link ? "a" : "div";
    var hrefAttr = n.link ? ' href="' + escHtml(n.link) + '" target="_blank" rel="noopener"' : "";
    html += '<' + tag + ' class="card"' + hrefAttr + '>'
      + '<span class="card-source">' + escHtml(n.source) + '</span>'
      + '<div class="card-title">' + escHtml(n.title) + '</div>'
      + '<div class="card-meta">' + formatDate(n.date) + '</div>'
      + (n.summary ? '<div class="card-summary">' + escHtml(n.summary) + '</div>' : '')
      + buildActionBar(n, "news")
      + '</' + tag + '>';
  }
  newsList.innerHTML = html;
}

// ── Saved screen ────────────────────────────────────────────────────
function openSavedScreen() {
  renderSaved();
  savedScreen.classList.add("open");
}

function closeSavedScreen() {
  savedScreen.classList.remove("open");
}

libraryBtn.addEventListener("click", openSavedScreen);
savedBackBtn.addEventListener("click", closeSavedScreen);

// ── Export library ──────────────────────────────────────────────────
exportBtn.addEventListener("click", exportLibrary);

function csvEscape(str) {
  var s = String(str || "");
  if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function exportLibrary() {
  var keys = Object.keys(bookmarks);
  if (!keys.length) {
    showToast("Nothing to export");
    return;
  }

  var rows = ["Category,Title,Source,URL"];
  for (var i = 0; i < keys.length; i++) {
    var bm = bookmarks[keys[i]];
    var art = bm.articleData;
    var row = csvEscape(bm.category)
      + "," + csvEscape(art.title || "Untitled")
      + "," + csvEscape(art.journal || art.source || "")
      + "," + csvEscape(getArticleHref(art));
    rows.push(row);
  }

  var csv = rows.join("\n");

  if (navigator.share && navigator.canShare) {
    var file = new File([csv], "cardio-library.csv", { type: "text/csv" });
    var shareData = { title: "Cardio Weekly Library", files: [file] };
    if (navigator.canShare(shareData)) {
      navigator.share(shareData).catch(function() {});
      return;
    }
  }

  // Fallback: download file
  var blob = new Blob([csv], { type: "text/csv" });
  var dlUrl = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = dlUrl;
  a.download = "cardio-library.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(dlUrl);
  showToast("Downloaded!");
}

function updateLibraryBadge() {
  var count = Object.keys(bookmarks).length;
  if (count > 0) {
    libraryBadge.textContent = count;
    libraryBadge.classList.remove("hidden");
  } else {
    libraryBadge.classList.add("hidden");
  }
}

function renderSaved() {
  var keys = Object.keys(bookmarks);
  updateLibraryBadge();

  if (!keys.length) {
    categoryChips.innerHTML = "";
    savedList.innerHTML = "";
    savedEmpty.style.display = "";
    savedCount.textContent = "0";
    return;
  }

  savedEmpty.style.display = "none";

  // Category chips
  var usedCategories = [];
  for (var i = 0; i < keys.length; i++) {
    var cat = bookmarks[keys[i]].category;
    if (usedCategories.indexOf(cat) === -1) usedCategories.push(cat);
  }

  // Reset filter if the active category no longer exists
  if (activeCategoryFilter !== "All" && usedCategories.indexOf(activeCategoryFilter) === -1) {
    activeCategoryFilter = "All";
  }

  var chipsHtml = '<span class="chip' + (activeCategoryFilter === "All" ? " active" : "") + '" data-filter="All">All</span>';
  for (var j = 0; j < usedCategories.length; j++) {
    var c = usedCategories[j];
    chipsHtml += '<span class="chip' + (activeCategoryFilter === c ? " active" : "") + '" data-filter="' + escHtml(c) + '">' + escHtml(c) + '</span>';
  }
  categoryChips.innerHTML = chipsHtml;

  // Filtered cards
  var filtered = [];
  for (var k = 0; k < keys.length; k++) {
    var bm = bookmarks[keys[k]];
    if (activeCategoryFilter === "All" || bm.category === activeCategoryFilter) {
      filtered.push({ id: keys[k], bookmark: bm });
    }
  }

  savedCount.textContent = filtered.length;

  if (!filtered.length) {
    savedList.innerHTML = '<p class="empty-msg">No saved articles in this category.</p>';
    return;
  }

  var html = "";
  for (var m = 0; m < filtered.length; m++) {
    var item = filtered[m];
    var bData = item.bookmark;
    var aData = bData.articleData;
    var href = getArticleHref(aData);
    var tag = href ? "a" : "div";
    var hrefAttr = href ? ' href="' + escHtml(href) + '" target="_blank" rel="noopener"' : "";

    html += '<' + tag + ' class="card saved-card"' + hrefAttr + '>'
      + '<div class="card-title">' + escHtml(aData.title) + '</div>'
      + '<div class="card-meta">' + escHtml(aData.journal || aData.source || "") + '</div>'
      + '<div class="card-actions">'
      + '<span class="category-badge">' + escHtml(bData.category) + '</span>'
      + '<button class="action-btn" data-action="recategorize" data-id="' + escHtml(item.id) + '" aria-label="Change category">' + moveIcon + '</button>'
      + '<button class="action-btn" data-action="remove" data-id="' + escHtml(item.id) + '" aria-label="Remove">' + removeIcon + '</button>'
      + '</div>'
      + '</' + tag + '>';
  }
  savedList.innerHTML = html;
}

// ── Category chip filter click ──────────────────────────────────────
categoryChips.addEventListener("click", function(e) {
  var chip = e.target.closest(".chip");
  if (!chip) return;
  activeCategoryFilter = chip.getAttribute("data-filter");
  renderSaved();
});

// ── Action button handling (bookmark & share) ───────────────────────
document.addEventListener("click", function(e) {
  var btn = e.target.closest("[data-action]");
  if (!btn) return;

  var action = btn.getAttribute("data-action");
  var id = btn.getAttribute("data-id");

  if (action === "bookmark" || action === "share") {
    e.preventDefault();
    e.stopPropagation();
  }

  if (action === "bookmark") {
    if (isBookmarkedById(id)) {
      delete bookmarks[id];
      saveBookmarks();
      rerenderAll();
    } else {
      var artInfo = articleMap[id];
      if (artInfo) {
        pendingBookmarkArticle = { id: id, data: artInfo.data, type: artInfo.type };
        openCategoryModal();
      }
    }
  }

  if (action === "share") {
    var artInfo2 = articleMap[id];
    if (artInfo2) {
      shareArticle(artInfo2.data);
    }
  }

  if (action === "recategorize") {
    e.preventDefault();
    e.stopPropagation();
    var existing = bookmarks[id];
    if (existing) {
      pendingBookmarkArticle = { id: id, data: existing.articleData, type: existing.type };
      openCategoryModal();
    }
  }

  if (action === "remove") {
    e.preventDefault();
    e.stopPropagation();
    delete bookmarks[id];
    saveBookmarks();
    rerenderAll();
  }
});

function isBookmarkedById(id) {
  return !!bookmarks[id];
}

function rerenderAll() {
  // Re-render the main lists to update bookmark icons
  var researchCards = [];
  var newsCards = [];
  var keys = Object.keys(articleMap);
  for (var i = 0; i < keys.length; i++) {
    var entry = articleMap[keys[i]];
    if (entry.type === "research") researchCards.push(entry.data);
    if (entry.type === "news") newsCards.push(entry.data);
  }
  if (researchCards.length) renderResearch(researchCards);
  if (newsCards.length) renderNews(newsCards);
  renderSaved();
}

// ── Category picker modal ───────────────────────────────────────────
function openCategoryModal() {
  categoryModal.classList.remove("hidden");
  renderModalChips();
  newCategoryInput.value = "";
}

function closeCategoryModal() {
  categoryModal.classList.add("hidden");
  pendingBookmarkArticle = null;
}

function renderModalChips() {
  if (!categories.length) {
    modalChips.innerHTML = '<span style="color:var(--text-dim);font-size:13px;">No categories yet. Create one below.</span>';
    return;
  }
  var html = "";
  for (var i = 0; i < categories.length; i++) {
    html += '<span class="modal-chip" data-cat="' + escHtml(categories[i]) + '">' + escHtml(categories[i]) + '</span>';
  }
  modalChips.innerHTML = html;
}

function selectCategory(catName) {
  if (!pendingBookmarkArticle) return;
  bookmarks[pendingBookmarkArticle.id] = {
    category: catName,
    articleData: pendingBookmarkArticle.data,
    type: pendingBookmarkArticle.type,
    savedAt: Date.now()
  };
  saveBookmarks();
  closeCategoryModal();
  rerenderAll();
  showToast("Saved to " + catName);
}

modalChips.addEventListener("click", function(e) {
  var chip = e.target.closest(".modal-chip");
  if (!chip) return;
  var cat = chip.getAttribute("data-cat");
  selectCategory(cat);
});

addCategoryBtn.addEventListener("click", function() {
  addNewCategory();
});

newCategoryInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    addNewCategory();
  }
});

function addNewCategory() {
  var name = newCategoryInput.value.trim();
  if (!name) return;
  if (categories.indexOf(name) === -1) {
    categories.push(name);
    saveBookmarks();
  }
  selectCategory(name);
}

modalClose.addEventListener("click", closeCategoryModal);

categoryModal.addEventListener("click", function(e) {
  if (e.target === categoryModal) closeCategoryModal();
});

// ── Share ────────────────────────────────────────────────────────────
function shareArticle(article) {
  var title = article.title || "Cardio Weekly article";
  var url = getArticleHref(article);
  var text = title + "\n" + url;

  if (navigator.share) {
    navigator.share({ title: title, url: url }).catch(function() {});
  } else if (navigator.clipboard && url) {
    navigator.clipboard.writeText(text).then(function() {
      showToast("Copied!");
    }).catch(function() {
      showToast("Couldn't copy link");
    });
  } else {
    showToast("Sharing not supported");
  }
}

// ── Toast ────────────────────────────────────────────────────────────
var toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  // Force reflow for transition
  void toastEl.offsetWidth;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() {
    toastEl.classList.remove("visible");
    setTimeout(function() {
      toastEl.classList.add("hidden");
    }, 300);
  }, 1800);
}

// ── Skeleton loading ────────────────────────────────────────────────
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
      updateLibraryBadge();

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
updateLibraryBadge();
loadDigest();
