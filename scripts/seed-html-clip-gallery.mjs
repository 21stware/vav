#!/usr/bin/env node
/**
 * Seeds a pinned VAV Dev session: ```xstate (official Inspector),
 * ```app (tldraw + teaching aids + p5 / three / d3).
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), 'Library/Application Support/vav-dev/conversations')
const indexPath = join(dir, 'index.json')
const now = Date.now()
const id = randomUUID()
const userId = randomUUID()
const asstId = randomUUID()

const fence = (body) => '```app\n' + body.trim() + '\n```'
const xstateFence = (body) => '```xstate\n' + body.trim() + '\n```'

const xstate = `{
  "id": "article",
  "initial": "draft",
  "states": {
    "draft": { "on": { "SUBMIT": "review" } },
    "review": {
      "initial": "pending",
      "states": {
        "pending": { "on": { "REQUEST_CHANGES": "changes" } },
        "changes": { "on": { "RESUBMIT": "pending" } }
      },
      "on": { "APPROVE": "published", "REJECT": "draft" }
    },
    "published": { "on": { "UNPUBLISH": "draft", "EXPIRE": "archived" } },
    "archived": { "on": { "RESTORE": "draft" } }
  }
}`

const tldraw = `
<link rel="stylesheet" href="https://esm.sh/tldraw@3.11.0/tldraw.css" />
<div id="board" style="height:480px;border-radius:12px;overflow:hidden"></div>
<script type="module">
import { createElement } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import { Tldraw } from 'https://esm.sh/tldraw@3.11.0?external=react,react-dom'
createRoot(document.getElementById('board')).render(
  createElement(Tldraw, { persistenceKey: 'vav-app-gallery' })
)
</script>
`

const math = `
<h1>数学 · 单位圆</h1>
<p class="hint">拖角度。正弦 / 余弦跟着变。</p>
<div class="card">
  <canvas id="uc" width="320" height="320" style="width:100%;max-width:320px"></canvas>
  <input id="ang" type="range" min="0" max="360" value="40" />
  <p id="readout" class="muted"></p>
</div>
<script>
const c = document.getElementById('uc')
const ctx = c.getContext('2d')
const slider = document.getElementById('ang')
function draw() {
  const deg = Number(slider.value)
  const th = deg * Math.PI / 180
  const cx = 160, cy = 160, r = 120
  ctx.clearRect(0,0,320,320)
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border')
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(20,cy); ctx.lineTo(300,cy); ctx.moveTo(cx,20); ctx.lineTo(cx,300); ctx.stroke()
  const x = cx + r * Math.cos(th), y = cy - r * Math.sin(th)
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-text')
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(x,y); ctx.stroke()
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent')
  ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fill()
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text')
  document.getElementById('readout').textContent =
    deg + '°  ·  cos ' + Math.cos(th).toFixed(3) + '  ·  sin ' + Math.sin(th).toFixed(3)
}
slider.addEventListener('input', draw)
draw()
</script>
`

const physics = `
<h1>物理 · 抛体</h1>
<p class="hint">调初速和仰角，看落点。重力 9.8。</p>
<div class="card">
  <canvas id="pj" width="480" height="240" style="width:100%"></canvas>
  <label class="muted">v0 <input id="v0" type="range" min="8" max="40" value="22"></label>
  <label class="muted">θ <input id="th" type="range" min="10" max="80" value="42"></label>
  <p id="pj-out" class="muted"></p>
</div>
<script>
const c = document.getElementById('pj'), ctx = c.getContext('2d')
const v0 = document.getElementById('v0'), th = document.getElementById('th')
function draw() {
  const v = Number(v0.value), a = Number(th.value) * Math.PI / 180, g = 9.8
  const T = 2 * v * Math.sin(a) / g
  const R = v * v * Math.sin(2*a) / g
  ctx.clearRect(0,0,480,240)
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border')
  ctx.beginPath(); ctx.moveTo(20,220); ctx.lineTo(460,220); ctx.stroke()
  ctx.beginPath()
  const sx = 400 / Math.max(R, 1)
  ctx.moveTo(20,220)
  for (let i = 0; i <= 40; i++) {
    const t = T * i / 40
    const x = v * Math.cos(a) * t
    const y = v * Math.sin(a) * t - 0.5 * g * t * t
    ctx.lineTo(20 + x * sx, 220 - y * sx)
  }
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-text')
  ctx.stroke()
  document.getElementById('pj-out').textContent =
    'v0=' + v + ' m/s  θ=' + th.value + '°  射程 ' + R.toFixed(1) + ' m  滞空 ' + T.toFixed(2) + ' s'
}
v0.addEventListener('input', draw)
th.addEventListener('input', draw)
draw()
</script>
`

const science = `
<h1>科学 · 原子壳层</h1>
<p class="hint">点元素，看电子排布。</p>
<div class="row" id="els"></div>
<div class="card" style="margin-top:10px">
  <canvas id="atom" width="280" height="220"></canvas>
  <p id="atom-out" class="muted"></p>
</div>
<script>
const table = [
  {s:'H', z:1, e:[1]},
  {s:'He', z:2, e:[2]},
  {s:'C', z:6, e:[2,4]},
  {s:'O', z:8, e:[2,6]},
  {s:'Na', z:11, e:[2,8,1]},
  {s:'Cl', z:17, e:[2,8,7]}
]
const ctx = document.getElementById('atom').getContext('2d')
function draw(el) {
  ctx.clearRect(0,0,280,220)
  const cx=140, cy=110
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent')
  ctx.beginPath(); ctx.arc(cx,cy,10,0,Math.PI*2); ctx.fill()
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-fg')
  ctx.font = '11px sans-serif'; ctx.textAlign='center'; ctx.fillText(el.s, cx, cy+4)
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border')
  el.e.forEach((n,i) => {
    const r = 28 + i*28
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke()
    for (let k=0;k<n;k++) {
      const a = (k / n) * Math.PI * 2
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text')
      ctx.beginPath(); ctx.arc(cx+r*Math.cos(a), cy+r*Math.sin(a), 3.5, 0, Math.PI*2); ctx.fill()
    }
  })
  document.getElementById('atom-out').textContent = el.s + '  Z=' + el.z + '  ' + el.e.join('-')
}
const row = document.getElementById('els')
table.forEach((el,i) => {
  const b = document.createElement('button')
  b.textContent = el.s
  b.onclick = () => draw(el)
  if (i===2) b.dataset.primary='1'
  row.appendChild(b)
})
draw(table[2])
</script>
`

const geo = `
<h1>地理 · 中国四大高原</h1>
<p class="hint">点名称，看位置和一句要点。</p>
<svg viewBox="0 0 360 220" width="100%" role="img">
  <rect x="20" y="20" width="320" height="180" rx="10" fill="var(--bg-sunken)"/>
  <circle id="p-qinghai" cx="90" cy="120" r="28" fill="var(--accent)" opacity="0.25" data-k="qinghai"/>
  <circle id="p-yunnan" cx="130" cy="160" r="20" fill="var(--accent)" opacity="0.2" data-k="yunnan"/>
  <circle id="p-loess" cx="200" cy="90" r="22" fill="var(--accent)" opacity="0.2" data-k="loess"/>
  <circle id="p-inner" cx="250" cy="70" r="24" fill="var(--accent)" opacity="0.2" data-k="inner"/>
</svg>
<div class="row" id="plats"></div>
<p id="geo-out" class="muted"></p>
<script>
const facts = {
  qinghai: ['青藏高原', '世界屋脊，长江黄河发源。'],
  yunnan: ['云贵高原', '喀斯特，垂直气候。'],
  loess: ['黄土高原', '深厚黄土，水土流失治理。'],
  inner: ['内蒙古高原', '平坦开阔，牧区为主。']
}
function pick(k) {
  document.querySelectorAll('circle').forEach((c) => {
    c.setAttribute('opacity', c.dataset.k === k ? '0.55' : '0.2')
  })
  const [n, d] = facts[k]
  document.getElementById('geo-out').textContent = n + ' · ' + d
}
const row = document.getElementById('plats')
Object.keys(facts).forEach((k) => {
  const b = document.createElement('button')
  b.textContent = facts[k][0]
  b.onclick = () => pick(k)
  row.appendChild(b)
})
document.querySelectorAll('circle').forEach((c) => {
  c.style.cursor = 'pointer'
  c.addEventListener('click', () => pick(c.dataset.k))
})
pick('qinghai')
</script>
`

const history = `
<h1>历史 · 丝绸之路节点</h1>
<p class="hint">沿时间轴点城市。</p>
<div class="card">
  <div id="ticks" class="row"></div>
  <h2 id="h-title"></h2>
  <p id="h-copy"></p>
</div>
<script>
const stops = [
  { y: '前138', n: '长安出发', d: '张骞凿空，汉使西行。' },
  { y: '100', n: '敦煌', d: '河西走廊门户，汉简与壁画。' },
  { y: '200', n: '楼兰 / 尼雅', d: '塔里木南缘绿洲，后来废弃。' },
  { y: '650', n: '撒马尔罕', d: '粟特商团中枢，联通波斯。' },
  { y: '800', n: '巴格达', d: '阿拔斯都城，纸与译馆。' },
  { y: '1250', n: '汗八里', d: '元大都，海陆丝路交会。' }
]
const ticks = document.getElementById('ticks')
function show(i) {
  const s = stops[i]
  document.getElementById('h-title').textContent = s.y + ' · ' + s.n
  document.getElementById('h-copy').textContent = s.d
  ;[...ticks.children].forEach((b, j) => { if (j===i) b.dataset.primary='1'; else delete b.dataset.primary })
}
stops.forEach((s,i) => {
  const b = document.createElement('button')
  b.textContent = s.y
  b.onclick = () => show(i)
  ticks.appendChild(b)
})
show(0)
</script>
`

const english = `
<h1>English · irregular verbs</h1>
<p class="hint">Type the past participle. Enter to check.</p>
<div class="card">
  <p id="prompt"></p>
  <input id="ans" placeholder="past participle" autocomplete="off" />
  <div class="row" style="margin-top:8px">
    <button data-primary id="check">Check</button>
    <button id="next">Skip</button>
    <span class="muted" id="score"></span>
  </div>
  <p id="fb" class="muted"></p>
</div>
<script>
const pack = [
  ['go', 'gone'], ['write', 'written'], ['break', 'broken'],
  ['see', 'seen'], ['take', 'taken'], ['speak', 'spoken']
]
let i = 0, ok = 0
const prompt = document.getElementById('prompt')
const ans = document.getElementById('ans')
const fb = document.getElementById('fb')
function show() {
  prompt.textContent = 'go → went → ?'.replace('go', pack[i][0]).replace('went', '…')
  prompt.textContent = pack[i][0] + '  →  ?'
  ans.value = ''; fb.textContent = ''; ans.focus()
}
function grade() {
  const right = pack[i][1]
  if (ans.value.trim().toLowerCase() === right) {
    ok++; fb.textContent = 'Yes.'; i = (i+1)%pack.length; show()
  } else fb.textContent = 'Not quite. Aim for “' + right + '”.'
  document.getElementById('score').textContent = ok + ' correct'
}
document.getElementById('check').onclick = grade
document.getElementById('next').onclick = () => { i = (i+1)%pack.length; show() }
ans.addEventListener('keydown', (e) => { if (e.key === 'Enter') grade() })
show()
</script>
`

const chinese = `
<h1>语文 · 四声</h1>
<p class="hint">听字形，选声调。妈麻马骂。</p>
<div class="card">
  <h2 id="zi" style="font-size:42px;margin:0 0 8px">妈</h2>
  <div class="row" id="tones"></div>
  <p id="zh-fb" class="muted"></p>
</div>
<script>
const items = [
  { z:'妈', t:1, m:'mā · 母亲' },
  { z:'麻', t:2, m:'má · 芝麻' },
  { z:'马', t:3, m:'mǎ · 动物' },
  { z:'骂', t:4, m:'mà · 责骂' }
]
let i = 0
const labels = ['一声 ˉ', '二声 ˊ', '三声 ˇ', '四声 ˋ']
function ask() {
  document.getElementById('zi').textContent = items[i].z
  document.getElementById('zh-fb').textContent = '选一个声调'
}
const row = document.getElementById('tones')
labels.forEach((lab, n) => {
  const b = document.createElement('button')
  b.textContent = lab
  b.onclick = () => {
    const hit = n+1 === items[i].t
    document.getElementById('zh-fb').textContent = hit ? '对。' + items[i].m : '再想一想。'
    if (hit) { i = (i+1)%items.length; setTimeout(ask, 700) }
  }
  row.appendChild(b)
})
ask()
</script>
`

const bio = `
<h1>生物 · 光合作用</h1>
<p class="hint">按顺序点三步。点错会退回。</p>
<div class="row" id="steps"></div>
<p id="bio-out" class="muted"></p>
<script>
const seq = [
  { id:'light', n:'光反应', d:'类囊体：水裂解，ATP / NADPH。' },
  { id:'calvin', n:'卡尔文循环', d:'基质：CO₂ 固定成果糖。' },
  { id:'sugar', n:'糖运出', d:'蔗糖进入韧皮部。' }
]
let expect = 0
const row = document.getElementById('steps')
const out = document.getElementById('bio-out')
seq.forEach((s, i) => {
  const b = document.createElement('button')
  b.textContent = s.n
  b.onclick = () => {
    if (i === expect) {
      expect++
      out.textContent = s.d
      b.dataset.primary = '1'
      if (expect === seq.length) out.textContent = '通路走完：光 → 碳固定 → 输出。'
    } else {
      expect = 0
      out.textContent = '顺序不对，从光反应再来。'
      row.querySelectorAll('button').forEach((x) => delete x.dataset.primary)
    }
  }
  row.appendChild(b)
})
out.textContent = '从光反应开始。'
</script>
`

const p5js = `
<h1>p5.js · 粒子泉</h1>
<p class="hint">指针在画布上，粒子跟着喷。</p>
<div id="p5host"></div>
<script type="module">
import p5 from 'https://esm.sh/p5@1'
const host = document.getElementById('p5host')
new p5((s) => {
  const bits = []
  s.setup = () => {
    const c = s.createCanvas(Math.min(host.clientWidth || 360, 480), 240)
    c.parent(host)
    s.noStroke()
  }
  s.draw = () => {
    s.background(27, 27, 29)
    if (s.mouseX > 0) bits.push({ x:s.mouseX, y:s.mouseY, vx:s.random(-1.2,1.2), vy:s.random(-3,-1), a:255 })
    for (let i=bits.length-1;i>=0;i--) {
      const p = bits[i]
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.a -= 4
      s.fill(94, 234, 212, p.a)
      s.circle(p.x, p.y, 5)
      if (p.a <= 0) bits.splice(i,1)
    }
    if (bits.length > 220) bits.splice(0, bits.length-220)
  }
}, host)
</script>
`

const three = `
<h1>three.js · 二十面体</h1>
<p class="hint">拖动画布旋转。线框跟着指针。</p>
<div id="t3" style="height:280px;border-radius:12px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--border)"></div>
<script type="module">
import * as THREE from 'https://esm.sh/three@0.170.0'
const host = document.getElementById('t3')
const w = host.clientWidth || 360, h = 280
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1b1b1d)
const camera = new THREE.PerspectiveCamera(42, w/h, 0.1, 20)
camera.position.z = 4
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(w, h)
host.appendChild(renderer.domElement)
const geo = new THREE.IcosahedronGeometry(1.1, 0)
const mesh = new THREE.Mesh(
  geo,
  new THREE.MeshStandardMaterial({ color: 0x5eead4, flatShading: true, metalness: 0.2, roughness: 0.45 })
)
scene.add(mesh)
scene.add(new THREE.AmbientLight(0xffffff, 0.55))
const dir = new THREE.DirectionalLight(0xffffff, 0.9)
dir.position.set(2, 2, 3)
scene.add(dir)
let drag = false, lx = 0, ly = 0
host.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY })
window.addEventListener('pointerup', () => { drag = false })
host.addEventListener('pointermove', (e) => {
  if (!drag) return
  mesh.rotation.y += (e.clientX - lx) * 0.01
  mesh.rotation.x += (e.clientY - ly) * 0.01
  lx = e.clientX; ly = e.clientY
})
;(function tick() {
  if (!drag) mesh.rotation.y += 0.006
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
})()
</script>
`

const d3js = `
<h1>d3.js · 力导向</h1>
<p class="hint">拖节点。学科之间的引用关系。</p>
<svg id="fg" width="100%" viewBox="0 0 420 260"></svg>
<script type="module">
import * as d3 from 'https://esm.sh/d3@7'
const nodes = [
  {id:'Math'}, {id:'Physics'}, {id:'Bio'}, {id:'Geo'},
  {id:'History'}, {id:'EN'}, {id:'ZH'}, {id:'CS'}
]
const links = [
  {source:'Math', target:'Physics'},
  {source:'Physics', target:'CS'},
  {source:'Bio', target:'Geo'},
  {source:'History', target:'ZH'},
  {source:'EN', target:'History'},
  {source:'CS', target:'Math'},
  {source:'Geo', target:'History'}
]
const svg = d3.select('#fg')
const sim = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(70))
  .force('charge', d3.forceManyBody().strength(-180))
  .force('center', d3.forceCenter(210, 130))
const link = svg.append('g').attr('stroke', '#73737b').selectAll('line').data(links).enter().append('line')
const node = svg.append('g').selectAll('g').data(nodes).enter().append('g')
  .call(d3.drag()
    .on('start', (e,d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y })
    .on('drag', (e,d) => { d.fx=e.x; d.fy=e.y })
    .on('end', (e,d) => { if (!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null }))
node.append('circle').attr('r', 14).attr('fill', '#5eead4')
node.append('text').text(d => d.id).attr('text-anchor','middle').attr('dy', 4).attr('font-size', 8).attr('fill', '#141416')
sim.on('tick', () => {
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y)
  node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')')
})
</script>
`

const text = `这是一间 \`app\` 画廊。状态机用 \`\`\`xstate\`，其它交互用 \`\`\`app\`。图标栏可以复制 / 下载 / 在窗口中查看。

- **XState** — \`\`\`xstate\` 围栏，图画在官方 [Stately Inspector](https://stately.ai/registry/inspect)。点状态栏下面的事件推进。
- **tldraw** — \`tldraw@3\` 真编辑器
- 教具 / p5 / three / d3 是自绘演示

### XState
${xstateFence(xstate)}

### tldraw
${fence(tldraw)}

### 数学
${fence(math)}

### 物理
${fence(physics)}

### 科学
${fence(science)}

### 地理
${fence(geo)}

### 历史
${fence(history)}

### English
${fence(english)}

### 语文
${fence(chinese)}

### 生物
${fence(bio)}

### p5.js
${fence(p5js)}

### three.js
${fence(three)}

### d3.js
${fence(d3js)}
`

const conv = {
  id,
  title: 'app 画廊',
  createdAt: now,
  updatedAt: now,
  workingDirectory: '/Users/oboo/repo/vav',
  model: 'deepseek-v4-pro',
  tokensUsed: 6400,
  tokenLimit: 200000,
  messages: [
    {
      id: userId,
      parentId: null,
      role: 'user',
      content:
        '用 ```xstate 官方 Inspector、真 tldraw，再加各科教具。',
      blocks: [
        {
          kind: 'text',
          text: '用 ```xstate 官方 Inspector、真 tldraw，再加各科教具。'
        }
      ],
      createdAt: now - 5000
    },
    {
      id: asstId,
      parentId: userId,
      role: 'assistant',
      content: text,
      blocks: [{ kind: 'text', text }],
      createdAt: now - 800
    }
  ],
  activeLeafId: asstId,
  tokenHistory: [],
  reportedSessionCostUsd: null,
  quotaWindows: [],
  cacheCreatedAt: null,
  cacheExpiresAt: null,
  pinned: true,
  pinTime: now,
  duplicateSourceId: null,
  duplicateSourceTitle: null,
  archived: false,
  archivedAt: null,
  approvalMode: 'auto',
  thinkingLevel: 'high',
  fileId: null,
  fileReadOnly: false,
  agentBinaryName: null,
  cliHost: null,
  cliResumeCursor: null,
  focusedFilePath: null,
  compactions: [],
  hostTranscripts: {}
}

writeFileSync(join(dir, `${id}.json`), JSON.stringify(conv))
const index = JSON.parse(readFileSync(indexPath, 'utf8'))
index.ids = [id, ...index.ids.filter((x) => x !== id)]
writeFileSync(indexPath, JSON.stringify(index))
console.log(id)
console.log('bytes', Buffer.byteLength(JSON.stringify(conv)))
