// 관계도(우주 보기). 업체와 발주기관을 별처럼 3차원 공간에 띄우고, 수주·참여·컨소시엄을 선으로 잇는다.
//   const g = await openGalaxy(el, { companies, results })
//   g.focus('c:사업자번호' | 'o:기관명'), g.pause(), g.resume()

import ForceGraph3D from 'https://cdn.jsdelivr.net/npm/3d-force-graph@1.80.2/+esm';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.187.0/+esm';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (n) => String(n || '').replace(/주식회사|\(주\)|㈜|유한회사|\(유\)/g, '').trim();
const eok = (n) => (!n ? '-' : n >= 1e8 ? (n / 1e8).toFixed(n >= 1e10 ? 0 : 1) + '억' : Math.round(n / 1e4).toLocaleString('ko-KR') + '만');
const scoreOf = (c) => c.stats.wins * 3 + Math.log10(1 + c.stats.wonAmount / 1e7) * 2 + c.stats.bids * 0.5;
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const idOf = (x) => (typeof x === 'object' ? x.id : x);

// 우주는 테마와 상관없이 늘 어둡다.
const C = { org: '#ffc857', won: '#5aa9ff', plain: '#8f9bb3', partner: '#ff5c8a', label: '#e8ecf4', labelDim: '#aab3c5' };
const LINK = {
  win: (on) => `rgba(90,169,255,${on ? 0.6 : 0.03})`,
  bid: (on) => `rgba(170,182,205,${on ? 0.16 : 0.015})`,
  partner: (on) => `rgba(255,92,138,${on ? 0.95 : 0.05})`,
  rival: (on) => `rgba(255,255,255,${on ? 0.1 : 0.01})`,
};
const SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

// ---------- 데이터 → 별과 선 ----------
function build(companies, results) {
  const byBiz = new Map(companies.map((c) => [c.bizno, c]));
  const max = Math.max(1, ...companies.map(scoreOf));
  const nodes = new Map();
  for (const c of companies) {
    nodes.set('c:' + c.bizno, { id: 'c:' + c.bizno, type: 'co', name: short(c.name), c, won: c.stats.wins > 0, r: 2.2 + 6 * Math.sqrt(scoreOf(c) / max) });
  }
  const orgs = new Map();
  const ol = new Map();
  for (const r of results) {
    if (!r.org) continue;
    const o = orgs.get(r.org) || { name: r.org, n: 0, amt: 0, notices: [] };
    o.n++; o.amt += r.amount || 0; o.notices.push(r);
    orgs.set(r.org, o);
    const members = r.contract?.members?.length ? r.contract.members : r.winner ? [{ ...r.winner, share: 100 }] : [];
    const total = r.contract?.amount || r.winner?.amount || 0;
    const winners = new Map();
    for (const m of members) if (m.bizno) winners.set(m.bizno, (total * (m.share ?? 100)) / 100);
    for (const b of new Set([...winners.keys(), ...(r.bidders || []).map((x) => x.bizno)])) {
      if (!byBiz.has(b)) continue;
      const k = r.org + '|' + b;
      const e = ol.get(k) || { org: r.org, bizno: b, win: 0, bid: 0, amt: 0 };
      e.bid++;
      if (winners.has(b)) { e.win++; e.amt += winners.get(b); }
      ol.set(k, e);
    }
  }
  const links = [];
  const linkedOrgs = new Set();
  for (const e of ol.values()) {
    linkedOrgs.add(e.org);
    links.push({ source: 'o:' + e.org, target: 'c:' + e.bizno, kind: e.win ? 'win' : 'bid', count: e.win || e.bid, bids: e.bid, amt: e.amt });
  }
  const maxOrgN = Math.max(1, ...[...orgs.values()].map((o) => o.n));
  for (const o of orgs.values()) {
    if (!linkedOrgs.has(o.name)) continue; // 아무도 응찰하지 않은 기관은 이을 선이 없어 뺀다
    nodes.set('o:' + o.name, { id: 'o:' + o.name, type: 'org', name: o.name, o, r: 2.6 + 7 * Math.sqrt(o.n / maxOrgN) });
  }
  const seen = new Set();
  for (const c of companies) {
    for (const [list, kind] of [[c.partners, 'partner'], [c.rivals, 'rival']]) {
      for (const p of list || []) {
        const k = pairKey(c.bizno, p.bizno) + kind;
        if (!byBiz.has(p.bizno) || seen.has(k)) continue;
        seen.add(k);
        links.push({ source: 'c:' + c.bizno, target: 'c:' + p.bizno, kind, count: p.count, share: p.share });
      }
    }
  }
  return { nodes, links, hiddenOrgs: orgs.size - linkedOrgs.size };
}

// ---------- 별 모양 ----------
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return (glowTex = new THREE.CanvasTexture(cv));
}
const SPHERE = new THREE.SphereGeometry(1, 14, 10);
function starObject(n) {
  const color = n.type === 'org' ? C.org : n.won ? C.won : C.plain;
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(SPHERE, new THREE.MeshBasicMaterial({ color, transparent: true }));
  mesh.scale.setScalar(n.r);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(n.r * (n.type === 'org' ? 6 : n.won ? 5 : 3.2));
  glow.raycast = () => {};
  g.add(glow, mesh);
  n.g3 = { mesh, glow, glowSize: glow.scale.x };
  return g;
}
function starfield() {
  const group = new THREE.Group();
  const tints = [[0.62, 0.7, 0.9], [0.95, 0.95, 1], [1, 0.86, 0.7], [0.7, 0.85, 1]];
  for (const [N, size, opacity] of [[2600, 1.3, 0.55], [260, 2.4, 0.85]]) {
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 1500 + Math.random() * 2600, t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(p) * Math.cos(t); pos[i * 3 + 1] = r * Math.sin(p) * Math.sin(t); pos[i * 3 + 2] = r * Math.cos(p);
      const c = tints[(Math.random() * tints.length) | 0], k = 0.5 + Math.random() * 0.5;
      col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity, depthWrite: false }));
    pts.raycast = () => {};
    group.add(pts);
  }
  // 성운: 크고 옅은 색 구름 몇 덩이를 별 무리 사이와 뒤에 둔다
  // 화면을 덮는 반투명 구름은 겹칠수록 그리기가 무거워져서 몇 덩이만 둔다
  const clouds = [['#3f5efb', 520, 0.05], ['#ff5c8a', 460, 0.035], ['#8b5cf6', 560, 0.045], ['#3f5efb', 1500, 0.02]];
  clouds.forEach(([color, size, opacity], i) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    const far = i >= 3, r = far ? 1200 : 120 + Math.random() * 160, t = (i / 3) * Math.PI * 2 + 0.6, y = (Math.random() - 0.5) * (far ? 900 : 220);
    sp.position.set(r * Math.cos(t), y, r * Math.sin(t));
    sp.scale.setScalar(size * (far ? 1 : 1.6));
    sp.raycast = () => {};
    group.add(sp);
  });
  return group;
}

// ---------- 화면 ----------
export async function openGalaxy(el, { companies, results }) {
  const { nodes: nodeMap, links: allLinks, hiddenOrgs } = build(companies, results);
  // 처음에는 읽기 쉬운 쪽으로: 수주 관계만, 평면(지도처럼 끌어서 이동)
  const st = { mode: 'win', flat: true, rival: false, sel: null, hov: null };
  const Z = (n) => (st.flat ? 0 : n.z || 0);
  let nbr = new Map(), shown = [], adj = new Map(), linkN = 0;
  // 한 화면에 띄우는 별 수의 위쪽 한계. 넘으면 규모가 큰 별부터 남긴다(데이터가 몇 년치 쌓여도 버티게).
  const MAX_STARS = 300;
  const forced = new Set(); // 목록·검색에서 골라 한계 밖인데도 띄운 별
  let adjAll = new Map(), shownIds = new Set();
  // 그리기 품질: 2 = 빛 번짐까지, 1 = 빛 번짐 끔, 0 = 흐르는 빛·곡선도 끄고 해상도도 낮춤. 느리면 스스로 내린다.
  let quality = 2, manualFx = false, bloom = null, paused = false, cooling = true;

  el.innerHTML = `
    <div class="gx-canvas"></div>
    <div class="gx-labels" aria-hidden="true"></div>
    <div class="gx-top">
      <div class="gx-search">${SEARCH}<input type="search" placeholder="회사·기관 이름으로 찾아가기" aria-label="관계도에서 찾기" autocomplete="off"><div class="gx-sug" hidden></div></div>
      <div class="gx-tools">
        <div class="gx-seg" role="group" aria-label="보기 범위"><button data-mode="win" aria-pressed="true">수주 관계만</button><button data-mode="all" aria-pressed="false">참여까지</button></div>
        <div class="gx-seg" role="group" aria-label="배치"><button data-dim="flat" aria-pressed="true">평면</button><button data-dim="3d" aria-pressed="false">입체</button></div>
        <button class="gx-btn" data-rival aria-pressed="false">경쟁선</button>
        <button class="gx-btn" data-side aria-pressed="false">순위</button>
        <button class="gx-btn" data-fx aria-pressed="true" title="빛 번짐·흐르는 빛 같은 꾸밈 효과. 느리면 꺼 보세요.">효과</button>
        <button class="gx-btn" data-fit>전체 보기</button>
      </div>
    </div>
    <div class="gx-legend">
      <span><i class="dot" style="background:${C.org}"></i>발주기관</span>
      <span><i class="dot" style="background:${C.won}"></i>수주한 업체</span>
      <span><i class="dot" style="background:${C.plain}"></i>참여만 한 업체</span>
      <span><i class="ln" style="background:${C.won}"></i>수주</span>
      <span><i class="ln" style="background:${C.partner}"></i>컨소시엄</span>
      <span><i class="ln" style="background:rgba(170,182,205,.5)"></i>참여</span>
      <span class="gx-count"></span>
    </div>
    <div class="gx-hint"></div>
    <aside class="gx-side"></aside>
    <aside class="gx-panel" hidden></aside>`;
  const q = (s) => el.querySelector(s);
  const box = q('.gx-canvas'), panel = q('.gx-panel'), input = q('.gx-search input'), sug = q('.gx-sug');

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Graph = new ForceGraph3D(box, { controlType: 'orbit' })
    .backgroundColor('#04050b')
    .showNavInfo(false)
    .enableNodeDrag(false)
    .nodeThreeObject(starObject)
    .nodeLabel((n) => (n.type === 'org'
      ? `<div class="gx-tip"><b>${esc(n.name)}</b><span>발주기관 · 공고 ${n.o.n}건 · ${eok(n.o.amt)}</span></div>`
      : `<div class="gx-tip"><b>${esc(n.c.name)}</b><span>참여 ${n.c.stats.bids} · 수주 ${n.c.stats.wins}${n.c.stats.wonAmount ? ' · ' + eok(n.c.stats.wonAmount) : ''}</span></div>`))
    .linkOpacity(1)
    .linkColor((l) => LINK[l.kind](isOn(l)))
    .linkWidth((l) => (l.kind === 'partner' ? 0.7 : l.kind === 'win' && active() && isOn(l) ? 0.5 : 0))
    .linkCurvature((l) => (l.kind === 'rival' || quality === 0 || linkN > 600 ? 0 : 0.16))
    .linkCurveRotation((l) => l.rot)
    .linkDirectionalParticles((l) => (l.kind !== 'win' || calm || quality === 0 ? 0 : !active() ? (linkN > 400 ? 0 : 1) : isOn(l) ? Math.min(5, 2 + l.count) : 0))
    .linkDirectionalParticleWidth((l) => (active() ? 1.6 : 1))
    .linkDirectionalParticleSpeed((l) => l.speed)
    .linkDirectionalParticleColor(() => '#bfe0ff')
    .warmupTicks(90)
    .cooldownTicks(160)
    .onNodeHover((n) => { st.hov = n || null; box.style.cursor = n ? 'pointer' : ''; })
    .onNodeClick((n) => select(n))
    .onBackgroundClick(() => select(null));

  Graph.d3Force('link')
    .distance((l) => ({ partner: 16, win: 34, bid: 58, rival: 90 }[l.kind] * (st.flat ? 1.7 : 1) * (l.kind === 'partner' ? 1 : 1 + Math.sqrt(l.deg || 1) / 3)))
    .strength((l) => ({ partner: 0.9, win: 0.55, bid: 0.14, rival: 0.01 }[l.kind]));
  Graph.d3Force('charge').strength(() => (st.flat ? -210 : -80));
  // 서로 이어지지 않은 무리가 멀리 흩어지지 않게 가운데로 살짝 당긴다.
  let simNodes = [];
  const gravity = (alpha) => { const g = (st.flat ? 0.02 : 0.035) * alpha; for (const n of simNodes) { n.vx -= n.x * g; n.vy -= n.y * g; if (n.z != null) n.vz -= n.z * g; } };
  gravity.initialize = (ns) => { simNodes = ns; };
  Graph.d3Force('gravity', gravity);
  Graph.scene().add(starfield());
  // 밝은 것만 은은하게 번지게 한다. 불러오지 못하면 없이 그린다.
  try {
    const { UnrealBloomPass } = await import('https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm');
    bloom = new UnrealBloomPass(new THREE.Vector2(box.clientWidth || 800, box.clientHeight || 600), 0.55, 0.5, 0.35);
  } catch (e) { console.warn('빛 번짐 효과를 불러오지 못했어요', e); }
  let bloomOn = false;
  function setQuality(v) {
    quality = v;
    const composer = Graph.postProcessingComposer();
    if (bloom && (v === 2) !== bloomOn) { bloomOn = v === 2; bloomOn ? composer.addPass(bloom) : composer.removePass(bloom); }
    // 고해상도 화면은 그릴 점이 4배라 가장 큰 부담이다. 1.5배까지만 쓰고, 가장 낮은 품질에서는 1배.
    const pr = v === 0 ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    Graph.renderer().setPixelRatio(pr);
    composer.setPixelRatio?.(pr);
    const w = box.clientWidth, h = box.clientHeight;
    if (w && h) { Graph.renderer().setSize(w, h); composer.setSize(w, h); }
    Graph.linkCurvature(Graph.linkCurvature()).linkDirectionalParticles(Graph.linkDirectionalParticles());
    const b = q('[data-fx]');
    b.setAttribute('aria-pressed', v === 2);
    b.textContent = v === 2 ? '효과' : v === 1 ? '효과 줄임' : '효과 끔';
  }
  setQuality(calm ? 1 : 2);
  // 멀리서 날아 들어오며 시작한다
  if (!calm) Graph.cameraPosition({ x: 0, y: 0, z: 1900 });
  Graph.numDimensions(2);

  const controls = Graph.controls();
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;
  const hint = q('.gx-hint');
  function syncControls() {
    controls.enableRotate = !st.flat;
    controls.mouseButtons.LEFT = st.flat ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = st.flat ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.screenSpacePanning = true;
    controls.autoRotate = !st.flat && !calm && !st.sel;
    hint.textContent = st.flat ? '끌어서 이동 · 휠로 확대 · 별을 누르면 누구와 이어졌는지 보여요' : '끌어서 돌리기 · 휠로 확대 · 별을 누르면 그쪽으로 날아가요';
  }
  syncControls();
  const stopSpin = () => { controls.autoRotate = false; hint.classList.add('off'); };
  // 10초 동안 아무것도 안 하면 그리기를 멈추고(노트북 발열·배터리), 다시 움직이면 이어 그린다.
  let idleT = 0, fpsFrom = 0, fpsN = 0;
  function poke() {
    if (paused) { paused = false; Graph.resumeAnimation(); fpsFrom = 0; }
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      // 자리 잡는 중이거나 처음 화면을 맞추기 전이면 멈추지 않고 조금 뒤에 다시 본다
      if (cooling || !fitted) return poke();
      if (!controls.autoRotate && !el.hidden) { paused = true; Graph.pauseAnimation(); }
    }, 10000);
  }
  for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart']) el.addEventListener(ev, poke, { passive: true });
  box.addEventListener('pointerdown', stopSpin);
  box.addEventListener('wheel', stopSpin, { passive: true });

  function active() { return st.sel; }
  function isOn(l) {
    const a = active();
    return !a || idOf(l.source) === a.id || idOf(l.target) === a.id;
  }

  // 지금 보기 범위에 맞는 별과 선을 넣는다. 별은 그대로 써서 자리가 유지된다.
  function apply() {
    const links = allLinks.filter((l) => (l.kind === 'rival' ? st.rival : st.mode === 'all' || l.kind !== 'bid'));
    const ids = new Set();
    for (const l of links) if (l.kind !== 'rival') { ids.add(idOf(l.source)); ids.add(idOf(l.target)); }
    shown = [...ids].map((id) => nodeMap.get(id)).filter(Boolean);
    // 옆 패널은 화면에 안 띄운 별까지 포함한 전체 관계로 채운다
    adjAll = new Map();
    for (const l of links) {
      const a = idOf(l.source), b = idOf(l.target);
      if (!ids.has(a) || !ids.has(b)) continue;
      (adjAll.get(a) || adjAll.set(a, []).get(a)).push({ id: b, l });
      (adjAll.get(b) || adjAll.set(b, []).get(b)).push({ id: a, l });
    }
    const total = shown.length;
    if (total > MAX_STARS) {
      const keep = new Set(shown.sort((a, b) => b.r - a.r).slice(0, MAX_STARS));
      for (const n of shown) if (forced.has(n.id) || n === st.sel) keep.add(n);
      shown = [...keep];
      ids.clear();
      for (const n of shown) ids.add(n.id);
    }
    shownIds = ids;
    const use = links.filter((l) => ids.has(idOf(l.source)) && ids.has(idOf(l.target))).map((l) => ({ ...l, source: idOf(l.source), target: idOf(l.target), rot: Math.random() * Math.PI * 2, speed: 0.003 + Math.random() * 0.004 }));
    nbr = new Map(shown.map((n) => [n.id, new Set()]));
    adj = new Map(shown.map((n) => [n.id, []]));
    for (const l of use) {
      nbr.get(l.source).add(l.target); nbr.get(l.target).add(l.source);
      adj.get(l.source).push({ id: l.target, l }); adj.get(l.target).push({ id: l.source, l });
    }
    if (st.sel && !ids.has(st.sel.id)) { st.sel = null; drawPanel(); }
    linkN = use.length;
    const deg = new Map();
    for (const l of use) { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1); }
    for (const l of use) l.deg = Math.max(deg.get(l.source), deg.get(l.target));
    cooling = true;
    const fresh = shown.filter((n) => !n.lb);
    for (const n of fresh) makeLabel(n);
    for (const n of fresh) { n.lw = n.lb.offsetWidth; n.lh = n.lb.offsetHeight; }
    Graph.graphData({ nodes: shown, links: use });
    q('.gx-count').textContent = `별 ${shown.length}개 · 선 ${use.length}개${total > MAX_STARS ? ` · 규모가 큰 ${MAX_STARS}개만 보여요(전체 ${total}개)` : hiddenOrgs ? ` · 응찰 없던 기관 ${hiddenOrgs}곳은 빠졌어요` : ''}`;
    poke();
    paint();
  }

  // 고른(또는 마우스를 올린) 별과 이웃만 밝게
  function paint() {
    const a = active(), set = a ? nbr.get(a.id) : null;
    for (const n of shown) {
      if (!n.g3) continue;
      const on = !a || n === a || set?.has(n.id);
      n.g3.mesh.material.opacity = on ? 1 : 0.06;
      n.g3.glow.visible = on;
      n.g3.glow.material.opacity = n === a ? 0.8 : 0.22;
      n.g3.glow.scale.setScalar(n.g3.glowSize * (n === a ? 1.7 : 1));
    }
    Graph.linkColor(Graph.linkColor()).linkWidth(Graph.linkWidth()).linkDirectionalParticles(Graph.linkDirectionalParticles());
    annotate();
    labels();
  }
  // 이름표: 화면에서 서로 겹치지 않는 것만 보인다. 큰 별과 가까운 별이 먼저 자리를 잡아서,
  // 멀리서는 굵직한 이름만, 다가가면 주변 이름이 차례로 나타난다. 고른 별이 있으면 그 별과 이웃만.
  const layer = q('.gx-labels');
  function makeLabel(n) {
    const d = document.createElement('div');
    d.className = 'gx-lb ' + (n.type === 'org' ? 'org' : n.won ? 'won' : '') + (n.r > 6 ? ' big' : '');
    d.textContent = n.name.length > 16 ? n.name.slice(0, 16) + '…' : n.name;
    d.dataset.id = n.id;
    layer.appendChild(d);
    n.lb = d;
  }
  const baseText = (n) => (n.name.length > 16 ? n.name.slice(0, 16) + '…' : n.name);
  const relText = (l) => (l.kind === 'win' ? (l.amt ? eok(l.amt) : l.count + '건') + ' 수주' : l.kind === 'bid' ? '참여 ' + l.count + '번' : l.kind === 'partner' ? '컨소시엄 ' + l.count + '건' : '경쟁 ' + l.count + '번');
  let noted = [];
  function annotate() {
    for (const n of noted) { n.lb.textContent = baseText(n); n.lb.classList.remove('rel'); n.lw = n.lb.offsetWidth; }
    noted = [];
    const a = st.sel;
    if (!a) return;
    const rank = { partner: 0, win: 1, bid: 2, rival: 3 }, best = new Map();
    for (const x of adj.get(a.id) || []) if (!best.has(x.id) || rank[x.l.kind] < rank[best.get(x.id).kind]) best.set(x.id, x.l);
    for (const [id, l] of best) {
      const n = nodeMap.get(id);
      if (!n?.lb) continue;
      n.lb.innerHTML = `${esc(baseText(n))}<em class="${l.kind}">${esc(relText(l))}</em>`;
      n.lb.classList.add('rel');
      n.lw = n.lb.offsetWidth;
      noted.push(n);
    }
  }
  const v3 = new THREE.Vector3();
  let placed = [];
  // 별의 화면 자리. 카메라 뒤나 화면 밖이면 null.
  function screen(n, cam, W, H, K) {
    if (n.x == null) return null;
    v3.set(n.x, n.y, Z(n)).project(cam);
    if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) return null;
    const d = Math.hypot(n.x - cam.position.x, n.y - cam.position.y, Z(n) - cam.position.z) || 1;
    return { x: ((v3.x + 1) / 2) * W, y: ((1 - v3.y) / 2) * H + (n.r * K) / d + 3, d };
  }
  function labels() {
    const a = active(), set = a ? nbr.get(a.id) : null;
    const cam = Graph.camera(), W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const K = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const cand = [];
    for (const n of shown) {
      if (a && n !== a && !set?.has(n.id)) continue;
      const p = screen(n, cam, W, H, K);
      if (!p) continue;
      cand.push({ n, x0: p.x - n.lw / 2 - 4, x1: p.x + n.lw / 2 + 4, y0: p.y - 2, y1: p.y + n.lh + 2, pr: (n === a ? 1e6 : n === st.hov ? 1e5 : 0) + n.r + 500 / p.d });
    }
    cand.sort((p, q2) => q2.pr - p.pr);
    const next = [];
    for (const c of cand) {
      if (next.length >= (a ? 40 : 48)) break;
      if (next.some((p) => c.x0 < p.x1 && c.x1 > p.x0 && c.y0 < p.y1 && c.y1 > p.y0)) continue;
      next.push(c);
    }
    const keep = new Set(next.map((c) => c.n));
    for (const n of placed) if (!keep.has(n)) n.lb.classList.remove('on');
    placed = [...keep];
    for (const n of placed) { n.lb.classList.add('on'); n.lb.classList.toggle('sel', n === a); }
    move();
  }
  // 매 프레임: 보이는 이름표를 별 아래에 붙여 둔다
  function move() {
    const cam = Graph.camera(), W = box.clientWidth, H = box.clientHeight;
    const K = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (const n of placed) {
      const p = screen(n, cam, W, H, K);
      if (!p) { n.lb.classList.remove('on'); continue; }
      n.lb.style.transform = `translate(${Math.round(p.x - n.lw / 2)}px, ${Math.round(p.y)}px)`;
    }
  }
  layer.addEventListener('click', (e) => { const d = e.target.closest('.gx-lb.on'); if (d) select(nodeMap.get(d.dataset.id)); });
  let last = 0, raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (paused || el.hidden || !el.offsetParent) return;
    // 어느 이름표를 보일지는 0.15초마다 다시 고르고(프레임이 느려도 같은 간격), 그 사이에는 자리만 옮긴다
    const now = performance.now();
    if (now - last > 150) { last = now; labels(); } else move();
    // 자리 잡기가 끝난 뒤 2초씩 재서 초당 30장이 안 나오면 효과를 한 단계 내린다
    if (cooling || manualFx || quality === 0 || document.hidden) { fpsFrom = 0; return; }
    if (!fpsFrom) { fpsFrom = now; fpsN = 0; return; }
    fpsN++;
    if (now - fpsFrom >= 2000) {
      const fps = (fpsN * 1000) / (now - fpsFrom);
      fpsFrom = 0;
      if (fps < 30) setQuality(quality - 1);
    }
  };
  loop();

  function flyTo(n, ms = 1100) {
    // 이웃이 한 화면에 들어올 만큼 물러서서 본다
    let reach = 0;
    for (const id of nbr.get(n.id) || []) { const m = nodeMap.get(id); if (m?.x != null) reach = Math.max(reach, Math.hypot(m.x - n.x, m.y - n.y, Z(m) - Z(n))); }
    const dist = Math.min(760, Math.max(240, reach * 2.3 + n.r * 4));
    const cam = Graph.camera(), W = box.clientWidth, H = box.clientHeight, half = dist * Math.tan((cam.fov * Math.PI) / 360);
    const back = st.flat ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3().subVectors(cam.position, controls.target).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    // 패널이 가리는 만큼 화면 중심을 옮겨, 고른 별이 남은 빈 곳 가운데에 오게 한다
    const off = W > 720 ? right.multiplyScalar((half * 346) / H) : up.multiplyScalar(-half * 0.44);
    const p = { x: n.x + off.x, y: n.y + off.y, z: Z(n) + off.z };
    Graph.cameraPosition({ x: p.x + back.x * dist, y: p.y + back.y * dist, z: p.z + back.z * dist }, p, calm ? 0 : ms);
  }
  function select(n, fly = true) {
    st.sel = n || null;
    poke();
    if (n) { stopSpin(); if (fly) flyTo(n); }
    el.querySelectorAll('.gx-rk').forEach((b) => b.classList.toggle('cur', !!n && b.dataset.go === n.id));
    drawPanel();
    paint();
  }

  // ---------- 옆 패널 ----------
  const row = (id, name, meta, cls = '') => `<button class="gx-row${shownIds.has(id) ? '' : ' off'}" data-go="${esc(id)}" ${shownIds.has(id) ? '' : 'title="지금 화면에는 없는 별이에요. 누르면 불러와요."'}><i class="dot ${cls}"></i><span>${esc(name)}</span><small>${esc(meta)}</small></button>`;
  const sect = (title, rows) => (rows.length ? `<h3>${title}</h3><div class="gx-rows">${rows.join('')}</div>` : '');
  function drawPanel() {
    const n = st.sel;
    panel.hidden = !n;
    el.classList.toggle('has-panel', !!n);
    if (!n) return;
    const near = (adjAll.get(n.id) || []).map((x) => ({ ...x, n: nodeMap.get(x.id) })).filter((x) => x.n);
    const of = (kind) => near.filter((x) => x.l.kind === kind);
    let html;
    if (n.type === 'co') {
      const c = n.c, s = c.stats, rate = s.bids ? Math.round((s.wins / s.bids) * 100) + '%' : '-';
      const wins = of('win').sort((a, b) => b.l.amt - a.l.amt), bids = of('bid').sort((a, b) => b.l.count - a.l.count);
      html = `<div class="gx-kind co">업체</div><h2>${esc(c.name)}</h2>
        <p>${esc([c.basic?.region, c.ceo && '대표 ' + c.ceo].filter(Boolean).join(' · ') || '조달 등록 정보 없음')}</p>
        <div class="gx-tiles"><div><small>참여</small><b>${s.bids}건</b></div><div><small>수주</small><b>${s.wins}건</b></div><div><small>수주율</small><b>${rate}</b></div><div><small>수주액</small><b>${eok(s.wonAmount)}</b></div></div>
        ${sect('일을 받은 기관', wins.map((x) => row(x.id, x.n.name, `${x.l.count}건${x.l.amt ? ' · ' + eok(x.l.amt) : ''}`, 'org')))}
        ${sect('함께한 회사 (컨소시엄)', of('partner').map((x) => row(x.id, x.n.name, `${x.l.count}건`, 'partner')))}
        ${sect('참여만 한 기관', bids.slice(0, 6).map((x) => row(x.id, x.n.name, `${x.l.count}번`, 'org')))}
        ${sect('자주 겨룬 회사', (c.rivals || []).filter((r) => nodeMap.has('c:' + r.bizno)).slice(0, 6).map((r) => row('c:' + r.bizno, short(r.name), `${r.count}번`, nodeMap.get('c:' + r.bizno).won ? 'won' : '')))}
        <a class="gx-cta" href="#company/${esc(c.bizno)}">회사 상세 보기</a>`;
    } else {
      const o = n.o, wins = of('win').sort((a, b) => b.l.amt - a.l.amt), bids = of('bid').sort((a, b) => b.l.count - a.l.count);
      const notices = [...o.notices].sort((a, b) => String(b.openedAt || b.deadline || '').localeCompare(String(a.openedAt || a.deadline || '')));
      html = `<div class="gx-kind org">발주기관</div><h2>${esc(o.name)}</h2>
        <p>이 목록 조건에 맞는 공고를 낸 기관이에요.</p>
        <div class="gx-tiles"><div><small>공고</small><b>${o.n}건</b></div><div><small>추정가 합계</small><b>${eok(o.amt)}</b></div><div><small>수주 업체</small><b>${wins.length}곳</b></div><div><small>참여 업체</small><b>${near.length}곳</b></div></div>
        ${sect('일을 가져간 회사', wins.map((x) => row(x.id, x.n.name, `${x.l.count}건${x.l.amt ? ' · ' + eok(x.l.amt) : ''}`, 'won')))}
        ${sect('참여만 한 회사', bids.slice(0, 8).map((x) => row(x.id, x.n.name, `${x.l.count}번`, x.n.won ? 'won' : '')))}
        ${sect('공고', notices.slice(0, 6).map((r) => `<a class="gx-row" href="#results" data-goto="${esc(r.id)}"><span>${esc(r.title)}</span><small>${eok(r.amount)}</small></a>`))}`;
    }
    panel.innerHTML = `<button class="gx-close" aria-label="닫기">×</button>${html}`;
    panel.scrollTop = 0;
  }
  panel.addEventListener('click', (e) => {
    if (e.target.closest('.gx-close')) return select(null);
    const b = e.target.closest('[data-go]');
    if (b) focus(b.dataset.go);
  });

  function focus(id) {
    const n = nodeMap.get(id);
    if (!n) return false;
    if (!shown.includes(n)) { forced.add(id); apply(); }
    if (!shown.includes(n)) { st.mode = 'all'; syncTools(); apply(); }
    if (!shown.includes(n)) return false;
    // 자리가 아직 안 잡혔으면(막 넣은 별) 잠깐 기다렸다가 간다
    if (n.x == null) setTimeout(() => select(n), 600); else select(n);
    return true;
  }

  // ---------- 순위: 어디부터 볼지 알려 주는 출발점 ----------
  {
    const orgAgg = new Map(), wonCo = [];
    let jointN = 0;
    for (const l of allLinks) {
      if (l.kind === 'partner') jointN++;
      if (l.kind !== 'win') continue;
      const e = orgAgg.get(l.source) || { id: l.source, amt: 0, n: 0 };
      e.amt += l.amt; e.n += l.count;
      orgAgg.set(l.source, e);
    }
    for (const n of nodeMap.values()) if (n.type === 'co' && n.won) wonCo.push({ id: n.id, amt: n.c.stats.wonAmount, n: n.c.stats.wins });
    const list = (rows, cls) => {
      const top = rows.sort((a, b) => b.amt - a.amt || b.n - a.n).slice(0, 7), max = Math.max(1, ...top.map((x) => x.amt));
      return top.map((x, i) => `<button class="gx-rk" data-go="${esc(x.id)}"><b>${i + 1}</b><span>${esc(nodeMap.get(x.id).name)}</span><small>${x.amt ? eok(x.amt) + ' · ' : ''}${x.n}건</small><i class="${cls}" style="width:${Math.max(3, (x.amt / max) * 100)}%"></i></button>`).join('');
    };
    q('.gx-side').innerHTML = `
      <p class="gx-sum"><b class="org">기관 ${orgAgg.size}곳</b>이 <b class="won">업체 ${wonCo.length}곳</b>에 일을 맡겼어요.${jointN ? ` 컨소시엄은 ${jointN}쌍.` : ''}<br>선은 기관 → 수주 업체. 별이 클수록 규모가 커요.</p>
      <h3>일을 많이 맡긴 기관</h3>${list([...orgAgg.values()], 'org')}
      <h3>일을 많이 받은 업체</h3>${list(wonCo, 'won')}`;
    q('.gx-side').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) focus(b.dataset.go); });
  }

  // ---------- 찾기 ----------
  const norm = (s) => String(s || '').replace(/\s/g, '').toLowerCase();
  function suggest() {
    const k = norm(input.value);
    if (!k) { sug.hidden = true; return; }
    const hits = [...nodeMap.values()].filter((n) => norm(n.name).includes(k) || (n.c && n.c.bizno.includes(k)))
      .sort((a, b) => b.r - a.r).slice(0, 8);
    sug.innerHTML = hits.length
      ? hits.map((n) => `<button data-go="${esc(n.id)}"><i class="dot ${n.type === 'org' ? 'org' : n.won ? 'won' : ''}"></i><span>${esc(n.name)}</span><small>${n.type === 'org' ? '기관' : '업체'}</small></button>`).join('')
      : '<div class="gx-none">찾는 이름이 없어요</div>';
    sug.hidden = false;
  }
  input.addEventListener('input', suggest);
  input.addEventListener('focus', suggest);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const b = sug.querySelector('[data-go]'); if (b) { focus(b.dataset.go); sug.hidden = true; input.blur(); } }
    if (e.key === 'Escape') { sug.hidden = true; input.blur(); }
  });
  sug.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { focus(b.dataset.go); sug.hidden = true; } });
  el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.gx-search')) sug.hidden = true; });

  // ---------- 도구 ----------
  function syncTools() {
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === st.mode));
    q('[data-rival]').setAttribute('aria-pressed', st.rival);
    el.querySelectorAll('[data-dim]').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.dim === 'flat') === st.flat));
  }
  q('.gx-tools').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    poke();
    if ('side' in b.dataset) { const on = !el.classList.contains('side-on'); el.classList.toggle('side-on', on); b.setAttribute('aria-pressed', on); }
    else if ('fx' in b.dataset) { manualFx = true; setQuality(quality === 2 ? 0 : 2); }
    else if (b.dataset.mode) { st.mode = b.dataset.mode; fitted = false; syncTools(); apply(); } // 자리가 다시 잡히면 화면에 맞춘다
    else if (b.dataset.dim) {
      const flat = b.dataset.dim === 'flat';
      if (flat === st.flat) return;
      st.flat = flat; fitted = false;
      select(null);
      syncTools(); syncControls();
      // 배치를 새로 잡고, 정면에서 다시 본다
      Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 0);
      Graph.d3Force('link').distance(Graph.d3Force('link').distance());
      cooling = true;
      Graph.numDimensions(flat ? 2 : 3);
    }
    else if ('rival' in b.dataset) { st.rival = !st.rival; syncTools(); apply(); }
    else if ('fit' in b.dataset) { select(null); Graph.zoomToFit(calm ? 0 : 900, 50); }
  });

  // 넓고 높은 화면에서만 순위 목록을 펼친 채로 시작한다
  if (el.clientWidth >= 1000 && el.clientHeight >= 620) { el.classList.add('side-on'); q('[data-side]').setAttribute('aria-pressed', 'true'); }
  const size = () => { const w = box.clientWidth, h = box.clientHeight; if (w && h) Graph.width(w).height(h); };
  new ResizeObserver(size).observe(box);
  size();
  apply();
  let fitted = false;
  let first = true;
  Graph.onEngineStop(() => { cooling = false; fpsFrom = 0; if (!fitted && !st.sel) Graph.zoomToFit(calm ? 0 : first ? 2200 : 900, 24); fitted = true; first = false; });

  return {
    focus,
    pause() { clearTimeout(idleT); paused = true; Graph.pauseAnimation(); },
    resume() { size(); poke(); },
    destroy() { cancelAnimationFrame(raf); clearTimeout(idleT); Graph._destructor?.(); },
  };
}
