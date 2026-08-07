(() => {
  const $ = (sel) => document.querySelector(sel);
  const thumb = (id) => `./thumbs/${String(id).replace(/\.png$/i, ".jpg")}`;
  const fmtPct = (x) => `${(Number(x) * 100).toFixed(1)}%`;

  let retrieveData = null;
  let qaData = null;
  let overviewData = null;
  let journeyData = null;
  let mode = "overview"; // overview | journey | retrieve | answer
  let answerSub = "select"; // select | read
  let activeId = null;
  let journeyStep = 0;
  let journeyShouldScroll = false;

  function fmtAns(a) {
    if (a == null) return "—";
    if (typeof a === "boolean") return a ? "是" : "否";
    if (typeof a === "object") return JSON.stringify(a);
    return String(a);
  }

  function hideAllStages() {
    $("#overview-root").hidden = true;
    $("#overview-root").innerHTML = "";
    $("#journey-root").hidden = true;
    $("#journey-root").innerHTML = "";
    $("#picker-section").hidden = true;
    $("#active-q").hidden = true;
    $("#answer-subtabs").hidden = true;
  }

  function tileHTML(item, kind) {
    const label =
      kind === "miss" ? "漏检" : kind === "wrong" ? "错选" : kind === "skip" ? "未选" : item.label === "hit" ? "命中" : item.label === "noise" ? "噪声" : "相关";
    const cls = kind === "miss" || kind === "wrong" ? "miss" : kind === "skip" ? "noise" : item.label || "hit";
    const rank = item.rank != null ? `<span class="rank">#${item.rank}</span>` : "";
    return `
      <div class="tile ${cls}" title="${item.id}">
        <img src="${thumb(item.id)}" alt="${item.id}" loading="lazy" />
        ${rank}
        <span class="tag">${label}</span>
      </div>`;
  }

  function cueHTML(cues) {
    if (!cues || !cues.length) return "";
    return `<div class="cue-row">${cues
      .map((c) => `<span class="cue ${c.present ? "ok" : "bad"}">${c.cue}${c.present ? " ✓" : " ✗"}</span>`)
      .join("")}</div>`;
  }

  function tagHTML(tags) {
    if (!tags || !tags.length) return "";
    return `<div class="cue-row" style="margin-bottom:0.55rem">${tags
      .map((t) => `<span class="cue bad">${t}</span>`)
      .join("")}</div>`;
  }

  function analysisHTML(analysis, extraClass = "") {
    if (!analysis) return "";
    const issues = (analysis.caption_issues || [])
      .map(
        (it) => `<div class="issue"><q>「${it.quote}」</q><div>${it.problem}</div></div>`
      )
      .join("");
    const bullets = (analysis.bullets || []).map((b) => `<li>${b}</li>`).join("");
    return `
      <aside class="analysis-box ${extraClass}">
        <h3>原因分析：${analysis.title || "Caption 为何出错"}</h3>
        ${tagHTML(analysis.tags)}
        <p class="summary">${analysis.summary || ""}</p>
        ${bullets ? `<ul>${bullets}</ul>` : ""}
        ${issues ? `<div class="issue-list">${issues}</div>` : ""}
      </aside>`;
  }

  function renderRetrieveOverall() {
    const o = retrieveData.overall;
    $("#overall-stats").innerHTML = `
      <div class="stat caption"><label>Caption 池内召回率（24 题）</label><strong>${fmtPct(o.caption_pool_recall)}</strong></div>
      <div class="stat token"><label>视觉 token 池内召回率</label><strong>${fmtPct(o.visual_token_pool_recall)}</strong></div>
      <div class="stat"><label>相对提升</label><strong>+${((o.visual_token_pool_recall - o.caption_pool_recall) * 100).toFixed(1)} pt</strong></div>`;
    $("#picker-title").textContent = "选择问题";
    $("#picker-desc").textContent =
      "8 道代表性题目（Gallery QA 检索评测）。看相关图进没进候选池：绿框=命中，灰框=噪声，红框=漏检。";
    $("#answer-subtabs").hidden = true;
    $("#foot-note").textContent =
      "池内召回率 = 相关图里有多少进了前 K 名候选。本页 Visual Token 对应「全库相关性打分 + tok/2（半精度 token）」；24 题均值 Caption 31.1% → Visual Token 82.3%。名词解释见总览「读懂这些词」。";
  }

  function renderAnswerOverall() {
    const s = qaData.overall.locate_summary;
    if (answerSub === "select") {
      $("#overall-stats").innerHTML = `
        <div class="stat caption"><label>Caption 定图准确率</label><strong>${fmtPct(s.caption_locate_acc)}</strong></div>
        <div class="stat token"><label>Visual Token 定图准确率</label><strong>${fmtPct(s.visual_token_locate_acc)}</strong></div>
        <div class="stat caption"><label>Caption 答题（含碰巧对）</label><strong>${fmtPct(s.caption_answer_acc)}</strong></div>`;
      $("#picker-desc").textContent =
        "阶段 A：用 caption 从候选池里选图。就算后面还能碰巧答对，定错图也说明证据链断了。";
    } else {
      $("#overall-stats").innerHTML = `
        <div class="stat caption"><label>金标图 + Caption 答题</label><strong>${fmtPct(s.oracle_caption_acc)}</strong></div>
        <div class="stat token"><label>金标图 + Visual Token 答题</label><strong>${fmtPct(s.oracle_visual_acc)}</strong></div>
        <div class="stat"><label>设定</label><strong style="font-size:1.05rem">图已选对</strong></div>`;
      $("#picker-desc").textContent =
        "阶段 B：图已经是正确唯一图，只把该图的 caption 喂给模型。文本信息损失仍会导致答错。";
    }
    $("#picker-title").textContent = "选择答题问题";
    $("#answer-subtabs").hidden = false;
    $("#foot-note").textContent =
      "阶段 A：同一候选池里用 Caption 或视觉 token Rel 定唯一图再答题。阶段 B：直接给出正确图（金标/oracle），只换证据形态。名词解释见总览「读懂这些词」。";
  }

  function renderRetrievePicker(onSelect) {
    const root = $("#q-list");
    root.innerHTML = "";
    retrieveData.questions.forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `q-btn${q.id === activeId ? " active" : ""}`;
      btn.innerHTML = `
        <div class="row"><span>${q.id}</span><span>难度 ${q.risk || "—"} · 相关图 ${q.n_gt} 张</span></div>
        <div class="title">${q.question}</div>
        <div class="scores">
          <span class="c">Caption 召回 ${fmtPct(q.metrics_summary.caption_pool_recall)}</span>
          <span class="t">视觉 token ${fmtPct(q.metrics_summary.visual_token_pool_recall)}</span>
        </div>`;
      btn.addEventListener("click", () => onSelect(q.id));
      root.appendChild(btn);
    });
  }

  function renderAnswerPicker(onSelect) {
    const qs = answerSub === "select" ? qaData.select_questions : qaData.read_questions;
    const root = $("#q-list");
    root.innerHTML = "";
    qs.forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `q-btn${q.id === activeId ? " active" : ""}`;
      if (answerSub === "select") {
        btn.innerHTML = `
          <div class="row"><span>${q.answer_type}</span><span>${q.parent_qid}</span></div>
          <div class="title">${q.question}</div>
          <div class="scores">
            <span class="c">定图${q.caption.selected_matches_anchor ? "✓" : "✗"} · ${q.caption.correct ? "答对" : "答错"}</span>
            <span class="t">定图${q.visual_token.selected_matches_anchor ? "✓" : "✗"} · ${q.visual_token.correct ? "答对" : "答错"}</span>
          </div>`;
      } else {
        const fragile = q.caption.correct && (q.analysis?.tags || []).includes("脆的正确");
        btn.innerHTML = `
          <div class="row"><span>${q.answer_type}</span><span>${fragile ? "脆的正确" : q.caption.correct ? "caption 对" : "caption 错"}</span></div>
          <div class="title">${q.question}</div>
          <div class="scores">
            <span class="c">${q.caption.correct ? "答对" : "答错"}（只读 caption）</span>
            <span class="t">${q.visual_token.correct ? "答对" : "答错"}（visual token）</span>
          </div>`;
      }
      btn.addEventListener("click", () => onSelect(q.id));
      root.appendChild(btn);
    });
  }

  function renderRetrievePanel(el, methodMeta, pack, side) {
    const isCaption = side === "caption";
    const missNote =
      isCaption && pack.n_miss > 0
        ? `<div class="fail-note">漏掉 <b>${pack.n_miss}</b> / ${pack.n_gt} 张相关图。</div>`
        : !isCaption && pack.n_miss === 0
          ? `<div class="empty-miss">这道题 Visual Token 把全部相关图都收进了候选池。</div>`
          : !isCaption && pack.n_miss > 0
            ? `<div class="fail-note" style="color:var(--muted);border-color:var(--line);background:#f8fafc">仍漏检 ${pack.n_miss} 张，但显著少于 Caption。</div>`
            : "";
    el.innerHTML = `
      <div class="panel-head">
        <div><h3>${methodMeta.name}</h3><p>${methodMeta.desc}</p></div>
        <div class="badge">池内召回 ${fmtPct(pack.pool_recall)}</div>
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
      <div class="grid">${pack.missed.length ? pack.missed.map((t) => tileHTML(t, "miss")).join("") : `<div class="empty-miss">无漏检样例。</div>`}</div>`;
  }

  function renderRetrieveQuestion(q) {
    $("#active-q").hidden = false;
    $("#qid").textContent = q.id;
    const risk = $("#risk");
    risk.textContent = `Caption 难度: ${q.risk}`;
    risk.className = `risk ${q.risk || ""}`;
    $("#q-text").textContent = q.question;
    $("#why").textContent = q.why_hard || "";
    $("#q-meta").innerHTML = `
      <div><label>标准答案</label><strong>${q.answer}</strong></div>
      <div><label>相关图数量</label><strong>${q.n_gt}</strong></div>
      <div><label>候选池大小 K</label><strong>${q.K}</strong></div>`;
    const capR = q.metrics_summary.caption_pool_recall;
    const tokR = q.metrics_summary.visual_token_pool_recall;
    $("#delta-bar").innerHTML = `
      <div class="meter caption"><div class="lab"><span>Caption</span><span>${fmtPct(capR)}</span></div><div class="track"><div class="fill" style="width:${Math.max(2, capR * 100)}%"></div></div></div>
      <div class="meter token"><div class="lab"><span>Visual Token</span><span>${fmtPct(tokR)}</span></div><div class="track"><div class="fill" style="width:${Math.max(2, tokR * 100)}%"></div></div></div>`;
    $("#legend").innerHTML = `
      <span><i class="swatch hit"></i> 相关图（命中）</span>
      <span><i class="swatch noise"></i> 无关图（噪声）</span>
      <span><i class="swatch miss"></i> 相关但未进池（漏检）</span>`;
    $("#stage-body").innerHTML = `
      <div class="compare">
        <article class="panel caption-panel" id="panel-caption"></article>
        <article class="panel token-panel" id="panel-token"></article>
      </div>`;
    renderRetrievePanel($("#panel-caption"), retrieveData.methods.caption, q.caption, "caption");
    renderRetrievePanel($("#panel-token"), retrieveData.methods.visual_token, q.visual_token, "token");
  }

  function renderSelectQuestion(q) {
    $("#active-q").hidden = false;
    $("#qid").textContent = q.id;
    const risk = $("#risk");
    risk.textContent = q.answer_type;
    risk.className = `risk ${q.answer_type === "spatial_relation" ? "high" : "medium"}`;
    $("#q-text").textContent = q.question;
    $("#why").textContent = q.why || "";
    $("#q-meta").innerHTML = `
      <div><label>标准答案</label><strong>${q.gt_answer}</strong></div>
      <div><label>Caption：唯一证据图名次</label><strong style="color:var(--caption)">#${q.caption.anchor_rank ?? "—"}</strong></div>
      <div><label>视觉 token：唯一证据图名次</label><strong style="color:var(--token)">#${q.visual_token.anchor_rank ?? "—"}</strong></div>`;
    $("#delta-bar").innerHTML = `
      <div class="meter caption"><div class="lab"><span>Caption</span><span>定图 ${q.caption.selected_matches_anchor ? "对" : "错"} · ${q.caption.correct ? "答对" : "答错"}</span></div><div class="track"><div class="fill" style="width:${q.caption.selected_matches_anchor ? 100 : 18}%"></div></div></div>
      <div class="meter token"><div class="lab"><span>Visual Token</span><span>定图 ${q.visual_token.selected_matches_anchor ? "对" : "错"} · ${q.visual_token.correct ? "答对" : "答错"}</span></div><div class="track"><div class="fill" style="width:${q.visual_token.selected_matches_anchor ? 100 : 18}%"></div></div></div>`;
    $("#legend").innerHTML = `<span>比较的是「从池子里选哪张图」；答对但定错 = 碰巧对（lucky correct）。</span>`;

    $("#stage-body").innerHTML = `
      <div class="protocol-banner">怎么比：同一候选池里打分 → 只取第 1 名那张图再答题。差别只在打分方式（Caption 文本相似 vs 视觉 token 相关性 Rel）。</div>
      <div class="stage-split">
        <div class="compare" style="grid-template-columns:1fr 1fr">
          <article class="panel caption-panel">
            <div class="panel-head">
              <div><h3>Caption 选图</h3><p>用 caption 相似度从池子里挑图。</p></div>
              <div class="verdict ${q.caption.selected_matches_anchor ? "ok" : "bad"}">${q.caption.selected_matches_anchor ? "定对" : "定错"}</div>
            </div>
            <div class="kpi-row">
              <div class="kpi"><span>模型答案</span><b>${q.caption.pred_answer}</b></div>
              <div class="kpi"><span>答题</span><b>${q.caption.correct ? "对" : "错"}</b></div>
              <div class="kpi"><span>唯一证据图名次</span><b>#${q.caption.anchor_rank ?? "—"}</b></div>
            </div>
            <div class="pair-imgs">
              <div class="slot"><label>Caption 选中</label><img src="${thumb(q.caption.selected_id)}" alt="" /></div>
              <div class="slot"><label>标准唯一图</label><img src="${thumb(q.anchor.id)}" alt="" /></div>
            </div>
            <p class="section-label" style="margin-top:0.85rem">选中图 caption 覆盖的线索</p>
            <p class="cap-text">${q.caption.selected_caption || ""}</p>
            ${cueHTML(q.caption.selected_cues)}
          </article>
          <article class="panel token-panel">
            <div class="panel-head">
              <div><h3>Visual Token 选图</h3><p>用视觉 token 相关性从同一池子挑图。</p></div>
              <div class="verdict ${q.visual_token.selected_matches_anchor ? "ok" : "bad"}">${q.visual_token.selected_matches_anchor ? "定对" : "定错"}</div>
            </div>
            <div class="kpi-row">
              <div class="kpi"><span>模型答案</span><b>${q.visual_token.pred_answer}</b></div>
              <div class="kpi"><span>答题</span><b>${q.visual_token.correct ? "对" : "错"}</b></div>
              <div class="kpi"><span>唯一证据图名次</span><b>#${q.visual_token.anchor_rank ?? "—"}</b></div>
            </div>
            <div class="pair-imgs">
              <div class="slot"><label>Visual Token 选中</label><img src="${thumb(q.visual_token.selected_id)}" alt="" /></div>
              <div class="slot"><label>标准唯一图</label><img src="${thumb(q.anchor.id)}" alt="" /></div>
            </div>
            <p class="section-label" style="margin-top:0.85rem">标准图 caption（对照，不是该方法输入）</p>
            <p class="cap-text">${q.anchor.caption || ""}</p>
            ${cueHTML(q.anchor.cues)}
          </article>
        </div>
        ${analysisHTML(q.analysis)}
      </div>`;
  }

  function renderReadQuestion(q) {
    $("#active-q").hidden = false;
    $("#qid").textContent = q.id;
    const risk = $("#risk");
    const fragile = (q.analysis?.tags || []).includes("脆的正确");
    risk.textContent = fragile ? "脆的正确" : q.caption.correct ? "caption 对" : "caption 错";
    risk.className = `risk ${q.caption.correct && !fragile ? "low" : "high"}`;
    $("#q-text").textContent = q.question;
    $("#why").textContent = q.why || "";
    $("#q-meta").innerHTML = `
      <div><label>标准答案</label><strong>${q.gt_answer}</strong></div>
      <div><label>协议</label><strong>金标唯一图已给定</strong></div>
      <div><label>变量</label><strong>只换证据形式</strong></div>`;
    $("#delta-bar").innerHTML = `
      <div class="meter caption"><div class="lab"><span>只读 Caption</span><span>${q.caption.correct ? "答对" : "答错"} · pred ${q.caption.pred_answer}</span></div><div class="track"><div class="fill" style="width:${q.caption.correct ? (fragile ? 55 : 100) : 18}%"></div></div></div>
      <div class="meter token"><div class="lab"><span>Visual Token</span><span>${q.visual_token.correct ? "答对" : "答错"} · pred ${q.visual_token.pred_answer}</span></div><div class="track"><div class="fill" style="width:${q.visual_token.correct ? 100 : 18}%"></div></div></div>`;
    $("#legend").innerHTML = `<span>图已经选对；比较的是「caption 文本是否足以支撑正确答案」。</span>`;

    $("#stage-body").innerHTML = `
      <div class="protocol-banner">怎么比：正确图已经给定（金标/oracle）。一边只读该图 caption 文本，一边读视觉 token。选图错误已被排除，比的是证据形态本身。</div>
      <div class="stage-split">
        <div>
          <div class="compare" style="grid-template-columns:1fr 1fr">
            <article class="panel caption-panel">
              <div class="panel-head">
                <div><h3>Caption 作答</h3><p>输入：正确图的一条 caption 文本。</p></div>
                <div class="verdict ${q.caption.correct ? "ok" : "bad"}">${q.caption.correct ? (fragile ? "脆的正确" : "答对") : "答错"}</div>
              </div>
              <div class="kpi-row">
                <div class="kpi"><span>预测</span><b>${q.caption.pred_answer}</b></div>
                <div class="kpi"><span>标准</span><b>${q.gt_answer}</b></div>
                <div class="kpi"><span>图是否正确</span><b>是</b></div>
              </div>
              <div class="slot" style="margin-top:0.55rem">
                <label style="font-size:0.72rem;color:var(--muted)">金标图</label>
                <img src="${thumb(q.anchor.id)}" alt="" style="width:100%;border-radius:10px;border:1px solid var(--line)" />
              </div>
              <p class="section-label" style="margin-top:0.8rem">模型看到的 caption</p>
              <p class="cap-text">${q.caption.caption || ""}</p>
            </article>
            <article class="panel token-panel">
              <div class="panel-head">
                <div><h3>Visual Token 作答</h3><p>输入：同一张图的 cached visual tokens。</p></div>
                <div class="verdict ${q.visual_token.correct ? "ok" : "bad"}">${q.visual_token.correct ? "答对" : "答错"}</div>
              </div>
              <div class="kpi-row">
                <div class="kpi"><span>预测</span><b>${q.visual_token.pred_answer}</b></div>
                <div class="kpi"><span>标准</span><b>${q.gt_answer}</b></div>
                <div class="kpi"><span>图是否正确</span><b>是</b></div>
              </div>
              <div class="slot" style="margin-top:0.55rem">
                <label style="font-size:0.72rem;color:var(--muted)">同一张金标图</label>
                <img src="${thumb(q.anchor.id)}" alt="" style="width:100%;border-radius:10px;border:1px solid var(--line)" />
              </div>
              <div class="empty-miss" style="margin-top:0.85rem">不经过 caption 压缩，保留细粒度外观与计数线索。</div>
            </article>
          </div>
        </div>
        ${analysisHTML(q.analysis)}
      </div>`;
  }


  function jumpFromOverview(target) {
    if (target === "retrieve") {
      mode = "retrieve";
      activeId = null;
    } else if (target === "journey") {
      mode = "journey";
      activeId = null;
      journeyStep = 0;
    } else if (target.startsWith("answer:")) {
      mode = "answer";
      answerSub = target.split(":")[1] || "select";
      activeId = null;
    }
    refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function roleClass(role) {
    if (role === "ours") return "ours";
    if (role === "baseline") return "baseline";
    if (role === "upper") return "upper";
    return "mid";
  }

  function renderOverview() {
    const d = overviewData;
    $("#overall-stats").innerHTML = `
      <div class="stat caption"><label>检索召回：Caption → 视觉 token</label><strong>31% → 82%</strong></div>
      <div class="stat token"><label>单图完全匹配：文字 → 视觉</label><strong>45.6% → 87.5%</strong></div>
      <div class="stat"><label>定对唯一图：Caption / Rel</label><strong>0/15 · 15/15</strong></div>`;
    $("#picker-section").hidden = true;
    $("#active-q").hidden = true;
    $("#answer-subtabs").hidden = true;
    $("#journey-root").hidden = true;
    $("#journey-root").innerHTML = "";
    const root = $("#overview-root");
    root.hidden = false;

    const glossary = (d.glossary?.items || [])
      .map(
        (g) => `
      <div class="gloss-item">
        <dt>${g.term}</dt>
        <dd>${g.def}</dd>
      </div>`
      )
      .join("");

    const story = d.story
      .map(
        (s) => `
      <button type="button" class="story-card" data-jump="${s.jump}">
        <div class="step">路径 ${s.step}</div>
        <h3>${s.title}</h3>
        <p>${s.text}</p>
      </button>`
      )
      .join("");

    const ladder = d.ladder_gallery_qa;
    const maxR = Math.max(...ladder.methods.map((m) => m.pool_recall));
    const bars = ladder.methods
      .map((m) => {
        const w = Math.max(4, (m.pool_recall / maxR) * 100);
        return `
        <div class="bar-row">
          <div class="name">${m.name}<span class="blurb">${m.blurb}</span></div>
          <div class="bar-track"><div class="bar-fill ${roleClass(m.role)}" style="width:${w}%"></div></div>
          <div class="bar-meta">召回 ${fmtPct(m.pool_recall)} · 名次比 ${m.rank_ratio_mean.toFixed(2)} · ${m.sec_per_q}s/题</div>
        </div>`;
      })
      .join("");

    const e150 = d.ladder_expand150;
    const e150rows = e150.methods
      .map(
        (m) => `
      <tr class="${roleClass(m.role)}">
        <td>${m.name}</td>
        <td>${fmtPct(m.pool_recall)}</td>
        <td>${m.packing.toFixed(3)}</td>
      </tr>`
      )
      .join("");

    const loc = d.locate_vs_answer;
    const locRows = loc.methods
      .map(
        (m) => `
      <tr class="${/Rel|视觉/.test(m.name) ? "ours" : m.name === "Caption" ? "baseline" : ""}">
        <td>${m.name}</td>
        <td>${fmtPct(m.locate_acc)}</td>
        <td>${fmtPct(m.answer_acc)}</td>
        <td>${m.lucky_note}</td>
      </tr>`
      )
      .join("");

    const ora = d.single_image_oracle;
    const kinds = ora.by_kind
      .map(
        (k) => `
      <div class="kind-card">
        <label>${k.kind}</label>
        <div class="nums"><span class="c">Caption ${fmtPct(k.cap)}</span> → <span class="t">视觉 ${fmtPct(k.vis)}</span></div>
      </div>`
      )
      .join("");

    const cost = d.cost_panel;
    const costCards = cost.rows
      .map(
        (r) => `
      <div class="cost-card ${roleClass(r.role)}">
        <h3>${r.name}</h3>
        <div class="cost-kpis">
          <div><span>池内召回↑</span><b>${fmtPct(r.pool_recall)}</b></div>
          <div><span>排序 packing↓</span><b>${r.packing.toFixed(2)}</b></div>
          <div><span>秒/题</span><b>${r.sec_per_q}</b></div>
        </div>
        <p class="note">${r.note}</p>
      </div>`
      )
      .join("");

    root.innerHTML = `
      <div class="ov-block primer">
        <h2>${d.primer.title}</h2>
        <p class="primer-text">${d.primer.text}</p>
      </div>

      <details class="ov-block glossary" open>
        <summary>
          <span class="gloss-title">${d.glossary.title}</span>
          <span class="gloss-hint">${d.glossary.hint}</span>
        </summary>
        <dl class="gloss-grid">${glossary}</dl>
      </details>

      <div class="ov-block">
        <h2>三条失败路径</h2>
        <p class="setting">点卡片可跳进分阶段案例；想看「提问 → 作答」全过程，用「② 全程逐步」点一步出一步。</p>
        <div class="story-grid">${story}</div>
        <button type="button" class="journey-cta" data-jump="journey">打开全程逐步对照 →</button>
      </div>

      <div class="ov-block">
        <h2>${ladder.name}</h2>
        <p class="setting">${ladder.setting} ${ladder.note}</p>
        <div class="bar-rows">${bars}</div>
      </div>

      <div class="ov-block">
        <h2>${e150.name}</h2>
        <p class="setting">${e150.setting}</p>
        <table class="ov-table">
          <thead><tr><th>方法</th><th>池内召回率 ↑</th><th>排序 packing ↓</th></tr></thead>
          <tbody>${e150rows}</tbody>
        </table>
        <p class="ov-takeaway">${e150.note}</p>
      </div>

      <div class="ov-block">
        <h2>${loc.name}</h2>
        <p class="setting">${loc.setting}</p>
        <table class="ov-table">
          <thead><tr><th>方法</th><th>定图准确率</th><th>答题准确率</th><th>备注</th></tr></thead>
          <tbody>${locRows}</tbody>
        </table>
        <p class="ov-takeaway">${loc.takeaway}</p>
      </div>

      <div class="ov-block">
        <h2>${ora.name}</h2>
        <p class="setting">${ora.setting}</p>
        <div class="dual-bars">
          <div class="dual-item">
            <div class="labs"><span>只读 Caption · 完全匹配（EM）</span><span class="c" style="color:var(--caption);font-weight:700">${fmtPct(ora.em_caption)}</span></div>
            <div class="bar-track"><div class="bar-fill baseline" style="width:${ora.em_caption * 100}%"></div></div>
          </div>
          <div class="dual-item">
            <div class="labs"><span>视觉 token · 完全匹配（EM）</span><span style="color:var(--token);font-weight:700">${fmtPct(ora.em_visual)}</span></div>
            <div class="bar-track"><div class="bar-fill ours" style="width:${ora.em_visual * 100}%"></div></div>
          </div>
        </div>
        <div class="kind-grid">${kinds}</div>
        <p class="ov-takeaway">${ora.takeaway}</p>
      </div>

      <div class="ov-block">
        <h2>${cost.name}</h2>
        <p class="setting">${cost.setting}</p>
        <div class="cost-grid">${costCards}</div>
        <p class="ov-takeaway">${cost.takeaway}</p>
      </div>`;

    root.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", () => jumpFromOverview(btn.dataset.jump));
    });

    $("#foot-note").textContent =
      "数字来自开放图库检索评测（Gallery QA）、Expand-150 对照、定图协议与单图金标对比。更细的词义见上方「读懂这些词」；想看全过程请用「全程逐步」。";
  }

  function journeySideHTML(side, tone) {
    if (!side) return `<div class="j-empty">本步暂无内容</div>`;
    const toneCls = tone === "caption" ? "caption-panel" : "token-panel";

    if (side.type === "encode_caption") {
      const issues = (side.issues || [])
        .map((it) => `<div class="issue"><q>「${it.quote}」</q><div>${it.problem}</div></div>`)
        .join("");
      return `
        <article class="panel ${toneCls}">
          <div class="panel-head"><div><h3>${side.title}</h3></div></div>
          <ul class="j-points">${(side.points || []).map((p) => `<li>${p}</li>`).join("")}</ul>
          ${side.sample_text ? `<p class="section-label">${side.sample_label || "文本"}</p><p class="cap-text">${side.sample_text}</p>` : ""}
          ${issues ? `<div class="issue-list">${issues}</div>` : ""}
        </article>`;
    }

    if (side.type === "encode_token") {
      return `
        <article class="panel ${toneCls}">
          <div class="panel-head"><div><h3>${side.title}</h3></div></div>
          <ul class="j-points">${(side.points || []).map((p) => `<li>${p}</li>`).join("")}</ul>
          ${side.image_id ? `<div class="slot" style="margin-top:0.6rem"><label>${side.sample_label || "图像"}</label><img src="${thumb(side.image_id)}" alt="" /></div>` : ""}
          ${side.sample_note ? `<div class="empty-miss" style="margin-top:0.7rem">${side.sample_note}</div>` : ""}
        </article>`;
    }

    if (side.type === "rank") {
      const rankPct = Math.max(8, 100 - (Number(side.rank) - 1) * 6);
      return `
        <article class="panel ${toneCls}">
          <div class="panel-head"><div><h3>${side.title}</h3></div>
            <div class="verdict ${side.status === "ok" ? "ok" : "bad"}">#${side.rank}</div>
          </div>
          <p class="section-label">${side.rank_label || "名次"}</p>
          <div class="j-rank-meter"><div class="fill ${side.status}" style="width:${rankPct}%"></div></div>
          <p class="j-note">${side.rank_note || ""}</p>
        </article>`;
    }

    if (side.type === "pick") {
      return `
        <article class="panel ${toneCls}">
          <div class="panel-head">
            <div><h3>${side.title}</h3></div>
            <div class="verdict ${side.match ? "ok" : "bad"}">${side.match ? "定对" : "定错"}</div>
          </div>
          <div class="pair-imgs">
            <div class="slot"><label>选中图</label><img src="${thumb(side.selected_id)}" alt="" /></div>
            <div class="slot"><label>标准唯一图</label><img src="${thumb(side.anchor_id)}" alt="" /></div>
          </div>
          ${side.caption ? `<p class="section-label" style="margin-top:0.75rem">选中图 caption</p><p class="cap-text">${side.caption}</p>` : ""}
          ${cueHTML(side.cues)}
        </article>`;
    }

    if (side.type === "answer") {
      return `
        <article class="panel ${toneCls}">
          <div class="panel-head">
            <div><h3>${side.title}</h3></div>
            <div class="verdict ${side.correct ? (side.lucky ? "warn" : "ok") : "bad"}">${
              side.lucky ? "碰巧对" : side.correct ? "答对" : "答错"
            }</div>
          </div>
          <div class="j-answer-bubble">${fmtAns(side.pred)}</div>
          <p class="j-note">${side.note || ""}</p>
        </article>`;
    }

    return `<article class="panel ${toneCls}"><pre>${JSON.stringify(side, null, 2)}</pre></article>`;
  }

  function journeySharedHTML(shared) {
    if (!shared) return "";
    if (shared.type === "question") {
      return `
        <div class="j-shared">
          <div class="j-shared-label">用户问题</div>
          <h3 class="j-q">${shared.text}</h3>
          ${shared.meta ? `<p class="j-meta">${shared.meta}</p>` : ""}
        </div>`;
    }
    if (shared.type === "gold_image") {
      return `
        <div class="j-shared">
          <div class="j-shared-label">${shared.label || "金标图"}</div>
          <img class="j-gold" src="${thumb(shared.image_id)}" alt="" />
        </div>`;
    }
    return "";
  }

  function journeyVerdictHTML(step, journey) {
    return `
      <div class="j-verdict-wrap">
        <div class="j-gt"><span>标准答案</span><strong>${step.gt_answer || journey.gt_answer}</strong></div>
        <div class="j-verdict-grid">
          <div class="j-verdict-card caption">
            <h3>${step.left.title}</h3>
            <div class="flags">
              <span class="${step.left.locate_ok ? "ok" : "bad"}">定图 ${step.left.locate_ok ? "✓" : "✗"}</span>
              <span class="${step.left.answer_ok ? "ok" : "bad"}">答题 ${step.left.answer_ok ? "✓" : "✗"}</span>
            </div>
            <div class="pred">预测：${fmtAns(step.left.pred)}</div>
            <div class="tag">${step.left.tag}</div>
          </div>
          <div class="j-verdict-card token">
            <h3>${step.right.title}</h3>
            <div class="flags">
              <span class="${step.right.locate_ok ? "ok" : "bad"}">定图 ${step.right.locate_ok ? "✓" : "✗"}</span>
              <span class="${step.right.answer_ok ? "ok" : "bad"}">答题 ${step.right.answer_ok ? "✓" : "✗"}</span>
            </div>
            <div class="pred">预测：${fmtAns(step.right.pred)}</div>
            <div class="tag">${step.right.tag}</div>
          </div>
        </div>
        ${analysisHTML(journey.analysis)}
      </div>`;
  }

  function journeyBeatBody(step, journey) {
    if (step.layout === "shared") return journeySharedHTML(step.shared);
    if (step.layout === "verdict") return journeyVerdictHTML(step, journey);
    return `
      <div class="j-dual">
        <div class="j-col">
          <div class="j-col-label caption">Caption 路径</div>
          ${journeySideHTML(step.left, "caption")}
        </div>
        <div class="j-col">
          <div class="j-col-label token">Visual Token 路径</div>
          ${journeySideHTML(step.right, "token")}
        </div>
      </div>`;
  }

  function renderJourney() {
    hideAllStages();
    $("#picker-section").hidden = false;
    $("#answer-subtabs").hidden = true;

    const journeys = journeyData.journeys;
    if (!journeys.some((j) => j.id === activeId)) {
      activeId = journeys[0].id;
      journeyStep = 0;
    }
    const journey = journeys.find((j) => j.id === activeId);
    const steps = journey.steps;
    if (journeyStep < 0) journeyStep = 0;
    if (journeyStep >= steps.length) journeyStep = steps.length - 1;
    const atEnd = journeyStep === steps.length - 1;
    const atStart = journeyStep === 0;

    $("#overall-stats").innerHTML = `
      <div class="stat"><label>当前案例</label><strong style="font-size:1.05rem">${journey.badge}</strong></div>
      <div class="stat token"><label>已展开</label><strong>${journeyStep + 1} / ${steps.length} 步</strong></div>
      <div class="stat caption"><label>操作</label><strong style="font-size:1.05rem">向下追加展开</strong></div>`;
    $("#picker-title").textContent = "选择全程案例";
    $("#picker-desc").textContent =
      "像看录像一样：点「下一步」会在下方追加新一幕，上面已展开的内容一直保留，整条链路可上下浏览。";
    $("#foot-note").textContent =
      "全程逐步为预计算轨迹回放：内容从上往下累积展开，左右对照 Caption 与 Visual Token。";

    const list = $("#q-list");
    list.innerHTML = "";
    journeys.forEach((j) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `q-btn${j.id === activeId ? " active" : ""}`;
      btn.innerHTML = `
        <div class="row"><span>${j.badge}</span><span>${j.steps.length} 步</span></div>
        <div class="title">${j.title}</div>
        <div class="scores"><span class="t">${j.blurb}</span></div>`;
      btn.addEventListener("click", () => {
        activeId = j.id;
        journeyStep = 0;
        refresh();
      });
      list.appendChild(btn);
    });

    const stepper = steps
      .map(
        (s, i) => `
      <button type="button" class="j-step ${i === journeyStep ? "current" : i < journeyStep ? "done" : ""}" data-step="${i}" ${
          i > journeyStep + 1 ? "disabled" : ""
        }>
        <span class="n">${i + 1}</span><span class="t">${s.title}</span>
      </button>`
      )
      .join("");

    const timeline = steps
      .slice(0, journeyStep + 1)
      .map((s, i) => {
        const isLatest = i === journeyStep;
        return `
        <section class="j-beat${isLatest ? " j-reveal is-latest" : ""}" id="j-beat-${i}" data-beat="${i}">
          <div class="j-beat-rail" aria-hidden="true"></div>
          <div class="j-beat-head">
            <span class="j-beat-n">第 ${i + 1} / ${steps.length} 步</span>
            <h3>${s.title}</h3>
            <p>${s.narrator || ""}</p>
          </div>
          <div class="j-beat-body">${journeyBeatBody(s, journey)}</div>
        </section>`;
      })
      .join("");

    const root = $("#journey-root");
    root.hidden = false;
    root.innerHTML = `
      <div class="j-shell">
        <div class="j-head">
          <div class="j-badge">${journey.badge}</div>
          <h2>${journey.title}</h2>
          <p class="j-blurb">${journey.blurb}</p>
        </div>
        <div class="j-stepper" aria-label="进度">${stepper}</div>
        <div class="j-timeline">${timeline}</div>
        <div class="j-controls">
          <button type="button" class="j-btn ghost" id="j-prev" ${atStart ? "disabled" : ""}>收回一步</button>
          <button type="button" class="j-btn ghost" id="j-reset">从头重来</button>
          <button type="button" class="j-btn primary" id="j-next" ${atEnd ? "disabled" : ""}>${
            atEnd ? "已全部展开" : "下一步，向下展开 →"
          }</button>
        </div>
      </div>`;

    root.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = Number(btn.dataset.step);
        if (target < journeyStep) {
          // jump-scroll to an already revealed beat; keep later content
          document.getElementById(`j-beat-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (target === journeyStep + 1) {
          journeyShouldScroll = true;
          journeyStep = target;
          refresh();
        }
      });
    });
    $("#j-prev")?.addEventListener("click", () => {
      if (journeyStep > 0) {
        journeyShouldScroll = false;
        journeyStep -= 1;
        refresh();
      }
    });
    $("#j-reset")?.addEventListener("click", () => {
      journeyShouldScroll = false;
      journeyStep = 0;
      refresh();
    });
    $("#j-next")?.addEventListener("click", () => {
      if (journeyStep < steps.length - 1) {
        journeyShouldScroll = true;
        journeyStep += 1;
        refresh();
      }
    });

    if (journeyShouldScroll) {
      journeyShouldScroll = false;
      requestAnimationFrame(() => {
        document.getElementById(`j-beat-${journeyStep}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }

  function syncHash() {
    const parts = [`mode=${mode}`];
    if (mode === "answer") parts.push(`sub=${answerSub}`);
    if (mode === "journey") parts.push(`step=${journeyStep}`);
    if (mode !== "overview" && activeId) parts.push(`q=${encodeURIComponent(activeId)}`);
    history.replaceState(null, "", `#${parts.join("&")}`);
  }

  function parseHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const map = Object.fromEntries(
      raw.split("&").map((kv) => {
        const [k, v] = kv.split("=");
        return [k, decodeURIComponent(v || "")];
      })
    );
    if (map.mode === "overview" || map.mode === "journey" || map.mode === "retrieve" || map.mode === "answer") {
      mode = map.mode;
    }
    if (map.sub === "select" || map.sub === "read") answerSub = map.sub;
    if (map.sub === "locate" || map.sub === "list") answerSub = "select";
    if (map.q) activeId = map.q;
    if (map.step != null && map.step !== "") journeyStep = Math.max(0, Number(map.step) || 0);
  }

  function refresh() {
    document.querySelectorAll(".mode-tab").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".subtab").forEach((b) => {
      b.classList.toggle("active", b.dataset.sub === answerSub);
    });

    if (mode === "overview") {
      renderOverview();
    } else if (mode === "journey") {
      renderJourney();
    } else if (mode === "retrieve") {
      hideAllStages();
      $("#picker-section").hidden = false;
      renderRetrieveOverall();
      const qs = retrieveData.questions;
      if (!qs.some((q) => q.id === activeId)) activeId = qs[0].id;
      renderRetrievePicker((id) => {
        activeId = id;
        refresh();
      });
      renderRetrieveQuestion(qs.find((q) => q.id === activeId));
    } else {
      hideAllStages();
      $("#picker-section").hidden = false;
      renderAnswerOverall();
      const qs = answerSub === "select" ? qaData.select_questions : qaData.read_questions;
      if (!qs.some((q) => q.id === activeId)) activeId = qs[0].id;
      renderAnswerPicker((id) => {
        activeId = id;
        refresh();
      });
      const q = qs.find((x) => x.id === activeId);
      if (answerSub === "select") renderSelectQuestion(q);
      else renderReadQuestion(q);
    }
    syncHash();
  }

  async function main() {
    const [rRes, qRes, oRes, jRes] = await Promise.all([
      fetch("./data/demo.json"),
      fetch("./data/qa_demo.json"),
      fetch("./data/overview.json"),
      fetch("./data/journey.json"),
    ]);
    retrieveData = await rRes.json();
    qaData = await qRes.json();
    overviewData = await oRes.json();
    journeyData = await jRes.json();
    parseHash();

    document.querySelectorAll(".mode-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.mode;
        activeId = null;
        journeyStep = 0;
        refresh();
      });
    });
    document.querySelectorAll(".subtab").forEach((btn) => {
      btn.addEventListener("click", () => {
        answerSub = btn.dataset.sub;
        activeId = null;
        refresh();
      });
    });

    refresh();
  }

  main().catch((err) => {
    console.error(err);
    $("#overall-stats").innerHTML = `<div class="stat"><label>加载失败</label><strong style="font-size:1rem">${err.message}</strong></div>`;
  });
})();
