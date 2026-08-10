(() => {
  const $ = (sel) => document.querySelector(sel);
  const thumb = (id) => `./thumbs/${String(id).replace(/\.png$/i, ".jpg")}`;
  const fmtPct = (x) => `${(Number(x) * 100).toFixed(1)}%`;
  const DATA_V = "20260810o";

  let retrieveData = null;
  let qaData = null;
  let overviewData = null;
  let journeyData = null;
  let miniData = null;
  let pipelineData = null;
  let packData = null;
  let miniStep = 0;
  let pipelineStep = 0;
  let pipelineTimer = null;
  let mode = "mini"; // mini | pipeline | journey | overview | retrieve | answer | translate
  let answerSub = "select"; // select | read
  let activeId = null;
  let journeyStep = 0;
  let journeyShouldScroll = false;
  const loading = {};

  function fmtAns(a) {
    if (a == null) return "—";
    if (typeof a === "boolean") return a ? "是" : "否";
    if (typeof a === "object") return JSON.stringify(a);
    return String(a);
  }

  function failStepLabel(step, kind = "short") {
    const short = { select: "选图", read: "读文字", rank: "排序", retrieve: "找图" };
    const long = { select: "选定要看的图", read: "读证据作答", rank: "排序", retrieve: "找图" };
    return (kind === "long" ? long : short)[step] || step;
  }

  async function loadJson(path) {
    const res = await fetch(`${path}?v=${DATA_V}`);
    if (!res.ok) throw new Error(`${path} 请求失败（HTTP ${res.status}）`);
    return res.json();
  }

  async function ensureJson(key, path, getter, setter) {
    if (getter()) return getter();
    if (!loading[key]) {
      loading[key] = loadJson(path)
        .then((d) => {
          setter(d);
          return d;
        })
        .finally(() => {
          delete loading[key];
        });
    }
    return loading[key];
  }

  async function ensureModeData(targetMode) {
    const tasks = [];
    if (targetMode === "mini" || targetMode === "overview") {
      tasks.push(ensureJson("overview", "./data/overview.json", () => overviewData, (d) => (overviewData = d)));
    }
    if (targetMode === "mini") {
      tasks.push(ensureJson("mini", "./data/mini_demo.json", () => miniData, (d) => (miniData = d)));
    }
    if (targetMode === "pipeline") {
      tasks.push(ensureJson("pipeline", "./data/pipeline.json", () => pipelineData, (d) => (pipelineData = d)));
    }
    if (targetMode === "journey") {
      tasks.push(ensureJson("journey", "./data/journey.json", () => journeyData, (d) => (journeyData = d)));
    }
    if (targetMode === "retrieve") {
      tasks.push(ensureJson("retrieve", "./data/demo.json", () => retrieveData, (d) => (retrieveData = d)));
    }
    if (targetMode === "answer") {
      tasks.push(ensureJson("answer", "./data/qa_demo.json", () => qaData, (d) => (qaData = d)));
    }
    if (targetMode === "translate") {
      tasks.push(ensureJson("pack", "./data/pack_demo.json", () => packData, (d) => (packData = d)));
    }
    await Promise.all(tasks);
  }

  /** Demo 先出来；其余 Tab 数据在空闲时后台预取，切换时通常已就绪。 */
  function prefetchRemainingData() {
    const queue = ["pipeline", "journey", "overview", "retrieve", "answer", "translate", "mini"];
    const run = async () => {
      for (const m of queue) {
        try {
          await ensureModeData(m);
        } catch (err) {
          console.warn("后台预取跳过", m, err);
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    const start = () => {
      run();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(start, { timeout: 2500 });
    } else {
      setTimeout(start, 600);
    }
  }

  function hideAllStages() {
    $("#overview-root").hidden = true;
    $("#overview-root").innerHTML = "";
    $("#pipeline-root").hidden = true;
    $("#pipeline-root").innerHTML = "";
    $("#pack-root").hidden = true;
    $("#pack-root").innerHTML = "";
    $("#journey-root").hidden = true;
    $("#journey-root").innerHTML = "";
    $("#mini-root").hidden = true;
    $("#mini-root").innerHTML = "";
    $("#picker-section").hidden = true;
    $("#active-q").hidden = true;
    $("#answer-subtabs").hidden = true;
    stopPipelinePlay();
  }

  function renderPitch() {
    const pitch = overviewData?.pitch;
    const root = $("#pitch-root");
    if (!root || !pitch) return;

    const bullets = (pitch.bullets || []).map((b) => `<li>${b}</li>`).join("");
    const stats = (pitch.stats || [])
      .map(
        (s) => `
      <div class="pitch-stat ${s.tone || ""}">
        <span>${s.label}</span>
        <strong>${s.value}</strong>
      </div>`
      )
      .join("");

    root.innerHTML = `
      <div class="pitch-shell pitch-shell-solo">
        <div class="pitch-elev">
          <div class="pitch-kicker">${pitch.title}</div>
          <ul class="pitch-bullets">${bullets}</ul>
          <div class="pitch-stats">${stats}</div>
        </div>
      </div>`;
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

  function cueHTML(cues, { withLegend = false } = {}) {
    if (!cues || !cues.length) return "";
    const legend = withLegend
      ? `<p class="cue-legend">关键词检查：题目里提到的颜色/形状等，在这段 caption 文字里有没有写到。<span class="cue ok">绿勾 ✓</span> = 写到了；<span class="cue bad">红叉 ✗</span> = 没写到（文字证据缺了这层信息）。</p>`
      : "";
    return `${legend}<div class="cue-row">${cues
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
      "检索 = 从大图库捞出候选池（相关图进没进前 K）。下一步的「定图」才是在这个池子里选出要看的那一张。绿框=命中，灰框=噪声，红框=漏检。";
    $("#answer-subtabs").hidden = true;
    $("#foot-note").textContent =
      "检索对比只看「池子好不好」。定图与读证据在「⑥ 答题对比」；跨模型译后作答在「⑦ 跨模型翻译」。本页 Visual Token 对应全库 Rel + tok/2；24 题均值 Caption 31.1% → Visual Token 82.3%。";
  }

  function renderAnswerOverall() {
    const s = qaData.overall.locate_summary;
    $("#picker-title").textContent = "答题对比";
    $("#answer-subtabs").hidden = false;
    if (answerSub === "select") {
      $("#overall-stats").innerHTML = `
        <div class="stat caption"><label>Caption 定图准确率</label><strong>${fmtPct(s.caption_locate_acc)}</strong></div>
        <div class="stat token"><label>Visual Token 定图准确率</label><strong>${fmtPct(s.visual_token_locate_acc)}</strong></div>
        <div class="stat"><label>设定</label><strong style="font-size:1.05rem">池已给定</strong></div>`;
      $("#picker-desc").textContent =
        "定图对比：检索已经给出同一候选池后，对比 Caption 与 Visual Token 谁更能从池子里选出正确的那一张，并据此作答。定错图却答对 = 碰巧对。";
      $("#foot-note").textContent =
        "检索 ≠ 定图。检索负责「相关图进不进池」；定图是在池内选唯一图。本页是同模型原生 Visual Token，没有跨模型翻译。";
    } else {
      $("#overall-stats").innerHTML = `
        <div class="stat caption"><label>金标图 + Caption</label><strong>${fmtPct(s.oracle_caption_acc)}</strong></div>
        <div class="stat token"><label>金标图 + Visual Token</label><strong>${fmtPct(s.oracle_visual_acc)}</strong></div>
        <div class="stat"><label>设定</label><strong style="font-size:1.05rem">图已选对</strong></div>`;
      $("#picker-desc").textContent =
        "读证据对比：跳过检索与定图，图已经是正确唯一图。一边只读 Caption 文字，一边用 Visual Token 看图，对比证据形态本身。";
      $("#foot-note").textContent =
        "这里不再比找图/选图，只比「喂给模型的是文字还是视觉 token」。跨模型翻译请看「⑦」。";
    }
  }

  function renderTranslateOverall() {
    const t = packData?.translator;
    const m = t?.metrics || [];
    const cards = m
      .slice(0, 3)
      .map(
        (x) =>
          `<div class="stat"><label>${x.label}</label><strong style="font-size:1.15rem">${x.value}</strong></div>`
      )
      .join("");
    $("#overall-stats").innerHTML =
      cards ||
      `<div class="stat"><label>机制</label><strong style="font-size:1.05rem">8B → 译 → 4B</strong></div>`;
    $("#foot-note").textContent =
      "本页独立于⑥：⑥ 是同模型 Caption vs 原生 Visual Token；这里是跨模型翻译后再作答。列表题只是展示场景，不是与定图并列的第三阶段。";
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
            <span class="c">${q.caption.correct ? "答对" : "答错"}（Caption）</span>
            <span class="t">${q.visual_token.correct ? "答对" : "答错"}（Visual Token）</span>
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
    } else if (target === "pipeline") {
      mode = "pipeline";
      pipelineStep = 0;
    } else if (target === "journey") {
      mode = "journey";
      activeId = null;
      journeyStep = 0;
    } else if (target === "mini") {
      mode = "mini";
      activeId = null;
      miniStep = 0;
    } else if (target === "pack" || target === "multi" || target === "translate" || target === "answer:pack" || target === "answer:multi") {
      mode = "translate";
      activeId = null;
    } else if (target.startsWith("answer:")) {
      mode = "answer";
      const sub = target.split(":")[1] || "select";
      answerSub = sub === "pack" || sub === "multi" ? "select" : sub;
      activeId = null;
    }
    switchMode(mode).then(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function stopPipelinePlay() {
    if (pipelineTimer) {
      clearInterval(pipelineTimer);
      pipelineTimer = null;
    }
  }

  function pipelineFlowHTML(flow) {
    if (!flow || !flow.length) return "";
    return `<div class="pipe-flowline" aria-hidden="true">${flow
      .map((bit) => {
        if (bit === "→" || bit === "↔") return `<span class="pipe-op">${bit}</span>`;
        return `<span class="pipe-node">${bit}</span>`;
      })
      .join("")}</div>`;
  }

  function pipelineSideCard(side, tone) {
    const techItems = (side.tech || [])
      .map((t) => `<li>${t}</li>`)
      .join("");
    const techBlock = techItems
      ? `<details class="pipe-tech">
          <summary>技术细节</summary>
          <ul>${techItems}</ul>
        </details>`
      : "";
    return `
      <article class="pipe-card ${tone}">
        <div class="pipe-card-top">
          <h4>${side.title}</h4>
          <span class="pipe-tag">${side.tag}</span>
        </div>
        ${pipelineFlowHTML(side.flow)}
        <p class="pipe-plain">${side.plain}</p>
        <p class="pipe-detail">${side.detail}</p>
        ${techBlock}
      </article>`;
  }

  function renderPipeline() {
    hideAllStages();
    stopPipelinePlay();
    const d = pipelineData;
    const stages = d.stages || [];
    if (pipelineStep < 0) pipelineStep = 0;
    if (pipelineStep >= stages.length) pipelineStep = stages.length - 1;

    $("#overall-stats").innerHTML = `
      <div class="stat caption"><label>左边一条链</label><strong style="font-size:1.05rem">先写成文字</strong></div>
      <div class="stat token"><label>右边一条链</label><strong style="font-size:1.05rem">尽量直接看图</strong></div>
      <div class="stat"><label>同屏</label><strong>${stages.length} 步从头到尾</strong></div>`;
    $("#foot-note").textContent =
      "方法流程一页看完：从上往下是完整链路；左右是同一时刻的两种做法。";

    const root = $("#pipeline-root");
    root.hidden = false;

    const inputChips = (d.shared_input?.items || [])
      .map((x) => `<span class="pipe-chip">${x}</span>`)
      .join("");

    const chain = stages
      .map((s, i) => {
        const last = i === stages.length - 1;
        return `
        <div class="pipe-stage ${i === pipelineStep ? "is-active" : ""}" id="pipe-stage-${i}" data-pipe-stage="${i}">
          <div class="pipe-stage-band">
            <span class="pipe-stage-n">${i + 1}</span>
            <div class="pipe-stage-copy">
              <h3>${s.title}</h3>
              <p>${s.diff}</p>
            </div>
          </div>
          <div class="pipe-row">
            ${pipelineSideCard(s.caption, "caption")}
            <div class="pipe-mid" aria-hidden="true">
              <div class="pipe-mid-line"></div>
              <div class="pipe-mid-vs">vs</div>
              <div class="pipe-mid-line"></div>
            </div>
            ${pipelineSideCard(s.ours, "token")}
          </div>
          ${last ? "" : `<div class="pipe-chain-arrow" aria-hidden="true"><span></span></div>`}
        </div>`;
      })
      .join("");

    root.innerHTML = `
      <div class="pipe-shell">
        <div class="pipe-intro">
          <h2>${d.title}</h2>
          <p>${d.intro}</p>
        </div>

        <div class="pipe-chain-wrap">
          <div class="pipe-shared">
            <span class="pipe-shared-label">${d.shared_input?.label || "共同输入"}</span>
            <div class="pipe-chips">${inputChips}</div>
          </div>

          <div class="pipe-chain-down" aria-hidden="true"><span></span></div>

          <div class="pipe-heads pipe-heads-sticky" aria-hidden="true">
            <div class="pipe-head caption">只靠文字（Caption）· 左边整条链</div>
            <div class="pipe-head mid">每一步对照</div>
            <div class="pipe-head token">我们的方法（看图）· 右边整条链</div>
          </div>

          <div class="pipe-chain">${chain}</div>

          <div class="pipe-chain-down" aria-hidden="true"><span></span></div>

          <div class="pipe-takeaway">
            <h3>一句话记住</h3>
            <p>${d.takeaway}</p>
            <div class="pipe-ctas">
              <button type="button" class="j-btn primary" data-jump="mini">${d.cta?.mini || "去 Demo"}</button>
              <button type="button" class="j-btn ghost" data-jump="journey">${d.cta?.journey || "去全程逐步"}</button>
            </div>
          </div>
        </div>
      </div>`;

    root.querySelectorAll("[data-pipe-stage]").forEach((el) => {
      el.addEventListener("click", () => {
        pipelineStep = Number(el.dataset.pipeStage);
        root.querySelectorAll(".pipe-stage").forEach((n) => n.classList.toggle("is-active", n === el));
        syncHash();
      });
    });
    root.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", () => jumpFromOverview(btn.dataset.jump));
    });
  }

  function packMiniGrid(items, emptyText) {
    if (!items || !items.length) {
      return `<div class="empty-miss">${emptyText || "无"}</div>`;
    }
    return `<div class="grid pack-grid">${items
      .map(
        (t) => `
      <div class="tile ${t.label === "hit" ? "hit" : "miss"}" title="${t.id}">
        <img src="${thumb(t.id)}" alt="" loading="lazy" />
        <span class="tag">${t.label === "hit" ? "相关" : "噪声/错报"}</span>
      </div>`
      )
      .join("")}</div>`;
  }

  function renderTranslate() {
    hideAllStages();
    const d = packData;
    const t = d.translator || {};
    const cases = d.cases || [];
    if (!cases.some((c) => c.id === activeId)) activeId = cases[0]?.id || null;
    const cur = cases.find((c) => c.id === activeId) || cases[0];

    renderTranslateOverall();

    const root = $("#pack-root");
    root.hidden = false;

    const flowHTML = (t.flow || [])
      .map(
        (step, i) => `
      ${i ? `<span class="xlate-arrow" aria-hidden="true">→</span>` : ""}
      <div class="xlate-node">
        <strong>${step.title}</strong>
        <p>${step.text}</p>
      </div>`
      )
      .join("");

    const metricHTML = (t.metrics || [])
      .map(
        (m) => `
      <div class="xlate-metric">
        <span class="lab">${m.label}</span>
        <b>${m.value}</b>
        <span class="hint">${m.hint || ""}</span>
      </div>`
      )
      .join("");

    const agg = d.aggregates || [];
    const aggCards = agg
      .map((a) => {
        const max = Math.max(a.caption_f1, a.gate_f1, a.oracle_f1, 0.01);
        const bar = (v, cls, label) =>
          `<div class="pack-bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.max(
            4,
            (v / max) * 100
          )}%"></div></div><b>${v.toFixed(2)}</b></div>`;
        return `<div class="pack-agg-card">
          <h3>${a.subset} · ${a.n_list} 道列表题均值</h3>
          ${bar(a.caption_f1, "baseline", "Caption")}
          ${bar(a.gate_f1, "ours", "gate")}
          ${bar(a.oracle_f1, "upper", "oracle")}
          <p class="pack-agg-note">池内金标召回：Caption ${fmtPct(a.caption_recall)} → gate ${fmtPct(a.gate_recall)}</p>
        </div>`;
      })
      .join("");

    const caseBtns = cases
      .map(
        (c) => `
      <button type="button" class="pack-case-btn ${c.id === activeId ? "active" : ""}" data-pack-q="${c.id}">
        <div class="row"><span>${c.subset}</span><span>金标 ${c.n_gold} 张</span></div>
        <div class="title">${c.blurb}</div>
        <div class="scores">
          <span class="c">Cap F1 ${c.arms[0].f1.toFixed(2)}</span>
          <span class="t">gate ${c.arms[1].f1.toFixed(2)}</span>
          <span>oracle ${c.arms[2].f1.toFixed(2)}</span>
        </div>
      </button>`
      )
      .join("");

    const armHTML = (arm) => {
      const tone = arm.kind === "caption" ? "caption" : "token";
      return `
      <article class="panel ${tone}-panel pack-arm">
        <div class="panel-head">
          <div>
            <h3>${arm.name}</h3>
            <p>池召回 ${fmtPct(arm.pool_gold_recall)} · 预测 ${arm.n_pred} 张（命中 ${arm.n_pred_hit} / 错报 ${arm.n_pred_fp}）</p>
          </div>
          <div class="verdict ${arm.f1 >= 0.7 ? "ok" : arm.f1 >= 0.4 ? "warn" : "bad"}">F1 ${arm.f1.toFixed(2)}</div>
        </div>
        <div class="pack-kpis">
          <div class="kpi"><span>精确率</span><b>${fmtPct(arm.precision)}</b></div>
          <div class="kpi"><span>召回率</span><b>${fmtPct(arm.recall)}</b></div>
          <div class="kpi"><span>漏报金标</span><b>${arm.n_gold_miss}</b></div>
          <div class="kpi"><span>池内漏检</span><b>${arm.n_gold_miss_pool}</b></div>
        </div>
        <p class="section-label">模型报出的图（绿=真相关，红=错报）${
          arm.n_pred_hidden ? ` · 另有 ${arm.n_pred_hidden} 张未展示` : ""
        }</p>
        ${packMiniGrid(arm.pred_show, "无预测")}
        ${
          arm.miss_pool_show?.length
            ? `<p class="section-label">检索阶段就漏掉的相关图（示例）</p>${packMiniGrid(arm.miss_pool_show)}`
            : arm.kind === "oracle"
              ? `<p class="mini-note">oracle：相关图默认全部进池；三列都用译后 vis 作答，瓶颈只在看图筛选。</p>`
              : `<p class="mini-note">此例中，金标相关图大多已进候选池；差距更多来自作答筛选。</p>`
        }
      </article>`;
    };

    root.innerHTML = `
      <div class="pack-shell">
        <div class="pack-intro xlate-intro">
          <p class="xlate-kicker">${t.kicker || d.page_title || "跨模型翻译"}</p>
          <h2>${d.title}</h2>
          <p>${d.intro}</p>
          <p class="pack-note">${t.why || ""}</p>
          <p class="pack-note">${t.vs_old || ""}</p>
        </div>
        <div class="xlate-flow" aria-label="翻译流程">${flowHTML}</div>
        <div class="xlate-metrics">${metricHTML}</div>
        <div class="pack-intro">
          <h2>例题：译后看图 · 多图列表</h2>
          <p>${d.note || ""}</p>
        </div>
        <div class="pack-agg">${aggCards}</div>
        <p class="pack-takeaway">${d.takeaway || ""}</p>
        <div class="pack-cases">${caseBtns}</div>
        <div class="pack-active">
          <div class="j-pin-q">
            <div class="j-shared-label">当前列表题 · 金标 ${cur.n_gold} 张</div>
            <h3 class="j-q">${cur.question}</h3>
            <p class="j-meta">${cur.why || ""}</p>
          </div>
          <p class="section-label">金标相关图（展示前 ${cur.arms[2].gold_show.length} 张${
            cur.arms[2].n_gold_hidden ? `，另有 ${cur.arms[2].n_gold_hidden} 张` : ""
          }）</p>
          ${packMiniGrid(cur.arms[2].gold_show)}
          <div class="pack-arms">
            ${cur.arms.map(armHTML).join("")}
          </div>
        </div>
      </div>`;

    root.querySelectorAll("[data-pack-q]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeId = btn.dataset.packQ;
        refresh();
        requestAnimationFrame(() => $("#pack-root")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      });
    });
  }

  function roleClass(role) {
    if (role === "ours") return "ours";
    if (role === "baseline") return "baseline";
    if (role === "upper") return "upper";
    return "mid";
  }

  function ovExplainHTML(block) {
    if (!block) return "";
    const howto = block.howto || "";
    const analysis = block.analysis || block.takeaway || block.note || "";
    if (!howto && !analysis) return "";
    return `
      <div class="ov-explain">
        ${howto ? `<div class="ov-explain-card howto"><h4>我们比了什么</h4><p>${howto}</p></div>` : ""}
        ${analysis ? `<div class="ov-explain-card analysis"><h4>这说明什么（给非技术同学）</h4><p>${analysis}</p></div>` : ""}
      </div>`;
  }

  function renderOverview() {
    const d = overviewData;
    $("#overall-stats").innerHTML = `
      <div class="stat caption"><label>Caption 找图大约</label><strong>只对 3 成</strong></div>
      <div class="stat token"><label>我们的方法找图大约</label><strong>近 6 成起</strong></div>
      <div class="stat"><label>选对关键图</label><strong>0/15 → 15/15</strong></div>`;
    hideAllStages();
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
          <div class="bar-meta">找全约 ${fmtPct(m.pool_recall)} · 排位松紧 ${m.rank_ratio_mean.toFixed(2)} · ${m.sec_per_q}s/题</div>
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
      <tr class="${/我们的方法|看图/.test(m.name) ? "ours" : /Caption|文字/.test(m.name) ? "baseline" : ""}">
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
          <div><span>找全程度 ↑</span><b>${fmtPct(r.pool_recall)}</b></div>
          <div><span>排得越前越好 ↓</span><b>${r.packing.toFixed(2)}</b></div>
          <div><span>大约秒/题</span><b>${r.sec_per_q}</b></div>
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

      <details class="ov-block glossary">
        <summary>
          <span class="gloss-title">${d.glossary.title}</span>
          <span class="gloss-hint">${d.glossary.hint}</span>
        </summary>
        <dl class="gloss-grid">${glossary}</dl>
      </details>

      <div class="ov-block">
        <h2>三条失败路径（Caption 常在这里翻车）</h2>
        <p class="setting">点卡片可看具体例子。想自己点一步看全程，请去「③ 全程逐步」。想先看清两边怎么跑，请去「② 方法流程」。</p>
        <div class="story-grid">${story}</div>
        <div class="pipe-ctas" style="margin-top:0.75rem">
          <button type="button" class="j-btn ghost" data-jump="pipeline">先看方法流程 →</button>
          <button type="button" class="j-btn ghost" data-jump="translate">看跨模型翻译 →</button>
          <button type="button" class="journey-cta" data-jump="journey">去全程逐步对照 →</button>
        </div>
      </div>

      <div class="ov-block">
        <h2>${ladder.name}</h2>
        <p class="setting">${ladder.setting}</p>
        <div class="bar-rows">${bars}</div>
        ${ovExplainHTML(ladder)}
      </div>

      <div class="ov-block">
        <h2>${e150.name}</h2>
        <p class="setting">${e150.setting}</p>
        <table class="ov-table">
          <thead><tr><th>方法</th><th>有用图找进名单的比例 ↑</th><th>排得越前越好（数字↓）</th></tr></thead>
          <tbody>${e150rows}</tbody>
        </table>
        ${ovExplainHTML(e150)}
      </div>

      <div class="ov-block">
        <h2>${loc.name}</h2>
        <p class="setting">${loc.setting}</p>
        <table class="ov-table">
          <thead><tr><th>方法</th><th>选对关键图</th><th>最终答对</th><th>备注</th></tr></thead>
          <tbody>${locRows}</tbody>
        </table>
        ${ovExplainHTML(loc)}
      </div>

      <div class="ov-block">
        <h2>${ora.name}</h2>
        <p class="setting">${ora.setting}</p>
        <div class="dual-bars">
          <div class="dual-item">
            <div class="labs"><span>只读文字描述 · 答对比例</span><span class="c" style="color:var(--caption);font-weight:700">${fmtPct(ora.em_caption)}</span></div>
            <div class="bar-track"><div class="bar-fill baseline" style="width:${ora.em_caption * 100}%"></div></div>
          </div>
          <div class="dual-item">
            <div class="labs"><span>直接看图 · 答对比例</span><span style="color:var(--token);font-weight:700">${fmtPct(ora.em_visual)}</span></div>
            <div class="bar-track"><div class="bar-fill ours" style="width:${ora.em_visual * 100}%"></div></div>
          </div>
        </div>
        <div class="kind-grid">${kinds}</div>
        ${ovExplainHTML(ora)}
      </div>

      <div class="ov-block">
        <h2>${cost.name}</h2>
        <p class="setting">${cost.setting}</p>
        <div class="cost-grid">${costCards}</div>
        ${ovExplainHTML(cost)}
      </div>`;

    root.querySelectorAll("[data-jump]").forEach((btn) => {
      btn.addEventListener("click", () => jumpFromOverview(btn.dataset.jump));
    });

    $("#foot-note").textContent =
      "本页面向非技术读者：用几组对照说明「只靠文字描述」会在找图、选图、读文字答题上连续失手；直接看图更稳，并用门控控制成本。细节例子见「全程逐步」。";
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
          ${cueHTML(side.cues, { withLegend: true })}
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
    const savedY = window.scrollY;

    $("#overall-stats").innerHTML = `
      <div class="stat"><label>当前案例</label><strong style="font-size:1.05rem">${journey.badge}</strong></div>
      <div class="stat token"><label>已展开</label><strong>${journeyStep + 1} / ${steps.length} 步</strong></div>
      <div class="stat caption"><label>操作</label><strong style="font-size:1.05rem">同页向下追加</strong></div>`;
    $("#picker-title").textContent = `选择全程案例（共 ${journeys.length} 道）`;
    $("#picker-desc").textContent =
      `当前共 ${journeys.length} 道预计算案例，请向下滚动题单。题目固定在上方；点「下一步」只在下面追加新内容。`;
    $("#foot-note").textContent =
      `全程逐步共 ${journeys.length} 道案例：同一页从上往下堆叠展开，前面步骤不会被替换掉。`;

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
        journeyShouldScroll = false;
        refresh();
      });
      list.appendChild(btn);
    });

    const stepper = steps
      .map(
        (s, i) => `
      <button type="button" class="j-step ${i === journeyStep ? "current" : i < journeyStep ? "done" : i === journeyStep + 1 ? "nextable" : ""}" data-step="${i}" ${
          i > journeyStep + 1 ? "disabled" : ""
        }>
        <span class="n">${i + 1}</span><span class="t">${s.title}</span>
      </button>`
      )
      .join("");

    // Stack every revealed step on one page (0 .. journeyStep)
    const timeline = steps
      .slice(0, journeyStep + 1)
      .map((s, i) => {
        const isLatest = i === journeyStep;
        return `
        <section class="j-beat${isLatest ? " j-reveal is-latest" : ""}" id="j-beat-${i}" data-beat="${i}">
          <div class="j-beat-rail" aria-hidden="true"></div>
          <div class="j-beat-head">
            <span class="j-beat-n">第 ${i + 1} 步</span>
            <h3>${s.title}</h3>
            <p>${s.narrator || ""}</p>
          </div>
          <div class="j-beat-body">${journeyBeatBody(s, journey)}</div>
        </section>`;
      })
      .join("");

    const lockedHint =
      journeyStep + 1 < steps.length
        ? `<div class="j-locked-hint">未展开：${steps
            .slice(journeyStep + 1)
            .map((s) => s.title)
            .join(" → ")}</div>`
        : `<div class="j-locked-hint done">全部步骤已在本页展开，可向上滚动回顾整条链路。</div>`;

    const root = $("#journey-root");
    root.hidden = false;
    root.innerHTML = `
      <div class="j-shell">
        <div class="j-head">
          <div class="j-badge">${journey.badge}</div>
          <h2>${journey.title}</h2>
          <p class="j-blurb">${journey.blurb}</p>
        </div>

        <div class="j-pin-q">
          <div class="j-shared-label">题目（全程固定可见）</div>
          <h3 class="j-q">${journey.question}</h3>
          <p class="j-meta">标准答案将在最后一步揭晓 · 已展开 ${journeyStep + 1}/${steps.length} 步</p>
        </div>

        <div class="j-stepper" aria-label="进度">${stepper}</div>
        <div class="j-timeline">${timeline}</div>
        ${lockedHint}
        <div class="j-controls">
          <button type="button" class="j-btn ghost" id="j-prev" ${atStart ? "disabled" : ""}>收回一步</button>
          <button type="button" class="j-btn ghost" id="j-reset">从头重来</button>
          <button type="button" class="j-btn primary" id="j-next" ${atEnd ? "disabled" : ""}>${
            atEnd ? "已全部展开" : "下一步（接在下面） →"
          }</button>
        </div>
      </div>`;

    root.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = Number(btn.dataset.step);
        if (target <= journeyStep) {
          document.getElementById(`j-beat-${target}`)?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
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

    // Do not jump the page to hide earlier steps; only nudge if needed
    requestAnimationFrame(() => {
      if (journeyShouldScroll) {
        journeyShouldScroll = false;
        document.getElementById(`j-beat-${journeyStep}`)?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      } else {
        window.scrollTo(0, savedY);
      }
    });
  }


  const TOUR_KEY = "visual-rag-tour-seen-v1";
  let tourIndex = 0;
  let tourTimer = null;
  let tourActive = false;

  const TOUR_STEPS = [
    {
      sel: null,
      title: "30 秒学会怎么用",
      text: "这是一个预计算演示页：选一道题，点「下一步」，同一页从上往下展开 Caption 与 Visual Token 的对照过程。",
      place: "center",
    },
    {
      sel: ".mode-tabs",
      title: "你现在在「全程逐步」",
      text: "默认最直观的是这个 Tab。总览数字、检索网格、答题对比可以稍后再看。",
      place: "bottom",
    },
    {
      sel: "#q-list",
      title: "先选一道案例",
      text: "这里有多道题（定图失败、碰巧对、读 caption 仍错…）。点卡片切换题目，引导会停在当前题上。",
      place: "auto",
      maxHoleH: 180,
    },
    {
      sel: ".j-pin-q",
      title: "题目一直钉在上面",
      text: "展开后面步骤时，问题不会消失。随时能对照「现在在回答什么」。",
      place: "auto",
    },
    {
      sel: "#j-beat-0",
      title: "内容往下堆叠",
      text: "每展开一步，新内容接在下面（不会盖掉上面）。左右两列对照 Caption 与 Visual Token。",
      place: "auto",
      maxHoleH: 220,
    },
    {
      sel: "#j-next",
      title: "点这里继续展开",
      text: "每点一次「下一步」，新内容接在下面出现，不会盖掉上面的步骤。也可以「收回一步 / 从头重来」。",
      place: "auto",
      clickHint: true,
    },
    {
      sel: null,
      title: "可以开始自己点了",
      text: "右下角「怎么用?」随时能重播这段引导。现在选一道题，连点几次下一步看看整条链路吧。",
      place: "center",
    },
  ];

  function stopTourTimer() {
    if (tourTimer) {
      clearTimeout(tourTimer);
      tourTimer = null;
    }
  }

  function endTour(markSeen) {
    stopTourTimer();
    tourActive = false;
    const root = $("#tour-root");
    if (root) {
      root.hidden = true;
      root.classList.remove("is-on");
      root.innerHTML = "";
    }
    if (markSeen) {
      try {
        localStorage.setItem(TOUR_KEY, "1");
      } catch (_) {}
    }
  }

  function positionTourCard(card, holeRect, place) {
    const pad = 14;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top;
    let left;

    const clamp = (t, l) => ({
      top: Math.min(Math.max(pad, t), Math.max(pad, vh - ch - pad)),
      left: Math.min(Math.max(pad, l), Math.max(pad, vw - cw - pad)),
    });

    if (place === "center" || !holeRect) {
      ({ top, left } = clamp((vh - ch) / 2, (vw - cw) / 2));
    } else {
      const spaceBelow = vh - holeRect.bottom;
      const spaceAbove = holeRect.top;
      let prefer = place;
      if (prefer === "auto") {
        prefer = spaceBelow >= ch + 24 || spaceBelow >= spaceAbove ? "bottom" : "top";
      }
      if (prefer === "top" && spaceAbove >= ch + 20) {
        ({ top, left } = clamp(holeRect.top - ch - 16, holeRect.left));
      } else if (prefer === "bottom" && spaceBelow >= ch + 20) {
        ({ top, left } = clamp(holeRect.bottom + 16, holeRect.left));
      } else {
        // Not enough room above/below: park card on the side or center of viewport
        const sideLeft = holeRect.right + 16;
        if (sideLeft + cw + pad <= vw) {
          ({ top, left } = clamp(holeRect.top, sideLeft));
        } else if (holeRect.left - cw - 16 >= pad) {
          ({ top, left } = clamp(holeRect.top, holeRect.left - cw - 16));
        } else {
          ({ top, left } = clamp((vh - ch) / 2, (vw - cw) / 2));
        }
      }
    }
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }

  function clampHoleRect(rect, step) {
    const pad = 8;
    const maxH = step.maxHoleH || Math.min(280, window.innerHeight * 0.42);
    const maxW = step.maxHoleW || window.innerWidth - 24;
    let top = rect.top - pad;
    let left = rect.left - pad;
    let width = rect.width + pad * 2;
    let height = Math.min(rect.height + pad * 2, maxH);
    width = Math.min(width, maxW);
    // keep inside viewport
    top = Math.min(Math.max(6, top), window.innerHeight - height - 6);
    left = Math.min(Math.max(6, left), window.innerWidth - width - 6);
    return { top, left, width, height, bottom: top + height, right: left + width };
  }

  function renderTourStep() {
    const root = $("#tour-root");
    if (!root || !tourActive) return;
    const step = TOUR_STEPS[tourIndex];
    const el = step.sel ? document.querySelector(step.sel) : null;
    if (step.sel && el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    const dots = TOUR_STEPS.map((_, i) => `<i class="${i === tourIndex ? "on" : ""}"></i>`).join("");
    const isLast = tourIndex === TOUR_STEPS.length - 1;

    root.hidden = false;
    root.classList.add("is-on");
    root.innerHTML = `
      <div class="tour-dim" data-tour-skip></div>
      <div class="tour-hole ${step.clickHint ? "is-pulse" : ""}" id="tour-hole"></div>
      <div class="tour-cursor" id="tour-cursor" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0b6e4f" d="M4 3l1.2 14.2 3.5-3.3 3.3 6.4 2.4-1.2-3.4-6.5L17 11.2 4 3z"/></svg>
      </div>
      <div class="tour-card" id="tour-card">
        <div class="tour-progress">${dots}</div>
        <div class="tour-kicker">使用引导 · ${tourIndex + 1}/${TOUR_STEPS.length}</div>
        <h3>${step.title}</h3>
        <p>${step.text}</p>
        <div class="tour-actions">
          <button type="button" class="tour-btn" data-tour-skip>跳过</button>
          <span class="spacer"></span>
          <button type="button" class="tour-btn" data-tour-prev ${tourIndex === 0 ? "disabled" : ""}>上一步</button>
          <button type="button" class="tour-btn primary" data-tour-next>${isLast ? "开始体验" : "下一步"}</button>
        </div>
      </div>`;

    const hole = $("#tour-hole");
    const card = $("#tour-card");
    const cursor = $("#tour-cursor");

    requestAnimationFrame(() => {
      let holeRect = null;
      if (el) {
        const raw = el.getBoundingClientRect();
        holeRect = clampHoleRect(raw, step);
        hole.style.opacity = "1";
        hole.style.top = `${holeRect.top}px`;
        hole.style.left = `${holeRect.left}px`;
        hole.style.width = `${holeRect.width}px`;
        hole.style.height = `${holeRect.height}px`;
        cursor.hidden = false;
        cursor.style.top = `${holeRect.top + Math.min(36, holeRect.height * 0.35)}px`;
        cursor.style.left = `${holeRect.left + Math.min(48, holeRect.width * 0.45)}px`;
        if (step.clickHint) {
          cursor.classList.remove("is-click");
          void cursor.offsetWidth;
          cursor.classList.add("is-click");
        }
      } else {
        hole.style.opacity = "0";
        hole.style.top = "40%";
        hole.style.left = "30%";
        hole.style.width = "40%";
        hole.style.height = "20%";
        cursor.hidden = true;
      }
      positionTourCard(card, holeRect, step.place || "auto");
    });

    root.querySelectorAll("[data-tour-skip]").forEach((b) =>
      b.addEventListener("click", () => endTour(true))
    );
    root.querySelector("[data-tour-prev]")?.addEventListener("click", () => {
      stopTourTimer();
      if (tourIndex > 0) {
        tourIndex -= 1;
        renderTourStep();
        scheduleTourAuto();
      }
    });
    root.querySelector("[data-tour-next]")?.addEventListener("click", () => {
      stopTourTimer();
      if (tourIndex < TOUR_STEPS.length - 1) {
        tourIndex += 1;
        renderTourStep();
        scheduleTourAuto();
      } else {
        endTour(true);
      }
    });
  }

  function scheduleTourAuto() {
    stopTourTimer();
    if (!tourActive) return;
    if (tourIndex >= TOUR_STEPS.length - 1) return;
    tourTimer = setTimeout(() => {
      tourIndex += 1;
      renderTourStep();
      scheduleTourAuto();
    }, 3400);
  }

  function startTour({ auto = true } = {}) {
    // Ensure journey UI is on screen for selectors
    if (mode !== "journey") {
      mode = "journey";
      activeId = null;
      journeyStep = 0;
      refresh();
    }
    stopTourTimer();
    tourActive = true;
    tourIndex = 0;
    // wait a tick for DOM
    requestAnimationFrame(() => {
      renderTourStep();
      if (auto) scheduleTourAuto();
    });
  }

  function maybeAutoStartTour() {
    try {
      if (localStorage.getItem(TOUR_KEY)) return;
    } catch (_) {}
    if (mode !== "journey") return;
    setTimeout(() => startTour({ auto: true }), 600);
  }



  function galleryMap() {
    const map = {};
    (miniData.gallery || []).forEach((g) => {
      map[g.id] = g;
    });
    return map;
  }

  function miniRankGrid(ranks, selectedId, goldId, revealSelected) {
    return `<div class="mini-rank-grid">${ranks
      .map((r, i) => {
        const cls =
          revealSelected && r.id === selectedId
            ? r.id === goldId
              ? "pick-ok"
              : "pick-bad"
            : r.role === "gold"
              ? "is-gold"
              : "";
        const mark =
          revealSelected && r.id === selectedId
            ? r.id === goldId
              ? "选中✓"
              : "选中✗"
            : `#${i + 1}`;
        return `<div class="mini-tile ${cls}" title="${r.id}">
          <img src="${thumb(r.id)}" alt="" loading="lazy" />
          <span class="mini-mark">${mark}</span>
          <span class="mini-score">${Number(r.score).toFixed(2)}</span>
        </div>`;
      })
      .join("")}</div>`;
  }

  function miniPathColumn(q, sideKey, stepKey, gmap) {
    const path = q[sideKey];
    const isCap = sideKey === "caption";
    const title = isCap ? "只靠文字（Caption）" : "我们的方法（看图）";
    const tone = isCap ? "caption" : "token";
    const failHere = isCap && q.fail_step === stepKey;
    const failBanner = failHere
      ? `<div class="mini-fail-banner">⚠ 问题出在这一步：${q.fail_plain}</div>`
      : "";

    let body = "";
    if (stepKey === "ask") {
      body = `<div class="j-shared"><div class="j-shared-label">同一道题</div><h3 class="j-q">${q.question}</h3><p class="j-meta">${q.hint || ""}</p></div>`;
    } else if (stepKey === "gallery") {
      body = `<p class="mini-note">${
        isCap
          ? "Caption 路径：每张图先被写成一段短文字，后面主要靠这些文字找图、答题。"
          : "看图路径：保留视觉特征，后面用「问题和图像有多相关」来打分，不只看文字。"
      }</p>
      <div class="mini-cap-list">${miniData.gallery
        .map((g) => {
          if (isCap) {
            return `<div class="mini-cap-item"><img src="${thumb(g.id)}" alt="" /><div><b>${g.short}</b><p>${g.caption}</p></div></div>`;
          }
          return `<div class="mini-cap-item tokenish"><img src="${thumb(g.id)}" alt="" /><div><b>${g.short}</b><p>保留 visual tokens（示意）：不经文字压缩，细粒度外观仍可用。</p></div></div>`;
        })
        .join("")}</div>`;
    } else if (stepKey === "rank") {
      body = `<p class="mini-note">按与问题的相关程度排序（分数越高越靠前）。</p>${miniRankGrid(
        path.ranks,
        path.selected_id,
        q.gold_id,
        false
      )}`;
    } else if (stepKey === "select") {
      body = `${failBanner}<p class="mini-note">取排序第 1 名作为要看的图。</p>${miniRankGrid(
        path.ranks,
        path.selected_id,
        q.gold_id,
        true
      )}
      <div class="pair-imgs" style="margin-top:0.75rem">
        <div class="slot"><label>该方法选中</label><img src="${thumb(path.selected_id)}" alt="" /></div>
        <div class="slot"><label>标准关键图</label><img src="${thumb(q.gold_id)}" alt="" /></div>
      </div>
      <div class="verdict ${path.selected_ok ? "ok" : "bad"}" style="margin-top:0.55rem">${
        path.selected_ok ? "选对了" : "选错了"
      }</div>`;
    } else if (stepKey === "read") {
      const g = gmap[path.selected_id] || {};
      body = `${failBanner}<div class="pair-imgs">
        <div class="slot"><label>正在读的图</label><img src="${thumb(path.selected_id)}" alt="" /></div>
      </div>
      <p class="section-label" style="margin-top:0.7rem">${isCap ? "模型看到的文字" : "模型使用的证据"}</p>
      <p class="cap-text">${isCap ? g.caption || "" : "同一张图的视觉 token（不依赖上面那段易错文字）。"}</p>
      <p class="mini-note">${path.read_note || ""}</p>
      <div class="j-answer-bubble" style="margin-top:0.55rem">${path.pred_answer}</div>`;
    } else if (stepKey === "verdict") {
      body = `<div class="j-gt"><span>标准答案</span><strong>${q.gt_answer}</strong></div>
      <div class="mini-verdict-line">
        <span>选图 ${path.selected_ok ? "✓" : "✗"}</span>
        <span>答题 ${path.correct ? "✓" : "✗"}</span>
      </div>
      <div class="j-answer-bubble">${path.pred_answer}</div>
      <p class="mini-note">${
        isCap
          ? `Caption 最终答错。关键失误步骤：${failStepLabel(q.fail_step, "long")}。`
          : "我们的方法选对图且答对。"
      }</p>`;
    }

    return `<article class="panel ${tone}-panel mini-col ${failHere ? "is-fail-step" : ""}">
      <div class="panel-head"><div><h3>${title}</h3></div>
        <div class="verdict ${path.correct ? "ok" : "bad"}">${path.correct ? "最终会答对" : "最终会答错"}</div>
      </div>
      ${body}
    </article>`;
  }

  function renderMini() {
    hideAllStages();
    $("#picker-section").hidden = true;
    const root = $("#mini-root");
    root.hidden = false;

    const qs = miniData.questions;
    if (!qs.some((q) => q.id === activeId)) {
      activeId = qs[0].id;
      miniStep = 0;
    }
    const q = qs.find((x) => x.id === activeId);
    const steps = miniData.steps;
    if (miniStep < 0) miniStep = 0;
    if (miniStep >= steps.length) miniStep = steps.length - 1;
    const step = steps[miniStep];
    const gmap = galleryMap();
    const atEnd = miniStep === steps.length - 1;
    const atStart = miniStep === 0;

    $("#overall-stats").innerHTML = `
      <div class="stat"><label>小图库</label><strong>${miniData.gallery.length} 张图</strong></div>
      <div class="stat token"><label>当前题</label><strong style="font-size:1.05rem">${q.label}</strong></div>
      <div class="stat caption"><label>Caption 错在</label><strong style="font-size:1.05rem">${failStepLabel(
        q.fail_step
      )}</strong></div>`;

    $("#foot-note").textContent =
      "小图库例子为示意性预计算轨迹：题更简单、图更少，方便一眼看清 Caption 在哪一步翻车、看图方法如何走通。";

    const qbtns = qs
      .map(
        (item) =>
          `<button type="button" class="mini-q ${item.id === activeId ? "active" : ""}" data-mini-q="${item.id}">${item.label}</button>`
      )
      .join("");

    const gal = miniData.gallery
      .map(
        (g) =>
          `<div class="mini-gal-item"><img src="${thumb(g.id)}" alt="" loading="lazy" /><span>${g.short}</span></div>`
      )
      .join("");

    const stepper = steps
      .map((s, i) => {
        const fail = i <= miniStep && s.key === q.fail_step;
        return `<button type="button" class="j-step ${i === miniStep ? "current" : i < miniStep ? "done" : ""} ${
          fail ? "fail-step" : ""
        }" data-mini-step="${i}" ${i > miniStep + 1 ? "disabled" : ""}>
          <span class="n">${i + 1}</span><span class="t">${s.title}${fail ? " · 翻车点" : ""}</span>
        </button>`;
      })
      .join("");

    // accumulate revealed beats
    const timeline = steps
      .slice(0, miniStep + 1)
      .map((s, i) => {
        const isLatest = i === miniStep;
        const failAt = s.key === q.fail_step;
        return `<section class="j-beat${isLatest ? " j-reveal is-latest" : ""}${failAt ? " mini-beat-fail" : ""}" id="mini-beat-${i}">
          <div class="j-beat-rail" aria-hidden="true"></div>
          <div class="j-beat-head">
            <span class="j-beat-n">第 ${i + 1} 步 · ${s.title}${failAt ? "（Caption 在这步出错）" : ""}</span>
            <h3>${s.title}</h3>
          </div>
          <div class="mini-dual">
            ${miniPathColumn(q, "caption", s.key, gmap)}
            ${miniPathColumn(q, "ours", s.key, gmap)}
          </div>
        </section>`;
      })
      .join("");

    root.innerHTML = `
      <div class="mini-shell">
        <div class="mini-intro">
          <h2>${miniData.title}</h2>
          <p>${miniData.intro}</p>
        </div>
        <div class="mini-gallery-wrap">
          <div class="section-label">本例子的小图库（共 ${miniData.gallery.length} 张）</div>
          <div class="mini-gallery">${gal}</div>
        </div>
        <div class="mini-q-row">${qbtns}</div>
        <div class="j-pin-q">
          <div class="j-shared-label">当前问题</div>
          <h3 class="j-q">${q.question}</h3>
          <p class="j-meta">标准答案：${q.gt_answer} · Caption 会在「${failStepLabel(
            q.fail_step,
            "long"
          )}」这一步出问题</p>
        </div>
        <div class="j-stepper">${stepper}</div>
        <div class="j-timeline">${timeline}</div>
        <div class="j-controls">
          <button type="button" class="j-btn ghost" id="mini-prev" ${atStart ? "disabled" : ""}>收回一步</button>
          <button type="button" class="j-btn ghost" id="mini-reset">从头重来</button>
          <button type="button" class="j-btn primary" id="mini-next" ${atEnd ? "disabled" : ""}>${
            atEnd ? "已全部展开" : "下一步（左右一起推进） →"
          }</button>
        </div>
      </div>`;

    root.querySelectorAll("[data-mini-q]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeId = btn.dataset.miniQ;
        miniStep = 0;
        refresh();
      });
    });
    root.querySelectorAll("[data-mini-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = Number(btn.dataset.miniStep);
        if (t <= miniStep) {
          document.getElementById(`mini-beat-${t}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else if (t === miniStep + 1) {
          miniStep = t;
          refresh();
          requestAnimationFrame(() =>
            document.getElementById(`mini-beat-${miniStep}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
          );
        }
      });
    });
    $("#mini-prev")?.addEventListener("click", () => {
      if (miniStep > 0) {
        miniStep -= 1;
        refresh();
      }
    });
    $("#mini-reset")?.addEventListener("click", () => {
      miniStep = 0;
      refresh();
    });
    $("#mini-next")?.addEventListener("click", () => {
      if (miniStep < steps.length - 1) {
        miniStep += 1;
        refresh();
        requestAnimationFrame(() =>
          document.getElementById(`mini-beat-${miniStep}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        );
      }
    });
  }


  function syncHash() {
    const parts = [`mode=${mode}`];
    if (mode === "answer") parts.push(`sub=${answerSub}`);
    if (mode === "journey") parts.push(`step=${journeyStep}`);
    if (mode === "mini") parts.push(`step=${miniStep}`);
    if (mode === "pipeline") parts.push(`step=${pipelineStep}`);
    if (mode !== "overview" && mode !== "pipeline" && activeId) {
      parts.push(`q=${encodeURIComponent(activeId)}`);
    }
    history.replaceState(null, "", `#${parts.join("&")}`);
  }

  function parseHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return;
    const map = {};
    raw.split("&").forEach((kv) => {
      if (!kv) return;
      const eq = kv.indexOf("=");
      const k = eq >= 0 ? kv.slice(0, eq) : kv;
      const v = eq >= 0 ? kv.slice(eq + 1) : "";
      try {
        map[k] = decodeURIComponent(v || "");
      } catch (_) {
        map[k] = v || "";
      }
    });
    if (
      map.mode === "overview" ||
      map.mode === "journey" ||
      map.mode === "retrieve" ||
      map.mode === "answer" ||
      map.mode === "mini" ||
      map.mode === "pipeline" ||
      map.mode === "pack" ||
      map.mode === "translate"
    ) {
      // 旧链接 #mode=pack / answer&sub=multi → 跨模型翻译页
      if (map.mode === "pack") {
        mode = "translate";
      } else if (map.mode === "answer" && (map.sub === "multi" || map.sub === "pack")) {
        mode = "translate";
      } else {
        mode = map.mode;
      }
    }
    if (map.sub === "select" || map.sub === "read") {
      answerSub = map.sub;
    }
    if (map.sub === "locate" || map.sub === "list") answerSub = "select";
    if (map.q) activeId = map.q;
    if (map.step != null && map.step !== "") {
      const n = Math.max(0, Number(map.step) || 0);
      if (mode === "mini") miniStep = n;
      else if (mode === "pipeline") pipelineStep = n;
      else journeyStep = n;
    }
  }

  function showLoadError(err) {
    console.error(err);
    $("#overall-stats").innerHTML = `
      <div class="stat"><label>加载失败</label><strong style="font-size:1rem">${err.message || err}</strong></div>
      <div class="stat"><label>下一步</label><strong style="font-size:1rem"><button type="button" class="j-btn primary" id="reload-demo" style="margin:0">重试加载</button></strong></div>`;
    $("#reload-demo")?.addEventListener("click", () => {
      location.reload();
    });
  }

  async function switchMode(nextMode) {
    stopPipelinePlay();
    mode = nextMode;
    activeId = null;
    journeyStep = 0;
    miniStep = 0;
    if (nextMode === "pipeline") pipelineStep = 0;
    endTour(false);
    try {
      $("#overall-stats").innerHTML = `<div class="stat"><label>加载中</label><strong style="font-size:1rem">正在准备该页数据…</strong></div>`;
      await ensureModeData(mode);
      refresh();
    } catch (err) {
      showLoadError(err);
    }
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

    if (overviewData) renderPitch();
    const pitchRoot = $("#pitch-root");
    if (pitchRoot) pitchRoot.hidden = mode !== "mini";

    if (mode === "mini") {
      renderMini();
    } else if (mode === "pipeline") {
      renderPipeline();
    } else if (mode === "overview") {
      renderOverview();
    } else if (mode === "journey") {
      renderJourney();
    } else if (mode === "retrieve") {
      hideAllStages();
      $("#picker-section").hidden = false;
      $("#q-list").hidden = false;
      renderRetrieveOverall();
      const qs = retrieveData.questions;
      if (!qs.some((q) => q.id === activeId)) activeId = qs[0].id;
      renderRetrievePicker((id) => {
        activeId = id;
        refresh();
      });
      renderRetrieveQuestion(qs.find((q) => q.id === activeId));
    } else if (mode === "translate") {
      renderTranslate();
    } else if (mode === "answer") {
      if (answerSub !== "select" && answerSub !== "read") {
        mode = "translate";
        renderTranslate();
        syncHash();
        return;
      }
      hideAllStages();
      $("#picker-section").hidden = false;
      $("#q-list").hidden = false;
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

  /** 纠正旧缓存 HTML（曾有「单图定图/多图检索」三子页、缺少⑦） */
  function ensureNavShell() {
    const tabs = document.querySelector(".mode-tabs");
    if (tabs && !tabs.querySelector('[data-mode="translate"]')) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mode-tab";
      btn.dataset.mode = "translate";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", "false");
      btn.textContent = "⑦ 跨模型翻译";
      tabs.appendChild(btn);
    }
    const sub = $("#answer-subtabs");
    if (sub) {
      sub.innerHTML = `
        <button type="button" class="subtab active" data-sub="select">A. 定图对比</button>
        <button type="button" class="subtab" data-sub="read">B. 读证据对比</button>`;
    }
  }

  function bindNavOnce() {
    document.querySelectorAll(".mode-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchMode(btn.dataset.mode);
      });
    });
    document.querySelectorAll(".subtab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const sub = btn.dataset.sub;
        // 旧缓存若仍点到 multi/pack，改走翻译页，避免落到「读证据」数据
        if (sub === "multi" || sub === "pack") {
          await switchMode("translate");
          return;
        }
        answerSub = sub === "read" ? "read" : "select";
        activeId = null;
        try {
          await ensureModeData("answer");
          refresh();
        } catch (err) {
          showLoadError(err);
        }
      });
    });
  }

  async function main() {
    ensureNavShell();
    parseHash();
    if (answerSub !== "select" && answerSub !== "read") {
      mode = "translate";
      answerSub = "select";
    }
    $("#overall-stats").innerHTML = `<div class="stat"><label>加载中</label><strong style="font-size:1rem">正在加载 Demo…</strong></div>`;
    await ensureModeData(mode);

    bindNavOnce();
    $("#tour-help")?.addEventListener("click", async () => {
      try {
        await ensureModeData("journey");
        startTour({ auto: true });
      } catch (err) {
        showLoadError(err);
      }
    });

    refresh();
    maybeAutoStartTour();
    prefetchRemainingData();
  }

  main().catch(showLoadError);
})();
