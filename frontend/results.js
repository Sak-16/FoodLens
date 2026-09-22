let currentUser = null;
let currentData = null;
let pendingCelebration = false;

const byId = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  currentUser = requireAuth();
  if (!currentUser) return; // redirected to login

  plantProduce();
  wireLogout();
  wireBrandHome();

  byId("userPill").textContent = currentUser.name || currentUser.email;

  byId("backToDashFromResults").addEventListener("click", () => {
    window.location.href = "dashboard.html";
  });
  byId("scanAnotherBtn").addEventListener("click", () => {
    window.location.href = "scan.html";
  });

  syncNavHeight();
  watchDockStuck();
  window.addEventListener("resize", () => {
    syncNavHeight();
    positionTabIndicator();
    watchDockStuck();
  });
  // web fonts change text widths after first paint — re-measure the tab pill
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionTabIndicator);

  const data = getLatestResult();
  if (!data) {
    // nothing to show — send them to scan a label first
    window.location.href = "scan.html";
    return;
  }

  wireResultTabs();
  wireShare();
  renderResults(data);
});

// The sticky tab bar sits just under the navbar, so it needs the navbar's
// real height rather than a guess.
function syncNavHeight() {
  const nav = document.querySelector(".navbar");
  if (nav) document.documentElement.style.setProperty("--nav-h", `${nav.offsetHeight}px`);
}

// ============================================================
// RESULT TABS
// ============================================================

let dockObserver = null;

// A tiny sentinel sits just above the tab bar. Once it scrolls out from
// under the navbar the bar is "stuck", and only then does it get a backing.
function watchDockStuck() {
  const sentinel = byId("dockSentinel");
  const dock = byId("tabsDock");
  if (!sentinel || !dock || !("IntersectionObserver" in window)) return;

  if (dockObserver) dockObserver.disconnect();
  const nav = document.querySelector(".navbar");
  const navH = nav ? nav.offsetHeight : 0;

  dockObserver = new IntersectionObserver(
    ([entry]) => dock.classList.toggle("is-stuck", !entry.isIntersecting && entry.boundingClientRect.top < navH),
    { rootMargin: `-${navH + 1}px 0px 0px 0px`, threshold: 0 }
  );
  dockObserver.observe(sentinel);
}

function visibleTabs() {
  return [...document.querySelectorAll(".page-tab")].filter((t) => !t.hidden);
}

function wireResultTabs() {
  const list = byId("resultTabs");

  list.addEventListener("click", (e) => {
    const tab = e.target.closest(".page-tab");
    if (tab) activateTab(tab.dataset.page, { scroll: true });
  });

  // arrow keys / Home / End move between tabs, as screen-reader users expect
  list.addEventListener("keydown", (e) => {
    const tabs = visibleTabs();
    const idx = tabs.findIndex((t) => t === document.activeElement);
    if (idx < 0) return;
    let next = null;
    if (e.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
    else if (e.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    if (next) {
      e.preventDefault();
      activateTab(next.dataset.page, { focus: true });
    }
  });
}

function activateTab(name, { focus = false, scroll = false } = {}) {
  document.querySelectorAll(".page-tab").forEach((t) => {
    const on = t.dataset.page === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  });
  document.querySelectorAll(".result-page").forEach((p) => {
    p.classList.toggle("active", p.dataset.page === name);
  });
  byId("view-results").dataset.page = name;
  positionTabIndicator();
  if (scroll) scrollToContentTop();
}

// After switching tabs, make sure the new content starts in view rather
// than leaving the reader stranded halfway down a longer tab.
function scrollToContentTop() {
  const dock = byId("tabsDock");
  const pages = byId("resultPages");
  const nav = document.querySelector(".navbar");
  const dockFixed = getComputedStyle(dock).position === "fixed";
  const offset = (nav ? nav.offsetHeight : 0) + (dockFixed ? 0 : dock.offsetHeight) + 8;
  const top = pages.getBoundingClientRect().top + window.scrollY - offset;
  if (window.scrollY > top) {
    window.scrollTo({ top: Math.max(0, top), behavior: REDUCED_MOTION ? "auto" : "smooth" });
  }
}

function positionTabIndicator() {
  const active = document.querySelector(".page-tab.active");
  const indicator = byId("pageTabIndicator");
  if (!active || !indicator) return;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.height = `${active.offsetHeight}px`;
  indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
}

// ============================================================
// RENDER RESULTS
// ============================================================

function productTitle(data) {
  const top = (data.ingredients || [])[0];
  return data.product_guess || (top ? `Label with ${top.simple_name}` : "Scanned label");
}

function renderResults(data) {
  currentData = data;
  initBasis(data);

  const title = productTitle(data);
  byId("resultEyebrow").textContent = data.score_label || "Scan result";
  byId("resultTitle").textContent = title;
  document.title = `FoodLens — ${title}`;

  byId("page-summary").innerHTML = renderHero(data) + renderScoreWhy(data) + renderFlags(data);
  byId("page-nutrition").innerHTML = renderNutrition(data) + renderSummary(data);
  byId("page-ingredients").innerHTML = renderIngredients(data);
  byId("page-vitamins").innerHTML = renderVitamins(data);

  // The vitamins tab only earns its place when the label actually
  // declares fortification — an empty tab is worse than no tab.
  const vitaminsTab = byId("vitaminsTab");
  const hasVitamins = (data.vitamins || []).length > 0 || data.vitamins_unnamed;
  if (vitaminsTab) vitaminsTab.hidden = !hasVitamins;

  activateTab("summary");

  wireHero();
  wireNutrition();
  wireIngredientToggles();
  wireIngredientFilter();
  wireVitaminToggles();
  paintNutrition({ animate: true });
  animateGauge(data);

  if (pendingCelebration) {
    // Let the gauge finish its fill (~1.1s) before the confetti pops, so
    // the two animations read as one beat rather than fighting for
    // attention.
    setTimeout(() => {
      const chip = byId("scoreDeltaChip");
      fireConfetti(chip || byId("gaugeNumber"));
      showToast({ emoji: "🎉", title: "Nice improvement!", sub: "Better than your last scan." });
    }, 1100);
  }
}

// ============================================================
// AMOUNTS: per 100 g / per serve, traffic lights, % of daily reference
// ============================================================
//
// These daily reference values are the SAME ones the backend scores with
// (FSSAI %RDA schedule for a 2,000 kcal adult; protein and fibre from
// ICMR-NIN), and the Low / Medium / High cut-offs use the same "20% / 5%
// of a day in 100 g" rule — so a card here never disagrees with the
// "What the numbers mean" section or the score reasons.

const DAILY_REF = {
  energy: 2000,        // kcal
  fat: 67,             // g
  saturated_fat: 22,   // g
  trans_fat: 2,        // g
  total_sugars: 50,    // g (FSSAI's figure is for added sugar)
  added_sugars: 50,    // g
  sodium: 2000,        // mg
  salt: 5,             // g  (2,000 mg sodium ≈ 5 g salt)
  protein: 55,         // g
  fiber: 30            // g
};

// "limit" nutrients are ones to keep an eye on; "want" nutrients are ones
// you're glad to see. Carbohydrates have no daily reference here, so they
// stay neutral rather than getting a made-up colour.
const NUTRIENT_KIND = {
  energy: "limit", fat: "limit", saturated_fat: "limit", trans_fat: "limit",
  total_sugars: "limit", added_sugars: "limit", sodium: "limit", salt: "limit",
  protein: "want", fiber: "want"
};

const LEVEL_WORD = { low: "Low", mid: "Medium", high: "High" };
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;
const BASIS_KEY = "foodlens_basis";

const basis = { mode: "100g", serve: null }; // serve: { amount, unit: "g"|"ml", source: "label"|"manual" }

// Read the serving size off the label text when it's printed there.
const SERVING_PATTERNS = [
  /serving\s*size\s*[:\-–=]?\s*[^\n]{0,30}?(\d+(?:\.\d+)?)\s*(g|gm|gms|gram|grams|ml)\b/i,
  /per\s*serv(?:e|ing)\s*(?:size)?\s*[:\-–=]?\s*[^\n]{0,20}?(\d+(?:\.\d+)?)\s*(g|gm|gms|gram|grams|ml)\b/i,
  /\(\s*(\d+(?:\.\d+)?)\s*(g|gm|gms|ml)\s*\)\s*(?:per\s*serv|serving)/i,
  /(?:1|one)\s*serv(?:e|ing)\s*(?:is|=|of|:)?\s*(\d+(?:\.\d+)?)\s*(g|gm|gms|ml)\b/i
];

function detectServing(text) {
  const t = String(text || "").replace(/[ \t]+/g, " ");
  for (const re of SERVING_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    const amount = parseFloat(m[1]);
    if (!(amount >= 1 && amount <= 1000)) continue;
    return { amount, unit: /ml/i.test(m[2]) ? "ml" : "g" };
  }
  return null;
}

function initBasis(data) {
  const found = detectServing(data.raw_text);
  basis.serve = found ? { ...found, source: "label" } : null;

  let pref = "100g";
  try {
    pref = localStorage.getItem(BASIS_KEY) || "100g";
  } catch (e) {
    /* storage blocked */
  }
  // Remembered choice applies only if there's a serving size to apply it to.
  basis.mode = pref === "serve" && basis.serve ? "serve" : "100g";
}

function basisUnit() {
  return basis.serve && basis.serve.unit === "ml" ? "ml" : "g";
}

function basisFactor() {
  return basis.mode === "serve" && basis.serve ? basis.serve.amount / 100 : 1;
}

function basisLabel() {
  if (basis.mode === "serve" && basis.serve) return `per serve (${formatAmount(basis.serve.amount)} ${basis.serve.unit})`;
  return `per 100 ${basisUnit()}`;
}

// Bring a printed value into the unit the daily reference is written in.
function baseAmount(item) {
  const v = item.value;
  if (typeof v !== "number") return null;
  const unit = String(item.unit || "").toLowerCase();
  if (item.key === "energy") return unit === "kj" ? v / 4.184 : v;
  if (item.key === "sodium") return unit === "g" ? v * 1000 : v;
  if (unit === "mg") return v / 1000;
  if (unit === "mcg" || unit === "µg" || unit === "ug") return v / 1e6;
  return v;
}

// Judged on the per-100 g amount, always, so two products compare fairly
// whatever serving size each one prints.
function assessNutrient(item, all) {
  const ref = DAILY_REF[item.key];
  const kind = NUTRIENT_KIND[item.key];
  const base = baseAmount(item);
  if (!ref || !kind || base === null) return { rated: false };

  // When added sugar is printed, the backend rates that one; total sugar
  // (which includes milk and fruit sugars) is left uncoloured.
  if (
    item.key === "total_sugars" &&
    all.some((n) => n.key === "added_sugars" && typeof n.value === "number")
  ) {
    return { rated: false };
  }

  const pct100 = (base / ref) * 100;
  let level;
  let tone;
  if (kind === "limit") {
    level = pct100 >= 20 ? "high" : pct100 >= 5 ? "mid" : "low";
    tone = level === "high" ? "bad" : level === "mid" ? "warn" : "good";
  } else {
    level = pct100 >= 20 ? "high" : pct100 >= 10 ? "mid" : "low";
    tone = level === "high" ? "mint" : level === "mid" ? "info" : ""; // low protein isn't a red flag
  }
  return { rated: true, ref, base, kind, pct100, level, tone };
}

// The traffic light for a headline number (hero chip / share-card tile).
// Total sugar is left unrated when added sugar is printed, so the sugar
// figure borrows added sugar's rating — otherwise it would show no colour
// on exactly the products where sugar is the problem.
function headlineAssessment(item, all) {
  let a = assessNutrient(item, all);
  if (!a.rated && item.key === "total_sugars") {
    const added = all.find((n) => n.key === "added_sugars");
    if (added) a = assessNutrient(added, all);
  }
  return a;
}

function pctText(pct) {
  if (pct > 0 && pct < 1) return "<1";
  return String(Math.round(pct));
}

function ringSvg(pct) {
  const filled = Math.max(0, Math.min(1, pct / 100));
  const offset = RING_C * (1 - filled);
  const label = pct >= 100 ? "100+" : `${pctText(pct)}%`;
  return `
    <div class="rda-ring" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle class="rr-track" cx="20" cy="20" r="${RING_R}" fill="none" stroke-width="4.5"></circle>
        <circle class="rr-val" cx="20" cy="20" r="${RING_R}" fill="none" stroke-width="4.5"
          stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
          style="--c:${RING_C.toFixed(2)}"></circle>
      </svg>
      <span class="rda-pct">${label}</span>
    </div>`;
}

function rdaCaption(item, a, pct) {
  const p = `<strong>${pctText(pct)}%</strong>`;
  if (item.key === "energy") return `${p} of a 2,000 kcal day`;
  return a.kind === "want" ? `${p} of your daily need` : `${p} of your daily limit`;
}

// ============================================================
// HERO VERDICT CARD (Summary)
// ============================================================

const VERDICT_WORD = {
  sodium: "sodium", salt: "salt", saturated_fat: "saturated fat", trans_fat: "trans fat",
  total_sugars: "sugar", added_sugars: "sugar", fat: "fat", energy: "calories"
};

const SCORED_WORDS = new Set(["sugar", "sodium", "saturated fat", "trans fat"]);

// "Decent pick, high in sodium" — one line built from the score band and
// the nutrients that actually stand out (same rules as the cards below).
function buildVerdict(data) {
  const scored = typeof data.score === "number";
  const items = data.nutrition || [];
  const flags = countFlags(data);

  if (!scored) {
    return items.length ? "No score yet" : "No score — the nutrition table wasn't read";
  }

  const opener = data.score >= 75 ? "Solid pick" : data.score >= 50 ? "Decent pick" : "Occasional treat";

  const rated = items
    .map((it) => ({ it, a: assessNutrient(it, items), word: VERDICT_WORD[it.key] }))
    .filter((x) => x.a.rated && x.a.kind === "limit" && x.word);

  const phrase = (level, only) => {
    const seen = new Set();
    return rated
      .filter((x) => x.a.level === level && (!only || only.has(x.word)))
      .sort((p, q) => q.a.pct100 - p.a.pct100)
      .map((x) => x.word)
      // salt and sodium are the same warning, sugar can appear twice
      .filter((w) => (seen.has(w) || (w === "salt" && rated.some((r) => r.word === "sodium")) ? false : seen.add(w)))
      .slice(0, 2)
      .join(" and ");
  };

  const highs = phrase("high");
  if (highs) return `${opener}, high in ${highs}`;

  // "moderate" is only worth saying for the nutrients the score itself weighs;
  // nearly every food is at least "medium" in calories or fat, which is noise.
  const mids = phrase("mid", SCORED_WORDS);
  if (mids) return `${opener}, moderate in ${mids}`;

  const lows = ["sugar", "sodium", "saturated fat"].filter((w) => rated.some((r) => r.word === w && r.a.level === "low"));
  if (lows.length) return `${opener}, low in ${lows.slice(0, 2).join(" and ")}`;

  return opener;
}

function renderHero(data) {
  const scored = typeof data.score === "number";
  const score = scored ? data.score : 0;
  const label = data.score_label || "Not scored";
  const toneName = !scored ? "" : scoreBand(score) === "good" ? "good" : scoreBand(score) === "okay" ? "warn" : "bad";
  const toneStyle = toneName
    ? `--tone:var(--${toneName});--tone-bg:var(--${toneName}-bg)`
    : "--tone:var(--ink-3);--tone-bg:transparent";

  const r = 54;
  const circumference = 2 * Math.PI * r;
  const flags = countFlags(data);
  const hasIngredients = (data.ingredients || []).length > 0;

  const flagBtn = flags
    ? `<button type="button" class="hero-flagbtn" id="heroFlagBtn">
         <span aria-hidden="true">👀</span> ${flags} ingredient${flags > 1 ? "s" : ""} worth a look
       </button>`
    : hasIngredients
      ? `<span class="hero-flagbtn clear"><span aria-hidden="true">✓</span> Nothing flagged in the ingredients</span>`
      : "";

  return `
    <section class="hero-card" style="${toneStyle}" aria-label="Verdict">
      <div class="gauge-wrap" role="img"
           aria-label="${scored ? `Score ${score} out of 100` : "Not scored"}">
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <circle class="gauge-track" cx="64" cy="64" r="${r}" fill="none" stroke-width="10"></circle>
          <circle id="gaugeValue" class="gauge-value" cx="64" cy="64" r="${r}" fill="none" stroke-width="10"
            stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"
            stroke="${scored ? scoreColor(score) : "var(--line)"}"></circle>
        </svg>
        <div class="gauge-center" aria-hidden="true">
          <span class="gauge-number" id="gaugeNumber">${scored ? 0 : "—"}</span>
          ${scored ? `<span class="gauge-out-of">/ 100</span>` : ""}
        </div>
      </div>

      <div class="hero-id">
        <p class="hero-tone">${escapeHtml(label)}</p>
        <h1 class="hero-name">${escapeHtml(productTitle(data))}</h1>
      </div>

      <div class="hero-say">
        <p class="hero-verdict"><span class="tone-dot" aria-hidden="true"></span><span>${escapeHtml(buildVerdict(data))}</span></p>
        ${renderScoreDeltaChip(data)}
        ${flagBtn}
      </div>

      <div class="quick-chips" id="quickChips">${renderQuickChipsInner(data)}</div>
    </section>
  `;
}

// ---- "vs your last scan" delta chip ----
// Reads (and consumes) the previous score that scan.js stashed right
// before saving this scan. Only ever shows once, right after a fresh
// scan — reopening an old entry from history never has this key set.
function renderScoreDeltaChip(data) {
  if (typeof data.score !== "number") {
    pendingCelebration = false;
    return "";
  }
  const prev = takePrevScoreForCompare();
  if (prev === null || Number.isNaN(prev)) {
    pendingCelebration = false;
    return "";
  }

  const diff = Math.round(data.score - prev);
  let tone = "flat";
  let icon = "●";
  let text = "Same as your last scan";
  if (diff > 0) {
    tone = "good";
    icon = "▲";
    text = `+${diff} vs your last scan`;
  } else if (diff < 0) {
    tone = "bad";
    icon = "▼";
    text = `${diff} vs your last scan`;
  }

  // A meaningful jump is worth a small celebration once the gauge settles.
  pendingCelebration = diff >= 5;

  return `<span class="score-delta tone-${tone}" id="scoreDeltaChip"><span aria-hidden="true">${icon}</span> ${text}</span>`;
}

function wireHero() {
  const btn = byId("heroFlagBtn");
  if (btn) btn.addEventListener("click", () => activateTab("ingredients", { scroll: true }));
  const chips = byId("quickChips");
  if (chips && !chips.children.length) chips.remove();
}

// ---- quick chips (calories / sugar / sodium) ----

function renderQuickChipsInner(data) {
  const items = data.nutrition || [];
  const find = (key) => items.find((n) => n.key === key);
  const factor = basisFactor();

  const picks = [
    { key: "energy", label: "Calories" },
    { key: "total_sugars", fallback: "added_sugars" },
    { key: "sodium" }
  ];

  const CHIP_LABEL = { energy: "Calories", total_sugars: "Sugar", added_sugars: "Added sugar", sodium: "Sodium" };

  return picks
    .map((p) => find(p.key) || (p.fallback ? find(p.fallback) : null))
    .filter(Boolean)
    .map((item) => {
      const a = headlineAssessment(item, items);
      const tone = a.rated && a.kind === "limit" ? `tone-${a.tone}` : "";
      const shown = typeof item.value === "number" ? item.value * factor : null;
      return `
      <div class="quick-chip ${tone}">
        <div class="qc-label">${escapeHtml(CHIP_LABEL[item.key] || item.nutrient)}</div>
        <div><span class="qc-value">${shown === null ? "—" : formatAmount(shown)}</span><span class="qc-unit">${escapeHtml(item.unit || "")}</span></div>
        <div class="qc-basis">${escapeHtml(basisLabel())}</div>
      </div>`;
    })
    .join("");
}

function paintHeroChips() {
  const chips = byId("quickChips");
  if (chips && currentData) chips.innerHTML = renderQuickChipsInner(currentData);
}

// ---- why this score ----

function renderScoreWhy(data) {
  const reasons = data.score_reasons || [];
  if (!data.score_note && !reasons.length) return "";

  return `
    <div class="result-block">
      <div class="section-title"><h2>${typeof data.score === "number" ? "Why this score" : "Why there's no score"}</h2></div>
      ${data.score_note ? `<p class="score-note">${escapeHtml(data.score_note)}</p>` : ""}
      ${reasons.length ? `<ul class="score-reasons">${reasons.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    </div>
  `;
}

// ---- gauge entrance ----

function animateGauge(data) {
  const wrap = document.querySelector(".hero-card .gauge-wrap");
  const circle = byId("gaugeValue");
  const number = byId("gaugeNumber");
  if (!wrap || !circle || !number) return;

  if (typeof data.score !== "number") {
    wrap.classList.add("unscored");
    return;
  }

  const clamped = Math.max(0, Math.min(100, data.score));
  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - clamped / 100);

  if (REDUCED_MOTION) {
    circle.style.transition = "none";
    circle.style.strokeDashoffset = offset;
    number.textContent = clamped;
    return;
  }

  wrap.classList.add("enter");
  circle.getBoundingClientRect(); // flush styles so the sweep has a real start point
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      circle.style.strokeDashoffset = offset;
    })
  );

  number.dataset.count = 0;
  countUp(number, clamped, 1350);
  setTimeout(() => {
    wrap.classList.add("done");
    if (scoreBand(clamped) === "good") spawnGaugeSparkles(wrap);
  }, 1400);
}

// A small one-off burst of sparks around the dial — the single celebratory
// flourish on this page, reserved for a genuinely good score.
function spawnGaugeSparkles(wrap) {
  if (REDUCED_MOTION) return;
  const colors = ["var(--sage-hi)", "var(--sage)", "var(--wheat)"];
  for (let i = 0; i < 7; i++) {
    const spark = document.createElement("span");
    spark.className = "gauge-sparkle";
    spark.setAttribute("aria-hidden", "true");
    spark.style.setProperty("--angle", `${(i / 7) * 360 + Math.random() * 18}deg`);
    spark.style.setProperty("--dist", `${48 + Math.random() * 20}px`);
    spark.style.setProperty("--delay", `${i * 40}ms`);
    spark.style.background = colors[i % colors.length];
    wrap.appendChild(spark);
    spark.addEventListener("animationend", () => spark.remove());
  }
}

// ---- flags ----

function renderFlags(data) {
  const all = [
    ...(data.allergens || []).map((x) => ({ text: x, type: "allergen", icon: "⚠️" })),
    ...(data.additives || []).map((x) => ({ text: x, type: "additive", icon: "🧪" })),
    ...(data.sweeteners || []).map((x) => ({ text: x, type: "sweetener", icon: "🍬" }))
  ];

  const body = !all.length
    ? `<p class="flags-empty">No allergens, additives or added sweeteners turned up on this label.</p>`
    : `<div class="flags">${all
        .map(
          (f, i) => `
          <span class="flag ${f.type}" style="animation-delay:${i * 0.05}s">
            <span aria-hidden="true">${f.icon}</span>${escapeHtml(shorten(f.text, 42))}
          </span>`
        )
        .join("")}</div>`;

  return `
    <div class="result-block">
      <div class="section-title">
        <h2>Worth knowing</h2>
        <span class="badge">${all.length}</span>
      </div>
      ${body}
    </div>
  `;
}

// ============================================================
// NUTRITION TAB
// ============================================================

function renderNutrition(data) {
  const items = data.nutrition || [];

  if (!items.length) {
    return `
    <div class="result-block">
      <div class="section-title"><h2>Nutrition table</h2></div>
      <div class="nutrition-empty">No nutrition table showed up. A straighter, closer photo of the panel usually fixes it.</div>
    </div>`;
  }

  return `
    <div class="result-block" id="nutritionBlock">
      <div class="nutrition-head">
        <h2>Nutrition table</h2>
        <div class="basis-toggle" role="group" aria-label="Show amounts">
          <button type="button" class="basis-opt" data-basis="100g" id="basisBtn100"></button>
          <button type="button" class="basis-opt" data-basis="serve" id="basisBtnServe">Per serve</button>
        </div>
      </div>
      <div id="serveRow"></div>
      <div id="nutritionGridWrap" aria-live="polite"></div>
      <p class="nutrition-note" id="nutritionNote"></p>
    </div>
  `;
}

function wireNutrition() {
  document.querySelectorAll(".basis-opt").forEach((btn) => {
    btn.addEventListener("click", () => setBasis(btn.dataset.basis));
  });
}

function setBasis(mode) {
  basis.mode = mode;
  try {
    localStorage.setItem(BASIS_KEY, mode);
  } catch (e) {
    /* storage blocked */
  }
  paintNutrition({ animate: false });
}

// Repaints everything that depends on the chosen basis.
function paintNutrition({ animate }) {
  const block = byId("nutritionBlock");
  if (block) {
    byId("basisBtn100").textContent = `Per 100 ${basisUnit()}`;
    document.querySelectorAll(".basis-opt").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.basis === basis.mode ? "true" : "false");
    });
    paintServeRow();
    paintGrid({ animate });
    byId("nutritionNote").textContent =
      basis.mode === "serve"
        ? "Low / Medium / High is always judged per 100 g so products compare fairly. The % of daily reference follows the amount shown."
        : "Daily references follow FSSAI's %RDA values for an average adult on 2,000 kcal (protein and fibre: ICMR-NIN).";
  }
  paintHeroChips();
}

function paintServeRow() {
  const row = byId("serveRow");
  if (!row) return;

  if (basis.mode !== "serve") {
    row.innerHTML = "";
    return;
  }

  const known = !!basis.serve;
  row.innerHTML = `
    <div class="serve-row">
      <label for="serveInput">${known ? "Serving size" : "This photo doesn't show a serving size. Enter one:"}</label>
      <span>
        <input class="serve-input" id="serveInput" type="number" inputmode="decimal" min="1" max="1000" step="any"
               value="${known ? basis.serve.amount : ""}" placeholder="30">
        <span aria-hidden="true">${basisUnit()}</span>
      </span>
      <span class="serve-src" id="serveSrc">${known ? (basis.serve.source === "label" ? "Read from the label" : "Your value") : ""}</span>
    </div>`;

  byId("serveInput").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (v >= 1 && v <= 1000) {
      basis.serve = { amount: v, unit: (basis.serve && basis.serve.unit) || "g", source: "manual" };
    } else {
      basis.serve = null;
    }
    const src = byId("serveSrc");
    if (src) src.textContent = basis.serve ? "Your value" : "";
    paintGrid({ animate: false });
    paintHeroChips();
  });
}

function paintGrid({ animate }) {
  const wrap = byId("nutritionGridWrap");
  if (!wrap || !currentData) return;
  const items = currentData.nutrition || [];

  if (basis.mode === "serve" && !basis.serve) {
    wrap.innerHTML = `<div class="nutrition-empty">Enter a serving size above to see per-serve amounts.</div>`;
    return;
  }

  const factor = basisFactor();
  wrap.innerHTML = `<div class="nutrition-grid ${animate ? "" : "still"}">${items
    .map((item, i) => renderNutrientCard(item, i, factor, items))
    .join("")}</div>`;
}

// A short, honest note for nutrients that don't get a daily-limit
// percentage — keeps the card from reading as broken/empty (see
// assessNutrient: some nutrients are deliberately left unrated rather
// than given a made-up reference).
function neutralNote(item) {
  const notes = {
    carbohydrates: "Includes starches and sugars — see Total sugars for the sweetener share.",
    total_sugars: "Counted separately as Added sugars above, where the daily limit applies."
  };
  return notes[item.key] || "No daily reference tracked for this one.";
}

function renderNutrientCard(item, i, factor, all) {
  const a = assessNutrient(item, all);
  const hasValue = typeof item.value === "number";
  const shown = hasValue ? item.value * factor : null;
  const tone = a.rated && a.tone ? `tone-${a.tone}` : "";

  let pill = "";
  let ring = "";
  let bar = "";
  let caption = "";

  if (a.rated && hasValue) {
    const pctShown = ((a.base * factor) / a.ref) * 100;
    pill = `<span class="level-pill">${LEVEL_WORD[a.level]}</span>`;
    ring = ringSvg(pctShown);
    caption = `<p class="rda-caption">${rdaCaption(item, a, pctShown)}</p>`;

    const fill = Math.min(100, (a.pct100 / 20) * 100);
    const cls = a.kind === "want" ? "want" : a.level;
    bar = `<div class="level-bar" aria-hidden="true"><span class="${cls}" style="width:${fill}%;animation-delay:${i * 0.05}s"></span></div>`;
  } else if (hasValue) {
    // Not rated against a daily limit — fill the card the same way its
    // scored siblings are filled, just without pretending to a number.
    pill = `<span class="level-pill">Not limited</span>`;
    ring = `
      <div class="rda-ring neutral" aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <circle class="rr-track" cx="20" cy="20" r="${RING_R}" fill="none" stroke-width="4.5"></circle>
        </svg>
        <span class="rda-pct">–</span>
      </div>`;
    bar = `<div class="level-bar" aria-hidden="true"></div>`;
    caption = `<p class="rda-caption muted">${neutralNote(item)}</p>`;
  }

  return `
    <div class="nutrition-card ${tone}" style="animation-delay:${i * 0.04}s">
      <div class="nc-top">
        <span class="name">${escapeHtml(item.nutrient)}</span>
        ${pill}
      </div>
      <div class="nc-mid">
        <div class="value-row">
          <span class="value">${shown === null ? "—" : formatAmount(shown)}</span>
          <span class="unit">${escapeHtml(item.unit || "")}</span>
        </div>
        ${ring}
      </div>
      ${bar}
      ${caption}
    </div>`;
}

function renderSummary(data) {
  const summary = data.nutrition_summary || [];
  if (!summary.length) return "";

  return `
    <div class="result-block">
      <div class="section-title"><h2>What the numbers mean</h2></div>
      <div class="summary-list">
        ${summary
          .map(
            (s, i) => `
          <div class="summary-row" style="animation-delay:${i * 0.05}s">
            <span class="summary-tag ${String(s.level).toLowerCase()}">${escapeHtml(s.level)}</span>
            <span class="summary-text"><strong>${escapeHtml(s.nutrient)}</strong> — ${escapeHtml(s.message)}</span>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;
}

// ============================================================
// SHARE — draw a result card and offer it as an image
// ============================================================

let shareUrl = null;

function wireShare() {
  const btn = byId("shareBtn");
  const label = byId("shareBtnLabel");
  const dialog = byId("shareDialog");

  btn.addEventListener("click", async () => {
    if (!currentData) return;
    btn.disabled = true;
    label.textContent = "Making image…";
    try {
      const blob = await renderShareCard(currentData);
      openShareDialog(blob);
    } catch (err) {
      console.error("Share card failed:", err);
      label.textContent = "Couldn't make it";
      await new Promise((r) => setTimeout(r, 1600));
    } finally {
      btn.disabled = false;
      label.textContent = "Share";
    }
  });

  byId("shareClose").addEventListener("click", () => dialog.close());
  // a click on the dimmed backdrop (outside the card) also closes it
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = null;
  });
}

function openShareDialog(blob) {
  const dialog = byId("shareDialog");
  if (shareUrl) URL.revokeObjectURL(shareUrl);
  shareUrl = URL.createObjectURL(blob);

  const slug = productTitle(currentData).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "result";
  const filename = `foodlens-${slug}.png`;

  byId("sharePreview").src = shareUrl;
  const dl = byId("shareDownload");
  dl.href = shareUrl;
  dl.download = filename;

  const file = new File([blob], filename, { type: "image/png" });
  const native = byId("shareNative");
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  native.hidden = !canShare;
  native.onclick = () => {
    const score = typeof currentData.score === "number" ? ` scored ${currentData.score}/100` : "";
    navigator
      .share({ files: [file], title: "FoodLens result", text: `${productTitle(currentData)}${score} on FoodLens` })
      .catch(() => {}); // cancelling the share sheet isn't an error
  };

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

// Fixed dark palette: the card always looks like FoodLens, whichever
// theme the person happens to be viewing in.
const SHARE_TONES = { good: "#5fd98a", warn: "#e8b66d", bad: "#e58f82", none: "#a6b6a9" };
const SHARE_ACCENT = "#5fd98a";

async function loadShareFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const load = Promise.all([
    document.fonts.load('600 80px "Fraunces"'),
    document.fonts.load('700 150px "IBM Plex Mono"'),
    document.fonts.load('500 38px "Inter"')
  ]).catch(() => {});
  // if the web fonts can't be fetched, fall back to system fonts rather than hang
  await Promise.race([load, new Promise((r) => setTimeout(r, 1500))]);
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The share card links back to the app itself (there's no public per-result
// URL yet, since results live in the signed-in user's local data). Swap this
// for a real shareable link if/when one exists server-side.
function shareQrTarget() {
  return `${window.location.origin}${window.location.pathname.replace(/results\.html$/, "scan.html")}`;
}

// Draws a QR code onto the share-card canvas using the qrcode-generator
// library (loaded globally as `qrcode` via the <script> tag in results.html).
function drawQRCode(ctx, text, x, y, size) {
  if (typeof qrcode !== "function") return; // library failed to load — skip gracefully
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const pad = 10;
  const cell = (size - pad * 2) / count;

  ctx.fillStyle = "#f4f1e8";
  roundRectPath(ctx, x, y, size, size, 14);
  ctx.fill();

  ctx.fillStyle = "#16231b";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(
          Math.round(x + pad + c * cell),
          Math.round(y + pad + r * cell),
          Math.ceil(cell),
          Math.ceil(cell)
        );
      }
    }
  }
}

async function renderShareCard(data) {
  await loadShareFonts();

  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const scored = typeof data.score === "number";
  const band = scored ? scoreBand(data.score) : null;
  const tone = !scored ? SHARE_TONES.none : band === "good" ? SHARE_TONES.good : band === "okay" ? SHARE_TONES.warn : SHARE_TONES.bad;

  const DISPLAY = '"Fraunces", Georgia, serif';
  const BODY = '"Inter", system-ui, sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, monospace';

  // ---- measure first, so the whole block can be centred vertically ----
  // The share card doesn't claim to know the product name — it just shows
  // what was scanned — so the headline is a fixed caption rather than the
  // guessed title used elsewhere on the page.
  const SHARE_CAPTION = "Scanned image";
  const nameFont = `600 80px ${DISPLAY}`;
  ctx.font = nameFont;
  const nameLines = wrapLines(ctx, SHARE_CAPTION, 936, 3);
  const nameH = nameLines.length * 90;

  const verdictText = buildVerdict(data);
  ctx.font = `500 40px ${BODY}`;
  const verdictLines = wrapLines(ctx, verdictText, 860, 2);

  const items = data.nutrition || [];
  const tiles = [
    { label: "Calories", item: items.find((n) => n.key === "energy") },
    { label: "Sugar", item: items.find((n) => n.key === "total_sugars") || items.find((n) => n.key === "added_sugars") },
    { label: "Sodium", item: items.find((n) => n.key === "sodium") }
  ].filter((t) => t.item && typeof t.item.value === "number");

  const RING_R_PX = 176;
  const ringBlock = RING_R_PX * 2 + 30;
  const labelH = 108;
  const verdictH = verdictLines.length * 54;
  const tilesH = tiles.length ? 170 : 0;

  const contentH = nameH + 40 + ringBlock + labelH + verdictH + (tiles.length ? 44 + tilesH : 0);
  const top = 190;
  const bottomLimit = 1196; // raised from 1226 to leave room for the QR code footer
  const dy = Math.max(0, (bottomLimit - top - contentH) / 2);
  let y = top + dy;

  // ---- background ----
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1c2b23");
  bg.addColorStop(1, "#111b16");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.82, 260, 0, W * 0.82, 260, 620);
  glow.addColorStop(0, `${tone}33`);
  glow.addColorStop(1, `${tone}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ---- brand ----
  const mx = 72;
  const my = 64;
  ctx.strokeStyle = "#435a4c";
  ctx.lineWidth = 2;
  ctx.fillStyle = "#22332a";
  roundRectPath(ctx, mx, my, 68, 68, 20);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = SHARE_ACCENT;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  const c = 15;
  [[mx + 14, my + 14, 1, 1], [mx + 54, my + 14, -1, 1], [mx + 14, my + 54, 1, -1], [mx + 54, my + 54, -1, -1]].forEach(([x, yy, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * c, yy);
    ctx.lineTo(x, yy);
    ctx.lineTo(x, yy + sy * c);
    ctx.stroke();
  });
  ctx.fillStyle = SHARE_ACCENT;
  ctx.beginPath();
  ctx.arc(mx + 34, my + 34, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f4f1e8";
  ctx.font = `600 46px ${DISPLAY}`;
  ctx.fillText("FoodLens", mx + 92, my + 48);

  // ---- product name ----
  ctx.font = nameFont;
  ctx.fillStyle = "#f4f1e8";
  nameLines.forEach((line, i) => ctx.fillText(line, 72, y + 68 + i * 90));
  y += nameH + 40;

  // ---- score ring ----
  const cx = W / 2;
  const cy = y + ringBlock / 2;
  ctx.lineWidth = 30;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#33483c";
  ctx.beginPath();
  ctx.arc(cx, cy, RING_R_PX, 0, Math.PI * 2);
  ctx.stroke();

  if (scored && data.score > 0) {
    ctx.strokeStyle = tone;
    ctx.beginPath();
    ctx.arc(cx, cy, RING_R_PX, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(100, data.score)) / 100);
    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.fillStyle = scored ? "#f4f1e8" : SHARE_TONES.none;
  ctx.font = `700 150px ${MONO}`;
  ctx.fillText(scored ? String(data.score) : "—", cx, cy + 40);
  if (scored) {
    ctx.fillStyle = "#a6b6a9";
    ctx.font = `500 34px ${BODY}`;
    ctx.fillText("out of 100", cx, cy + 96);
  }
  y += ringBlock;

  // ---- label + verdict ----
  ctx.fillStyle = tone;
  ctx.font = `600 52px ${DISPLAY}`;
  ctx.fillText(data.score_label || "Not scored", cx, y + 78);
  y += labelH;

  ctx.fillStyle = "#c2cbbf";
  ctx.font = `500 40px ${BODY}`;
  verdictLines.forEach((line, i) => ctx.fillText(line, cx, y + 30 + i * 54));
  y += verdictH;

  // ---- headline numbers (always per 100 g, so shared cards compare fairly) ----
  if (tiles.length) {
    y += 44;
    const gap = 24;
    const tw = (936 - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((t, i) => {
      const x = 72 + i * (tw + gap);
      const a = headlineAssessment(t.item, items);
      const tileTone = a.rated && a.kind === "limit" ? (a.tone === "bad" ? SHARE_TONES.bad : a.tone === "warn" ? SHARE_TONES.warn : SHARE_TONES.good) : "#435a4c";

      ctx.fillStyle = "#22332a";
      roundRectPath(ctx, x, y, tw, tilesH, 26);
      ctx.fill();
      ctx.strokeStyle = "#2f4438";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = tileTone;
      ctx.beginPath();
      ctx.arc(x + tw - 34, y + 36, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.fillStyle = "#c2cbbf";
      ctx.font = `500 28px ${BODY}`;
      ctx.fillText(t.label, x + 28, y + 46);

      ctx.fillStyle = "#f4f1e8";
      ctx.font = `700 52px ${MONO}`;
      const valueText = formatAmount(t.item.value);
      ctx.fillText(valueText, x + 28, y + 110);
      const vw = ctx.measureText(valueText).width;
      ctx.fillStyle = "#a6b6a9";
      ctx.font = `500 26px ${BODY}`;
      ctx.fillText(t.item.unit || "", x + 28 + vw + 8, y + 110);

      ctx.font = `500 22px ${BODY}`;
      ctx.fillText("per 100 g", x + 28, y + 148);
    });
  }

  // ---- footer ----
  const footerLineY = 1216;
  ctx.strokeStyle = "#2f4438";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, footerLineY);
  ctx.lineTo(W - 72, footerLineY);
  ctx.stroke();

  const QR_SIZE = 96;
  const qrX = W - 72 - QR_SIZE;
  const qrY = footerLineY + 26;
  drawQRCode(ctx, shareQrTarget(), qrX, qrY, QR_SIZE);

  ctx.textAlign = "left";
  ctx.fillStyle = "#a6b6a9";
  ctx.font = `500 30px ${BODY}`;
  ctx.fillText("Scanned with FoodLens", 72, qrY + 34);
  ctx.fillText(new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), 72, qrY + 70);
  ctx.font = `500 22px ${BODY}`;
  ctx.fillText("Scan to open FoodLens", 72, qrY + QR_SIZE + 4);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))), "image/png");
  });
}

// ============================================================
// INGREDIENTS — verdict first, detail on demand
// ============================================================

function renderIngredients(data) {
  const ingredients = data.ingredients || [];

  if (!ingredients.length) {
    return `
      <div class="result-block">
        <div class="section-title"><h2>Ingredients</h2></div>
        <div class="nutrition-empty">No ingredients list showed up. Try a clearer, closer photo of the label.</div>
      </div>`;
  }

  const lookCount = ingredients.filter((i) => verdictOf(i) === "look").length;

  const cards = ingredients
    .map((ing, i) => {
      const verdict = verdictOf(ing);
      const emoji = ing.emoji || emojiFor(ing);
      const line = ing.one_liner || fallbackOneLiner(ing);
      const pct = ing.percent ? `<span class="source-tag">${escapeHtml(ing.percent)}</span>` : "";

      return `
      <div class="ingredient ${verdict === "look" ? "flagged" : ""}" data-index="${i}"
           style="animation-delay:${Math.min(i * 0.04, 0.4)}s"
           data-search="${escapeHtml(
             [
               ing.simple_name,
               ing.category,
               ing.original,
               (ing.technical || {}).chemical,
               (ing.technical || {}).ins,
               (ing.technical || {}).family
             ]
               .filter(Boolean)
               .join(" ")
               .toLowerCase()
           )}">
        <div class="ingredient-header" role="button" tabindex="0" aria-expanded="false">
          <div class="ingredient-left">
            <span class="ing-emoji" aria-hidden="true">${emoji}</span>
            <div style="min-width:0">
              <div class="ingredient-name">${escapeHtml(ing.simple_name || "Ingredient")}${pct}</div>
              <div class="ingredient-sub">${escapeHtml(line)}</div>
            </div>
          </div>
          <div class="ingredient-right">
            <span class="verdict ${verdict}"><span class="dot"></span>${verdict === "look" ? "Worth a look" : "Fine"}</span>
            <svg class="ing-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
        <div class="ingredient-details">
          <div class="ing-details-inner">
            <div class="ing-details-pad">
              ${ing.watch || ing.verdict_note
                ? `<div class="detail-flagnote"><span aria-hidden="true">👀</span><span>${escapeHtml(ing.watch || ing.verdict_note)}</span></div>`
                : ""}
              <div class="detail-row">
                <strong>What it is</strong>
                ${escapeHtml(ing.what || ing.explanation || "No description available for this one.")}
              </div>
              ${ing.why || ing.why_used
                ? `<div class="detail-row"><strong>Why it's in here</strong>${escapeHtml(ing.why || ing.why_used)}</div>`
                : ""}
              ${renderTechnical(ing)}
              ${ing.original ? `<div class="detail-raw">Printed on the label as: ${escapeHtml(ing.original)}</div>` : ""}
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  return `
    <div class="result-block">
      <div class="section-title">
        <h2>Ingredients</h2>
        <span class="badge">${ingredients.length} found · heaviest first</span>
      </div>

      <div class="ingredient-filter">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input type="text" id="ingredientFilterInput" placeholder="Filter ingredients, e.g. sugar, palm oil...">
      </div>

      <div class="ing-legend">
        <span><i class="l-look"></i>${lookCount} worth a look — open the card to read why</span>
        <span><i class="l-ok"></i>${ingredients.length - lookCount} nothing to flag</span>
      </div>

      <div class="ingredient-list">${cards}</div>
    </div>
  `;
}

// ---- technical layer (the chemistry, under the plain explanation) ----

function renderTechnical(ing) {
  const t = ing.technical || {};
  const rows = [
    ["Chemical identity", t.chemical],
    ["Code", t.ins],
    ["Functional class", t.family],
    ["Derived from", t.source]
  ].filter(([, value]) => value && String(value).trim());

  if (!rows.length && !t.detail && !t.notes) return "";

  const spec = rows.length
    ? `<div class="tech-grid">${rows
        .map(
          ([label, value]) => `
        <div class="tech-cell">
          <span class="tech-key">${escapeHtml(label)}</span>
          <span class="tech-val">${escapeHtml(value)}</span>
        </div>`
        )
        .join("")}</div>`
    : "";

  return `
    <details class="tech-block">
      <summary class="tech-summary">
        <span class="tech-summary-label"><span aria-hidden="true">🔬</span> Technical detail</span>
        <span class="tech-summary-hint">${escapeHtml(t.family || t.ins || "chemistry")}</span>
      </summary>
      <div class="tech-body">
        ${spec}
        ${t.detail ? `<p class="tech-detail">${escapeHtml(t.detail)}</p>` : ""}
        ${t.notes ? `<p class="tech-note"><span aria-hidden="true">§</span> ${escapeHtml(t.notes)}</p>` : ""}
      </div>
    </details>
  `;
}

// ============================================================
// VITAMINS + MINERALS
// ============================================================

function renderVitamins(data) {
  const vitamins = data.vitamins || [];
  const unnamed = data.vitamins_unnamed;

  if (!vitamins.length) {
    if (!unnamed) return "";
    return `
      <div class="result-block">
        <div class="section-title"><h2>Vitamins &amp; minerals</h2></div>
        <div class="nutrition-empty">
          This label declares that vitamins have been added, but doesn't name which ones.
          That's permitted, though it means the pack alone can't tell you what the
          fortification actually is. Some packs print the detail in the nutrition panel
          instead — if yours does, a photo of that panel will pull it through.
        </div>
      </div>`;
  }

  const groups = [...new Set(vitamins.map((v) => v.group))];

  const cards = vitamins
    .map((v, i) => {
      const teaser = shorten(v.role || "", 88);
      const accent = /mineral/i.test(v.group || "") ? "wheat" : "violet";

      return `
      <div class="vitamin-card accent-${accent}" data-index="${i}" style="animation-delay:${Math.min(i * 0.05, 0.4)}s">
        <div class="vitamin-head" role="button" tabindex="0" aria-expanded="false">
          <span class="vitamin-emoji" aria-hidden="true">${v.emoji || "💊"}</span>
          <div style="min-width:0">
            <div class="vitamin-name">${escapeHtml(v.name)}<span class="vitamin-group-tag">${escapeHtml(v.group || "")}</span></div>
            ${teaser ? `<div class="vitamin-teaser">${escapeHtml(teaser)}</div>` : ""}
          </div>
          <div class="vitamin-right">
            ${v.amount ? `<span class="vitamin-amount">${escapeHtml(v.amount)}</span>` : ""}
            <svg class="ing-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>

        <div class="vitamin-details">
          <div class="ing-details-inner">
            <div class="ing-details-pad vitamin-pad">
              <div class="detail-row"><strong>What it does</strong>${escapeHtml(v.role)}</div>
              <div class="detail-row"><strong>Fortified as</strong>${escapeHtml(v.chemical)}</div>
              ${renderVitaminTechnical(v)}
              ${v.reference ? `<div class="vitamin-ref">${escapeHtml(v.reference)}</div>` : ""}
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  return `
    <div class="result-block">
      <div class="section-title">
        <h2>Vitamins &amp; minerals</h2>
        <span class="badge">${vitamins.length} found · ${escapeHtml(groups.length === 1 ? groups[0] : groups.length + " groups")}</span>
      </div>

      <p class="section-note vitamin-intro">
        These are the nutrients this label names, in the chemical forms manufacturers
        normally fortify with. Reference intakes below are rounded adult figures — they're
        here so a "% RDA" on the pack means something, not as a target to hit.
      </p>

      ${unnamed
        ? `<div class="detail-flagnote vitamin-caveat">
             <span aria-hidden="true">👀</span>
             <span>The pack also declares "vitamins" as a blanket ingredient without naming which ones, so the list below may be incomplete. Any detail printed in the nutrition panel will fill the gap — include that panel in the photo if you can.</span>
           </div>`
        : ""}

      <div class="vitamin-list">${cards}</div>
    </div>
  `;
}

// A vitamin's "Technical detail" gets the same fold-away treatment as an
// ingredient's chemistry block — most people never need to open it.
function renderVitaminTechnical(v) {
  if (!v.detail) return "";
  return `
    <details class="tech-block">
      <summary class="tech-summary">
        <span class="tech-summary-label"><span aria-hidden="true">🔬</span> Technical detail</span>
      </summary>
      <div class="tech-body">
        <p class="tech-detail">${escapeHtml(v.detail)}</p>
      </div>
    </details>
  `;
}

function wireVitaminToggles() {
  document.querySelectorAll(".vitamin-head").forEach((header) => {
    const toggle = () => {
      const card = header.closest(".vitamin-card");
      const open = card.classList.toggle("open");
      header.setAttribute("aria-expanded", open ? "true" : "false");
    };
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function verdictOf(ing) {
  if (ing.verdict === "look" || ing.verdict === "ok") return ing.verdict;
  // fallback for older API responses
  const cat = (ing.category || "").toLowerCase();
  const risky = ["allergen", "sweetener", "preservative", "artificial color", "flavor enhancer", "food additive", "antioxidant"];
  return risky.some((r) => cat.includes(r)) ? "look" : "ok";
}

function fallbackOneLiner(ing) {
  const cat = (ing.category || "ingredient").toLowerCase();
  if (cat.includes("allergen")) return "A common allergen.";
  if (cat.includes("sweetener")) return "Adds sweetness.";
  if (cat.includes("preservative")) return "Keeps it fresh for longer.";
  if (cat.includes("color") || cat.includes("colour")) return "Added for colour.";
  if (cat.includes("additive")) return "A processing additive.";
  if (ing.position === 1) return "The main ingredient, by weight.";
  return `Listed ${ordinal(ing.position || 1)} by weight.`;
}

function wireIngredientToggles() {
  document.querySelectorAll(".ingredient-header").forEach((header) => {
    const toggle = () => {
      const card = header.closest(".ingredient");
      const open = card.classList.toggle("open");
      header.setAttribute("aria-expanded", open ? "true" : "false");
    };
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function wireIngredientFilter() {
  const input = document.getElementById("ingredientFilterInput");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll(".ingredient").forEach((card) => {
      const match = !q || (card.dataset.search || "").includes(q);
      card.classList.toggle("match-hide", !match);
    });
  });
}