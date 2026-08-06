(() => {
  const $ = (sel) => document.querySelector(sel);
  const thumb = (id) => `./thumbs/${String(id).replace(/\.png$/i, ".jpg")}`;
  const fmtPct = (x) => `${(Number(x) * 100).toFixed(1)}%`;

  let retrieveData = null;
  let qaData = null;
  let mode = "retrieve"; // retrieve | answer
  let answerSub = "list"; // list | locate
  let activeId = null;

  function tileHTML(item, kind) {
    const label = kind === "miss" ? "漏检" : kind === "wrong" ? "错选" : kind === "skip" ? "未选" : item.label === "hit" ? "命中" : item.label === "noise" ? "噪声" : "相关";
    const cls = kind === "miss" ? "miss" : kind === "wrong" ? "miss" : kind === "skip" ? "noise" : item.label || "hit";
    const rank = item.rank != null ? `<span class="rank">#${item.rank}</span>` : "";
    return `
      <div class="tile ${cls}" title="${item.id}">
        <img src="${thumb(item.id)}" alt="${item.id}" loading="lazy" />
        ${rank}
        <span class="tag">${label}</span>
      </div>
    `;
  }

  function cueHTML(cues) {
    if (!cues || !cues.length) return "";
    return `<div class="cue-row">${cues
      .map((c) => `<span class="cue ${c.present ? "ok" : "bad"}">${c.cue}${c.present ? " ✓" : " ✗"}</span>`)
      .join("")}</div>`;
  }

  function lossCardsHTML(examples) {
    if (!examples || !examples.length) return `<div class="empty-miss">暂无样例。</div>`;
    return examples
      .map((ex) => {
        const role = ex.role === "wrong_selected" ? "错选进答案" : "检索阶段就漏掉";
        return `
        <div class="loss-card">
          <div class="loss-top">
            <img src="${thumb(ex.id)}" alt="${ex.id}" loading="lazy" />
            <div>
              <div class="verdict bad">${role}</div>
              <p class="cap-text">${ex.caption || "（无 caption）"}</p>
              ${cueHTML(ex.cues)}
            </div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderRetrieveOverall() {
    const o = retrieveData.overall;
    $("#overall-stats").innerHTML = `
      <div class="stat caption"><label>Caption pool recall（24 题）</label><strong>${fmtPct(o.caption_pool_recall)}</strong></div>
      <div class="stat token"><label>Visual Token pool recall</label><strong>${fmtPct(o.visual_token_pool_recall)}</strong></div>
      <div class="stat"><label>相对提升</label><strong>+${((o.visual_token_pool_recall - o.caption_pool_recall) * 100).toFixed(1)} pt</strong></div>
    `;
    $("#picker-title").textContent = "选择问题";
    $("#picker-desc").textContent = "8 道代表性题目，来自 Gallery QA v1（检索阶段）。";
    $("#answer-subtabs").hidden = true;
    $("#foot-note").textContent =
      "指标为 pool recall：候选池前 K 张中命中的相关图比例。Visual Token 对应全库 Rel tok/2；评测均值 Caption 0.311 → Visual Token 0.823（24 题）。";
  }

  function renderAnswerOverall() {
    const s = qaData.overall.locate_summary;
    $("#overall-stats").innerHTML = `
      <div class="stat caption"><label>Caption 定图准确率（15 题）</label><strong>${fmtPct(s.caption_locate_acc)}</strong></div>
      <div class="stat token"><label>Visual Token 定图 / 答题</label><strong>${fmtPct(s.visual_token_locate_acc)} / ${fmtPct(s.visual_token_answer_acc)}</strong></div>
      <div class="stat caption"><label>Caption 答题准确率（含碰巧对）</label><strong>${fmtPct(s.caption_answer_acc)}</strong></div>
    `;
    $("#picker-title").textContent = "选择答题问题";
    $("#picker-desc").textContent =
      answerSub === "list"
        ? "开放图库：检索后由模型选图作答。看命中 / 错选 / 检索漏掉，以及 caption 文本缺了哪些线索。"
        : "定唯一图再答题：Caption 常定错图；Visual Token（Rel）15/15 定对并答对。";
    $("#answer-subtabs").hidden = false;
    $("#foot-note").textContent =
      "答题对比使用已有实验结果：开放图库选图来自 Caption QA vs Cached Visual Token QA；定图协议来自 qa_score_top1（Caption vs Rel）。";
  }

  function renderRetrievePicker(onSelect) {
    const root = $("#q-list");
    root.innerHTML = "";
    retrieveData.questions.forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `q-btn${q.id === activeId ? " active" : ""}`;
      btn.innerHTML = `
        <div class="row"><span>${q.id}</span><span>${q.risk || ""} · |E*|=${q.n_gt}</span></div>
        <div class="title">${q.question}</div>
        <div class="scores">
          <span class="c">Cap ${fmtPct(q.metrics_summary.caption_pool_recall)}</span>
          <span class="t">Tok ${fmtPct(q.metrics_summary.visual_token_pool_recall)}</span>
        </div>`;
      btn.addEventListener("click", () => onSelect(q.id));
      root.appendChild(btn);
    });
  }

  function renderAnswerPicker(onSelect) {
    const qs = answerSub === "list" ? qaData.list_questions : qaData.locate_questions;
    const root = $("#q-list");
    root.innerHTML = "";
    qs.forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `q-btn${q.id === activeId ? " active" : ""}`;
      if (answerSub === "list") {
        btn.innerHTML = `
          <div class="row"><span>${q.id}</span><span>${q.risk} · |E*|=${q.n_gt}</span></div>
          <div class="title">${q.question}</div>
          <div class="scores">
            <span class="c">F1 ${fmtPct(q.caption.f1)}</span>
            <span class="t">F1 ${fmtPct(q.visual_token.f1)}</span>
          </div>`;
      } else {
        btn.innerHTML = `
          <div class="row"><span>${q.answer_type}</span><span>${q.parent_qid}</span></div>
          <div class="title">${q.question}</div>
          <div class="scores">
            <span class="c">${q.caption.correct ? "答对" : "答错"} · 定图${q.caption.selected_matches_anchor ? "✓" : "✗"}</span>
            <span class="t">${q.visual_token.correct ? "答对" : "答错"} · 定图${q.visual_token.selected_matches_anchor ? "✓" : "✗"}</span>
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
      <div class="grid">${pack.missed.length ? pack.missed.map((t) => tileHTML(t, "miss")).join("") : `<div class="empty-miss">无漏检样例。</div>`}</div>
    `;
  }

  function renderRetrieveQuestion(q) {
    $("#active-q").hidden = false;
    $("#qid").textContent = q.id;
    const risk = $("#risk");
    risk.textContent = `caption risk: ${q.risk}`;
    risk.className = `risk ${q.risk || ""}`;
    $("#q-text").textContent = q.question;
    $("#why").textContent = q.why_hard || "";
    $("#q-meta").innerHTML = `
      <div><label>标准答案</label><strong>${q.answer}</strong></div>
      <div><label>相关图 |E*|</label><strong>${q.n_gt}</strong></div>
      <div><label>候选池 K</label><strong>${q.K}</strong></div>`;
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

  function renderListAnswer(q) {
    $("#active-q").hidden = false;
    $("#qid").textContent = q.id;
    const risk = $("#risk");
    risk.textContent = `caption risk: ${q.risk}`;
    risk.className = `risk ${q.risk || ""}`;
    $("#q-text").textContent = q.question;
    $("#why").textContent = q.why || "";
    $("#q-meta").innerHTML = `
      <div><label>相关图数</label><strong>${q.n_gt}</strong></div>
      <div><label>Caption F1</label><strong style="color:var(--caption)">${fmtPct(q.caption.f1)}</strong></div>
      <div><label>Visual Token F1</label><strong style="color:var(--token)">${fmtPct(q.visual_token.f1)}</strong></div>`;
    $("#delta-bar").innerHTML = `
      <div class="meter caption"><div class="lab"><span>Caption 答题 recall</span><span>${fmtPct(q.caption.recall)}</span></div><div class="track"><div class="fill" style="width:${Math.max(2, q.caption.recall * 100)}%"></div></div></div>
      <div class="meter token"><div class="lab"><span>Visual Token 答题 recall</span><span>${fmtPct(q.visual_token.recall)}</span></div><div class="track"><div class="fill" style="width:${Math.max(2, q.visual_token.recall * 100)}%"></div></div></div>`;
    $("#legend").innerHTML = `
      <span><i class="swatch hit"></i> 选对</span>
      <span><i class="swatch miss"></i> 错选 / 漏检</span>
      <span><i class="swatch noise"></i> 检索到但未选</span>`;

    const side = (name, pack, isCap) => `
      <article class="panel ${isCap ? "caption-panel" : "token-panel"}">
        <div class="panel-head">
          <div>
            <h3>${name}</h3>
            <p>${isCap ? "先检索 caption，再让文本 LLM 从候选里勾选答案图。" : "用视觉 token 检索/答题，直接基于图像证据选择。"}</p>
          </div>
          <div class="badge">F1 ${fmtPct(pack.f1)}</div>
        </div>
        <div class="kpi-row">
          <div class="kpi"><span>选对</span><b>${pack.n_hit}/${pack.n_gt}</b></div>
          <div class="kpi"><span>错选</span><b>${pack.n_wrong_sel}</b></div>
          <div class="kpi"><span>检索漏掉</span><b>${pack.n_miss_retrieve}</b></div>
        </div>
        <p class="section-label">选对的图</p>
        <div class="grid">${pack.hit_selected.length ? pack.hit_selected.map((t) => tileHTML(t)).join("") : '<div class="empty-miss">无</div>'}</div>
        <p class="section-label" style="margin-top:0.9rem">错选的图</p>
        <div class="grid">${pack.wrong_selected.length ? pack.wrong_selected.map((t) => tileHTML(t, "wrong")).join("") : '<div class="empty-miss">无错选</div>'}</div>
        <p class="section-label" style="margin-top:0.9rem">检索到但未选</p>
        <div class="grid">${pack.retrieved_not_selected.length ? pack.retrieved_not_selected.map((t) => tileHTML(t, "skip")).join("") : '<div class="empty-miss">无</div>'}</div>
        <p class="section-label" style="margin-top:0.9rem">检索阶段就漏掉</p>
        <div class="grid">${pack.missed_retrieve.length ? pack.missed_retrieve.map((t) => tileHTML(t, "miss")).join("") : '<div class="empty-miss">无</div>'}</div>
      </article>`;

    $("#stage-body").innerHTML = `
      <div class="compare">
        ${side("Caption 答题", q.caption, true)}
        ${side("Visual Token 答题", q.visual_token, false)}
      </div>
      <div class="q-card" style="margin-top:0.9rem">
        <h3 style="margin:0 0 0.35rem;font-size:1.05rem">Caption 漏掉了什么信息？</h3>
        <p class="why" style="margin-top:0">对错选 / 漏检样例，检查其 caption 是否覆盖题干关键线索（✓ 出现 / ✗ 缺失）。</p>
        ${lossCardsHTML(q.caption_info_loss)}
      </div>`;
  }

  function renderLocateAnswer(q) {
    $("#active-q").hidden = false;
    $("#qid").textContent = q.id;
    const risk = $("#risk");
    risk.textContent = q.answer_type;
    risk.className = `risk ${q.answer_type === "spatial_relation" ? "high" : "medium"}`;
    $("#q-text").textContent = q.question;
    $("#why").textContent = q.why || "";
    $("#q-meta").innerHTML = `
      <div><label>标准答案</label><strong>${q.gt_answer}</strong></div>
      <div><label>题干线索</label><strong style="font-size:0.85rem">${(q.required_cues || []).join(" · ")}</strong></div>
      <div><label>协议</label><strong>池内打分 → top-1 再答</strong></div>`;
    $("#delta-bar").innerHTML = `
      <div class="meter caption"><div class="lab"><span>Caption</span><span>${q.caption.correct ? "答对" : "答错"} · 定图 ${q.caption.selected_matches_anchor ? "对" : "错"}</span></div><div class="track"><div class="fill" style="width:${q.caption.correct ? 100 : 18}%"></div></div></div>
      <div class="meter token"><div class="lab"><span>Visual Token</span><span>${q.visual_token.correct ? "答对" : "答错"} · 定图 ${q.visual_token.selected_matches_anchor ? "对" : "错"}</span></div><div class="track"><div class="fill" style="width:${q.visual_token.correct ? 100 : 18}%"></div></div></div>`;
    $("#legend").innerHTML = `<span>左：Caption 选中图（常错） · 中：标准唯一图 · 右：Visual Token 选中图</span>`;

    $("#stage-body").innerHTML = `
      <div class="compare">
        <article class="panel caption-panel">
          <div class="panel-head">
            <div><h3>Caption 定图 + 文本答题</h3><p>用 caption hybrid 在池内打分取 top-1，再只看该图 caption 作答。</p></div>
            <div class="verdict ${q.caption.correct ? "ok" : "bad"}">${q.caption.correct ? "答对" : "答错"}</div>
          </div>
          <div class="kpi-row">
            <div class="kpi"><span>定图</span><b>${q.caption.selected_matches_anchor ? "命中 anchor" : "定错"}</b></div>
            <div class="kpi"><span>anchor 名次</span><b>#${q.caption.anchor_rank ?? "—"}</b></div>
            <div class="kpi"><span>模型答案</span><b>${q.caption.pred_answer}</b></div>
          </div>
          <div class="pair-imgs">
            <div class="slot">
              <label>Caption 选中</label>
              <img src="${thumb(q.caption.selected_id)}" alt="" />
            </div>
            <div class="slot">
              <label>标准唯一图</label>
              <img src="${thumb(q.anchor.id)}" alt="" />
            </div>
          </div>
          <p class="section-label" style="margin-top:0.9rem">选中图的 caption 覆盖了哪些线索？</p>
          <p class="cap-text">${q.caption.selected_caption || ""}</p>
          ${cueHTML(q.caption.selected_cues)}
        </article>
        <article class="panel token-panel">
          <div class="panel-head">
            <div><h3>Visual Token Rel 定图 + 视觉答题</h3><p>用 visual token 相关性打分取 top-1，再在该图 visual tokens 上作答。</p></div>
            <div class="verdict ${q.visual_token.correct ? "ok" : "bad"}">${q.visual_token.correct ? "答对" : "答错"}</div>
          </div>
          <div class="kpi-row">
            <div class="kpi"><span>定图</span><b>${q.visual_token.selected_matches_anchor ? "命中 anchor" : "定错"}</b></div>
            <div class="kpi"><span>anchor 名次</span><b>#${q.visual_token.anchor_rank ?? "—"}</b></div>
            <div class="kpi"><span>模型答案</span><b>${q.visual_token.pred_answer}</b></div>
          </div>
          <div class="pair-imgs">
            <div class="slot">
              <label>Visual Token 选中</label>
              <img src="${thumb(q.visual_token.selected_id)}" alt="" />
            </div>
            <div class="slot">
              <label>标准唯一图 caption（对照）</label>
              <img src="${thumb(q.anchor.id)}" alt="" />
            </div>
          </div>
          <p class="section-label" style="margin-top:0.9rem">标准图 caption 里的线索</p>
          <p class="cap-text">${q.anchor.caption || ""}</p>
          ${cueHTML(q.anchor.cues)}
          ${
            !q.caption.selected_matches_anchor && q.visual_token.selected_matches_anchor
              ? `<div class="empty-miss" style="margin-top:0.8rem">Caption 定错图后，后续答题建立在错误证据上；Visual Token 先钉住唯一图，再读图作答。</div>`
              : ""
          }
        </article>
      </div>`;
  }

  function syncHash() {
    const parts = [`mode=${mode}`];
    if (mode === "answer") parts.push(`sub=${answerSub}`);
    if (activeId) parts.push(`q=${encodeURIComponent(activeId)}`);
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
    if (map.mode === "retrieve" || map.mode === "answer") mode = map.mode;
    if (map.sub === "list" || map.sub === "locate") answerSub = map.sub;
    if (map.q) activeId = map.q;
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

    if (mode === "retrieve") {
      renderRetrieveOverall();
      const qs = retrieveData.questions;
      if (!qs.some((q) => q.id === activeId)) activeId = qs[0].id;
      renderRetrievePicker((id) => {
        activeId = id;
        refresh();
      });
      renderRetrieveQuestion(qs.find((q) => q.id === activeId));
    } else {
      renderAnswerOverall();
      const qs = answerSub === "list" ? qaData.list_questions : qaData.locate_questions;
      if (!qs.some((q) => q.id === activeId)) activeId = qs[0].id;
      renderAnswerPicker((id) => {
        activeId = id;
        refresh();
      });
      const q = qs.find((x) => x.id === activeId);
      if (answerSub === "list") renderListAnswer(q);
      else renderLocateAnswer(q);
    }
    syncHash();
  }

  async function main() {
    const [rRes, qRes] = await Promise.all([fetch("./data/demo.json"), fetch("./data/qa_demo.json")]);
    retrieveData = await rRes.json();
    qaData = await qRes.json();
    parseHash();

    document.querySelectorAll(".mode-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.mode;
        activeId = null;
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
