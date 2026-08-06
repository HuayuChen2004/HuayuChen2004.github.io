(() => {
  const $ = (sel) => document.querySelector(sel);

  const thumb = (id) => `./thumbs/${id.replace(/\.png$/i, ".jpg")}`;

  function fmtPct(x) {
    return `${(Number(x) * 100).toFixed(1)}%`;
  }

  function renderOverall(data) {
    const o = data.overall;
    $("#overall-stats").innerHTML = `
      <div class="stat caption">
        <label>Caption pool recall（24 题均值）</label>
        <strong>${fmtPct(o.caption_pool_recall)}</strong>
      </div>
      <div class="stat token">
        <label>Visual Token pool recall</label>
        <strong>${fmtPct(o.visual_token_pool_recall)}</strong>
      </div>
      <div class="stat">
        <label>相对提升</label>
        <strong>+${((o.visual_token_pool_recall - o.caption_pool_recall) * 100).toFixed(1)} pt</strong>
      </div>
    `;
  }

  function renderPicker(questions, activeId, onSelect) {
    const root = $("#q-list");
    root.innerHTML = "";
    questions.forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `q-btn${q.id === activeId ? " active" : ""}`;
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", q.id === activeId ? "true" : "false");
      btn.innerHTML = `
        <div class="row"><span>${q.id}</span><span>${q.risk || ""} · |E*|=${q.n_gt}</span></div>
        <div class="title">${q.question}</div>
        <div class="scores">
          <span class="c">Cap ${fmtPct(q.metrics_summary.caption_pool_recall)}</span>
          <span class="t">Tok ${fmtPct(q.metrics_summary.visual_token_pool_recall)}</span>
        </div>
      `;
      btn.addEventListener("click", () => onSelect(q.id));
      root.appendChild(btn);
    });
  }

  function tileHTML(item, kind) {
    const label = kind === "miss" ? "漏检" : item.label === "hit" ? "命中" : "噪声";
    const cls = kind === "miss" ? "miss" : item.label;
    return `
      <div class="tile ${cls}" title="${item.id} · rank ${item.rank}">
        <img src="${thumb(item.id)}" alt="${item.id}" loading="lazy" />
        <span class="rank">#${item.rank}</span>
        <span class="tag">${label}</span>
      </div>
    `;
  }

  function renderPanel(el, methodMeta, pack, side) {
    const isCaption = side === "caption";
    const missNote =
      isCaption && pack.n_miss > 0
        ? `<div class="fail-note">漏掉 <b>${pack.n_miss}</b> / ${pack.n_gt} 张相关图。下面展示部分漏检样例——这些图本应进入候选池，却被 Caption 排到了 K=${pack.K} 之外。</div>`
        : !isCaption && pack.n_miss === 0
          ? `<div class="empty-miss">这道题 Visual Token 把全部相关图都收进了候选池（漏检 = 0）。</div>`
          : !isCaption && pack.n_miss > 0
            ? `<div class="fail-note" style="color:var(--muted);border-color:var(--line);background:#f8fafc">仍漏检 ${pack.n_miss} 张，但显著少于 Caption。</div>`
            : isCaption && pack.n_miss === 0
              ? `<div class="empty-miss" style="color:var(--muted);border-color:var(--line)">这道题 Caption 也没有漏检。</div>`
              : "";

    el.innerHTML = `
      <div class="panel-head">
        <div>
          <h3>${methodMeta.name}</h3>
          <p>${methodMeta.desc}</p>
        </div>
        <div class="badge">recall ${fmtPct(pack.pool_recall)}</div>
      </div>
      <div class="kpi-row">
        <div class="kpi"><span>命中</span><b>${pack.n_hit}/${pack.n_gt}</b></div>
        <div class="kpi"><span>漏检</span><b>${pack.n_miss}</b></div>
        <div class="kpi"><span>池内噪声</span><b>${pack.n_fp}</b></div>
      </div>
      <p class="section-label">Top-${pack.top.length} 检索结果</p>
      <div class="grid">${pack.top.map((t) => tileHTML(t)).join("")}</div>
      <p class="section-label" style="margin-top:0.95rem">漏检的相关图</p>
      ${missNote}
      <div class="grid">${
        pack.missed.length
          ? pack.missed.map((t) => tileHTML(t, "miss")).join("")
          : `<div class="empty-miss">无漏检样例可展示。</div>`
      }</div>
    `;
  }

  function renderQuestion(data, q) {
    $("#active-q").hidden = false;
    $("#qid").textContent = q.id;
    const risk = $("#risk");
    risk.textContent = `caption risk: ${q.risk}`;
    risk.className = `risk ${q.risk || ""}`;
    $("#q-text").textContent = q.question;
    $("#why").textContent = q.why_hard || "";
    $("#answer").textContent = q.answer;
    $("#n-gt").textContent = String(q.n_gt);
    $("#k-val").textContent = String(q.K);

    const capR = q.metrics_summary.caption_pool_recall;
    const tokR = q.metrics_summary.visual_token_pool_recall;
    $("#delta-bar").innerHTML = `
      <div class="meter caption">
        <div class="lab"><span>Caption</span><span>${fmtPct(capR)}</span></div>
        <div class="track"><div class="fill" style="width:${Math.max(2, capR * 100)}%"></div></div>
      </div>
      <div class="meter token">
        <div class="lab"><span>Visual Token</span><span>${fmtPct(tokR)}</span></div>
        <div class="track"><div class="fill" style="width:${Math.max(2, tokR * 100)}%"></div></div>
      </div>
    `;

    renderPanel($("#panel-caption"), data.methods.caption, q.caption, "caption");
    renderPanel($("#panel-token"), data.methods.visual_token, q.visual_token, "token");
  }

  async function main() {
    const res = await fetch("./data/demo.json");
    const data = await res.json();
    let activeId = data.questions[0]?.id;

    const select = (id) => {
      activeId = id;
      const q = data.questions.find((x) => x.id === id);
      renderPicker(data.questions, activeId, select);
      renderQuestion(data, q);
      history.replaceState(null, "", `#${id}`);
    };

    renderOverall(data);
    const fromHash = location.hash.replace(/^#/, "");
    if (data.questions.some((q) => q.id === fromHash)) activeId = fromHash;
    select(activeId);
  }

  main().catch((err) => {
    console.error(err);
    $("#overall-stats").innerHTML = `<div class="stat"><label>加载失败</label><strong style="font-size:1rem">${err.message}</strong></div>`;
  });
})();
