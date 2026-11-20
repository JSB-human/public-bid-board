// 업체 관계도. d3 의 힘 배치로 그리고, 확대·이동·끌기, 마우스 올리면 이웃 강조, 검색을 지원한다.
//   const g = await networkGraph(el, { nodes, links, focus, onOpen })
//   nodes: { id, name, size(0~1), wins, bids, amount, sub }   links: { source, target, kind: 'partner'|'rival', count, share }

let d3p = null;
const loadD3 = () => (d3p ??= import('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (n) => String(n || '').replace(/주식회사|\(주\)|㈜|유한회사/g, '').trim();
// 무리(컨소시엄으로 이어진 회사 묶음)별 색. 다크 모드에서도 읽히는 중간 명도.
const PALETTE = ['#3182f6', '#f04452', '#03b26c', '#fe9800', '#8b5cf6', '#18a5a5', '#e64980', '#5c7cfa', '#d9480f', '#2b8a3e'];

// 컨소시엄 선으로 이어진 묶음 찾기 (union-find)
function groups(nodes, links) {
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const l of links) if (l.kind === 'partner') parent.set(find(l.source), find(l.target));
  const size = new Map();
  for (const n of nodes) size.set(find(n.id), (size.get(find(n.id)) || 0) + 1);
  const order = [...size].filter(([, s]) => s > 1).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  for (const n of nodes) {
    const i = order.indexOf(find(n.id));
    n.group = i;
    n.color = i >= 0 ? PALETTE[i % PALETTE.length] : null;
  }
}

export async function networkGraph(el, { nodes, links, focus = null, onOpen, height = 520, showRivals = true }) {
  const d3 = await loadD3();
  el.innerHTML = '';
  el.classList.add('ng');
  nodes = nodes.map((n) => ({ ...n }));
  links = links.map((l) => ({ ...l }));
  groups(nodes, links);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nbr = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const l of links) { nbr.get(l.source)?.add(l.target); nbr.get(l.target)?.add(l.source); }

  const width = el.clientWidth || 800;
  const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, width, height]).attr('class', 'ng-svg').attr('role', 'img').attr('aria-label', '업체 관계도');
  const root = svg.append('g');
  const tip = d3.select(el).append('div').attr('class', 'ng-tip').style('opacity', 0);

  const r = (n) => (n.id === focus ? 18 : 5 + 15 * Math.sqrt(n.size || 0));
  const link = root.append('g').selectAll('line').data(links).join('line')
    .attr('class', (l) => `ng-l ${l.kind}`)
    .attr('stroke-width', (l) => (l.kind === 'partner' ? 1.5 + Math.min(4, l.count) : 1 + Math.min(2, (l.count - 1) * 0.6)));
  const node = root.append('g').selectAll('g').data(nodes).join('g').attr('class', (n) => `ng-n${n.id === focus ? ' focus' : ''}${n.wins ? ' won' : ''}`);
  node.append('circle').attr('r', r)
    .attr('fill', (n) => (n.id === focus ? 'var(--text)' : n.color || 'var(--faint)'));
  node.append('text').attr('dy', (n) => r(n) + 12).attr('text-anchor', 'middle')
    .text((n) => { const s = short(n.name); return s.length > 9 ? s.slice(0, 9) + '…' : s; })
    .attr('class', (n) => (n.id === focus || (n.size || 0) > 0.25 || n.color ? 'show' : ''));

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((n) => n.id)
      .distance((l) => (l.kind === 'partner' ? 46 : 120))
      .strength((l) => (l.kind === 'partner' ? 0.9 : 0.08)))
    .force('charge', d3.forceManyBody().strength((n) => -60 - 220 * (n.size || 0)))
    .force('collide', d3.forceCollide().radius((n) => r(n) + 10))
    .force('x', d3.forceX(width / 2).strength(0.05))
    .force('y', d3.forceY(height / 2).strength(0.08));
  if (focus && byId.get(focus)) { const f = byId.get(focus); f.fx = width / 2; f.fy = height / 2; }

  const ticked = () => {
    link.attr('x1', (l) => l.source.x).attr('y1', (l) => l.source.y).attr('x2', (l) => l.target.x).attr('y2', (l) => l.target.y);
    node.attr('transform', (n) => `translate(${n.x},${n.y})`);
  };
  // 자리를 먼저 다 계산해 두고 그린다(열자마자 전체가 보이게). 끌 때만 다시 움직인다.
  sim.stop();
  for (let i = 0; i < 400; i++) sim.tick();
  ticked();
  sim.on('tick', ticked);

  // 확대·이동
  const zoom = d3.zoom().scaleExtent([0.3, 4]).on('zoom', (e) => root.attr('transform', e.transform));
  svg.call(zoom).on('dblclick.zoom', null);
  const fit = (dur = 500) => {
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    if (!xs.length) return;
    const [x0, x1, y0, y1] = [Math.min(...xs) - 40, Math.max(...xs) + 40, Math.min(...ys) - 40, Math.max(...ys) + 50];
    const k = Math.min(2, 0.95 / Math.max((x1 - x0) / width, (y1 - y0) / height));
    svg.transition().duration(dur).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  };
  fit(0);

  // 끌기
  node.call(d3.drag()
    .on('start', (e, n) => { if (!e.active) sim.alphaTarget(0.2).restart(); n.fx = n.x; n.fy = n.y; })
    .on('drag', (e, n) => { n.fx = e.x; n.fy = e.y; })
    .on('end', (e, n) => { if (!e.active) sim.alphaTarget(0); if (n.id !== focus) { n.fx = null; n.fy = null; } }));

  // 강조
  let pinned = null;
  const highlight = (id) => {
    if (!id) { node.classed('dim', false).classed('hi', false); link.classed('dim', false).classed('hi', false); return; }
    const set = nbr.get(id) || new Set();
    node.classed('dim', (n) => n.id !== id && !set.has(n.id)).classed('hi', (n) => n.id === id);
    link.classed('dim', (l) => l.source.id !== id && l.target.id !== id).classed('hi', (l) => l.source.id === id || l.target.id === id);
  };
  const showTip = (e, n) => {
    const ps = links.filter((l) => l.kind === 'partner' && (l.source.id === n.id || l.target.id === n.id));
    const rv = links.filter((l) => l.kind === 'rival' && (l.source.id === n.id || l.target.id === n.id));
    tip.html(`<b>${esc(n.name)}</b>${n.sub ? `<span>${esc(n.sub)}</span>` : ''}
      <div class="ng-tip-row"><span>참여 ${n.bids ?? 0}</span><span>수주 ${n.wins ?? 0}</span>${n.amountText ? `<span>${esc(n.amountText)}</span>` : ''}</div>
      ${ps.length ? `<div class="ng-tip-l">컨소시엄 ${ps.length}곳</div>` : ''}${rv.length ? `<div class="ng-tip-l">경쟁 ${rv.length}곳</div>` : ''}
      <small>눌러서 회사 보기</small>`);
    const box = el.getBoundingClientRect();
    tip.style('left', `${Math.min(box.width - 220, e.clientX - box.left + 14)}px`).style('top', `${e.clientY - box.top + 14}px`).style('opacity', 1);
  };
  node.on('mouseenter', (e, n) => { if (!pinned) highlight(n.id); showTip(e, n); })
    .on('mousemove', (e, n) => showTip(e, n))
    .on('mouseleave', () => { if (!pinned) highlight(null); tip.style('opacity', 0); })
    .on('click', (e, n) => { e.stopPropagation(); onOpen?.(n.id); });
  link.on('mouseenter', (e, l) => {
    const txt = l.kind === 'partner'
      ? `<b>컨소시엄 ${l.count}건</b><span>${esc(short(l.source.name))} · ${esc(short(l.target.name))}${l.share ? ` (지분 ${esc(l.share)})` : ''}</span>`
      : `<b>같은 공고 ${l.count}번 경쟁</b><span>${esc(short(l.source.name))} · ${esc(short(l.target.name))}</span>`;
    tip.html(txt);
    const box = el.getBoundingClientRect();
    tip.style('left', `${e.clientX - box.left + 12}px`).style('top', `${e.clientY - box.top + 12}px`).style('opacity', 1);
  }).on('mouseleave', () => tip.style('opacity', 0));
  svg.on('click', () => { pinned = null; highlight(null); });

  return {
    fit,
    // 검색: 이름이 맞는 회사로 이동해 강조한다
    find(q) {
      q = String(q || '').replace(/\s/g, '').toLowerCase();
      if (!q) { pinned = null; highlight(null); fit(); return false; }
      const n = nodes.find((x) => short(x.name).replace(/\s/g, '').toLowerCase().includes(q));
      if (!n) return false;
      pinned = n.id;
      highlight(n.id);
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(1.8).translate(-n.x, -n.y));
      return true;
    },
    zoomBy(k) { svg.transition().duration(250).call(zoom.scaleBy, k); },
  };
}
