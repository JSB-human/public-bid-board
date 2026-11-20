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
  for (const o of orgs.values()) {
    if (!linkedOrgs.has(o.name)) continue; // 아무도 응찰하지 않은 기관은 이을 선이 없어 뺀다
    nodes.set('o:' + o.name, { id: 'o:' + o.name, type: 'org', name: o.name, o, r: 3 + 1.7 * Math.sqrt(o.n) });
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
function labelSprite(text, color) {
  const fs = 44, pad = 10;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `700 ${fs}px "Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif`;
  ctx.font = font;
  cv.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.height = fs + pad * 2;
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(5,6,13,.9)';
  ctx.strokeText(text, cv.width / 2, cv.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  sp.userData.aspect = cv.width / cv.height;
  sp.renderOrder = 10;
  sp.raycast = () => {};
  return sp;
}
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
function starObject(n) {
  const color = n.type === 'org' ? C.org : n.won ? C.won : C.plain;
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(SPHERE, new THREE.MeshBasicMaterial({ color, transparent: true }));
  mesh.scale.setScalar(n.r);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(n.r * (n.type === 'org' ? 7 : n.won ? 6 : 4));
  glow.raycast = () => {};
  const text = n.name.length > 14 ? n.name.slice(0, 14) + '…' : n.name;
  const label = labelSprite(text, n.type === 'org' ? C.org : n.won ? C.label : C.labelDim);
  // 이름표는 멀리서도 같은 크기로 보이게 하고(큰 별은 조금 크게), 별 바로 아래에 건다.
  const h = n.r > 6 ? 0.027 : 0.022;
  label.scale.set(h * label.userData.aspect, h, 1);
  label.userData.h = h;
  label.center.set(0.5, 1);
  label.position.y = -(n.r + 0.6);
  label.visible = false;
  g.add(glow, mesh, label);
  n.g3 = { mesh, glow, label, glowSize: glow.scale.x };
  return g;
}
function starfield() {
  const N = 1800, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 1400 + Math.random() * 2200, t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(p) * Math.cos(t); pos[i * 3 + 1] = r * Math.sin(p) * Math.sin(t); pos[i * 3 + 2] = r * Math.cos(p);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x93a4c8, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
  pts.raycast = () => {};
  return pts;
}

// ---------- 화면 ----------
export async function openGalaxy(el, { companies, results }) {
  const { nodes: nodeMap, links: allLinks, hiddenOrgs } = build(companies, results);
  const st = { mode: 'all', rival: false, sel: null, hov: null };
  let nbr = new Map(), shown = [], adj = new Map();

  el.innerHTML = `
    <div class="gx-canvas"></div>
    <div class="gx-top">
      <div class="gx-search">${SEARCH}<input type="search" placeholder="회사·기관 이름으로 찾아가기" aria-label="관계도에서 찾기" autocomplete="off"><div class="gx-sug" hidden></div></div>
      <div class="gx-tools">
        <div class="gx-seg" role="group" aria-label="보기 범위"><button data-mode="all" aria-pressed="true">전체</button><button data-mode="win" aria-pressed="false">수주 관계만</button></div>
        <button class="gx-btn" data-rival aria-pressed="false">경쟁선</button>
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
    <div class="gx-hint">끌어서 돌리기 · 휠로 확대 · 별을 누르면 그쪽으로 날아가요</div>
    <aside class="gx-panel" hidden></aside>`;
  const q = (s) => el.querySelector(s);
  const box = q('.gx-canvas'), panel = q('.gx-panel'), input = q('.gx-search input'), sug = q('.gx-sug');

  await document.fonts?.ready;
  const Graph = new ForceGraph3D(box, { controlType: 'orbit' })
    .backgroundColor('rgba(0,0,0,0)')
    .showNavInfo(false)
    .enableNodeDrag(false)
    .nodeThreeObject(starObject)
    .nodeLabel((n) => (n.type === 'org'
      ? `<div class="gx-tip"><b>${esc(n.name)}</b><span>발주기관 · 공고 ${n.o.n}건 · ${eok(n.o.amt)}</span></div>`
      : `<div class="gx-tip"><b>${esc(n.c.name)}</b><span>참여 ${n.c.stats.bids} · 수주 ${n.c.stats.wins}${n.c.stats.wonAmount ? ' · ' + eok(n.c.stats.wonAmount) : ''}</span></div>`))
    .linkOpacity(1)
    .linkColor((l) => LINK[l.kind](isOn(l)))
    .linkWidth((l) => (l.kind === 'partner' ? 0.7 : l.kind === 'win' && active() && isOn(l) ? 0.5 : 0))
    .linkDirectionalParticles((l) => (l.kind === 'win' && active() && isOn(l) ? Math.min(4, 1 + l.count) : 0))
    .linkDirectionalParticleWidth(1.4)
    .linkDirectionalParticleSpeed(0.006)
    .linkDirectionalParticleColor(() => '#bfe0ff')
    .warmupTicks(90)
    .cooldownTicks(160)
    .onNodeHover((n) => { st.hov = n || null; box.style.cursor = n ? 'pointer' : ''; if (!st.sel) paint(); })
    .onNodeClick((n) => select(n))
    .onBackgroundClick(() => select(null));

  Graph.d3Force('link')
    .distance((l) => ({ partner: 16, win: 34, bid: 58, rival: 90 }[l.kind]))
    .strength((l) => ({ partner: 0.9, win: 0.55, bid: 0.14, rival: 0.01 }[l.kind]));
  Graph.d3Force('charge').strength(-70);
  // 서로 이어지지 않은 무리가 멀리 흩어지지 않게 가운데로 살짝 당긴다.
  let simNodes = [];
  const gravity = (alpha) => { for (const n of simNodes) { n.vx -= n.x * 0.035 * alpha; n.vy -= n.y * 0.035 * alpha; n.vz -= n.z * 0.035 * alpha; } };
  gravity.initialize = (ns) => { simNodes = ns; };
  Graph.d3Force('gravity', gravity);
  Graph.scene().add(starfield());

  const controls = Graph.controls();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.autoRotate = !calm;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;
  const stopSpin = () => { controls.autoRotate = false; q('.gx-hint').classList.add('off'); };
  box.addEventListener('pointerdown', stopSpin);
  box.addEventListener('wheel', stopSpin, { passive: true });

  function active() { return st.sel || st.hov; }
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
    const use = links.filter((l) => ids.has(idOf(l.source)) && ids.has(idOf(l.target))).map((l) => ({ ...l, source: idOf(l.source), target: idOf(l.target) }));
    nbr = new Map(shown.map((n) => [n.id, new Set()]));
    adj = new Map(shown.map((n) => [n.id, []]));
    for (const l of use) {
      nbr.get(l.source).add(l.target); nbr.get(l.target).add(l.source);
      adj.get(l.source).push({ id: l.target, l }); adj.get(l.target).push({ id: l.source, l });
    }
    if (st.sel && !ids.has(st.sel.id)) { st.sel = null; drawPanel(); }
    Graph.graphData({ nodes: shown, links: use });
    q('.gx-count').textContent = `별 ${shown.length}개 · 선 ${use.length}개${hiddenOrgs ? ` · 응찰 없던 기관 ${hiddenOrgs}곳은 빠졌어요` : ''}`;
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
      n.g3.glow.material.opacity = n === a ? 0.95 : 0.45;
      n.g3.glow.scale.setScalar(n.g3.glowSize * (n === a ? 1.7 : 1));
    }
    Graph.linkColor(Graph.linkColor()).linkWidth(Graph.linkWidth()).linkDirectionalParticles(Graph.linkDirectionalParticles());
    labels();
  }
  // 이름표: 화면에서 서로 겹치지 않는 것만 보인다. 큰 별과 가까운 별이 먼저 자리를 잡아서,
  // 멀리서는 굵직한 이름만, 다가가면 주변 이름이 차례로 나타난다. 고른 별이 있으면 그 별과 이웃만.
  const v3 = new THREE.Vector3();
  function labels() {
    const a = active(), set = a ? nbr.get(a.id) : null;
    const cam = Graph.camera(), W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const K = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const cand = [];
    for (const n of shown) {
      if (!n.g3 || n.x == null) continue;
      n.g3.label.visible = false;
      if (a && n !== a && !set?.has(n.id)) continue;
      v3.set(n.x, n.y, n.z).project(cam);
      if (v3.z > 1 || Math.abs(v3.x) > 1.05 || Math.abs(v3.y) > 1.05) continue;
      const d = Math.hypot(n.x - cam.position.x, n.y - cam.position.y, n.z - cam.position.z) || 1;
      const lb = n.g3.label, h = lb.userData.h * K, w = h * lb.userData.aspect;
      const x = ((v3.x + 1) / 2) * W, y = ((1 - v3.y) / 2) * H + (n.r * K) / d;
      cand.push({ n, x0: x - w / 2 - 3, x1: x + w / 2 + 3, y0: y - 2, y1: y + h + 2, pr: (n === a ? 1e6 : 0) + n.r + 500 / d });
    }
    cand.sort((p, q) => q.pr - p.pr);
    const placed = [];
    for (const c of cand) {
      if (placed.length >= (a ? 40 : 46)) break;
      if (placed.some((p) => c.x0 < p.x1 && c.x1 > p.x0 && c.y0 < p.y1 && c.y1 > p.y0)) continue;
      placed.push(c);
      c.n.g3.label.visible = true;
    }
  }
  const timer = setInterval(() => { if (!el.hidden && el.offsetParent) labels(); }, 180);

  function flyTo(n, ms = 1300) {
    // 이웃이 한 화면에 들어올 만큼 물러서서 본다
    let reach = 0;
    for (const id of nbr.get(n.id) || []) { const m = nodeMap.get(id); if (m?.x != null) reach = Math.max(reach, Math.hypot(m.x - n.x, m.y - n.y, m.z - n.z)); }
    const dist = Math.min(520, Math.max(230, reach * 2.1 + n.r * 4)), len = Math.hypot(n.x, n.y, n.z) || 1, k = 1 + dist / len;
    // 패널이 가리는 만큼 화면 중심을 옮겨, 고른 별이 남은 빈 곳 가운데에 오게 한다
    const cam = Graph.camera(), W = box.clientWidth, H = box.clientHeight, half = dist * Math.tan((cam.fov * Math.PI) / 360);
    const dir = new THREE.Vector3(-n.x, -n.y, -n.z).normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir);
    const off = W > 720 ? right.multiplyScalar(half * (W / H) * (346 / W)) : up.multiplyScalar(-half * 0.44);
    Graph.cameraPosition({ x: n.x * k + off.x, y: n.y * k + off.y, z: n.z * k + off.z }, { x: n.x + off.x, y: n.y + off.y, z: n.z + off.z }, calm ? 0 : ms);
  }
  function select(n, fly = true) {
    st.sel = n || null;
    if (n) { stopSpin(); if (fly) flyTo(n); }
    drawPanel();
    paint();
  }

  // ---------- 옆 패널 ----------
  const row = (id, name, meta, cls = '') => `<button class="gx-row" data-go="${esc(id)}"><i class="dot ${cls}"></i><span>${esc(name)}</span><small>${esc(meta)}</small></button>`;
  const sect = (title, rows) => (rows.length ? `<h3>${title}</h3><div class="gx-rows">${rows.join('')}</div>` : '');
  function drawPanel() {
    const n = st.sel;
    panel.hidden = !n;
    el.classList.toggle('has-panel', !!n);
    if (!n) return;
    const near = (adj.get(n.id) || []).map((x) => ({ ...x, n: nodeMap.get(x.id) })).filter((x) => x.n);
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
    if (!shown.includes(n)) { st.mode = 'all'; syncTools(); apply(); }
    if (!shown.includes(n)) return false;
    // 자리가 아직 안 잡혔으면(막 넣은 별) 잠깐 기다렸다가 간다
    if (n.x == null) setTimeout(() => select(n), 600); else select(n);
    return true;
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
  }
  q('.gx-tools').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) { st.mode = b.dataset.mode; fitted = false; syncTools(); apply(); } // 자리가 다시 잡히면 화면에 맞춘다
    else if ('rival' in b.dataset) { st.rival = !st.rival; syncTools(); apply(); }
    else if ('fit' in b.dataset) { select(null); Graph.zoomToFit(calm ? 0 : 900, 50); }
  });

  const size = () => { const w = box.clientWidth, h = box.clientHeight; if (w && h) Graph.width(w).height(h); };
  new ResizeObserver(size).observe(box);
  size();
  apply();
  let fitted = false;
  Graph.onEngineStop(() => { if (!fitted && !st.sel) Graph.zoomToFit(calm ? 0 : 900, 50); fitted = true; });

  return {
    focus,
    pause() { Graph.pauseAnimation(); },
    resume() { Graph.resumeAnimation(); size(); },
    destroy() { clearInterval(timer); Graph._destructor?.(); },
  };
}
