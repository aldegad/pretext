import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'
import pawUrl from '../assets/kuma-paw-tap.png'
import kumaFaceUrl from '../assets/kuma-face.png'

const BODY_FONT = '17px "Cormorant Garamond", Georgia, "Palatino Linotype", serif'
const BODY_LINE_HEIGHT = 30
const GUTTER = 40
const LOGO_SIZE = 100
const MIN_SLOT_WIDTH = 40
const PAW_OBSTACLE_RADIUS = 80
const RIPPLE_EXPAND_DURATION = 300
const RIPPLE_FADE_DURATION = 600
const RIPPLE_OBSTACLE_PEAK = 100
const TRAIL_MIN_DIST = 8
const DIVIDER_GAP = 20

const BODY_TEXT = `Kuma Picker는 Claude가 브라우저를 직접 조작할 수 있게 해주는 AI 에이전트 도구입니다. 화면에서 원하는 요소를 발바닥으로 찍으면, 쿠마가 그 위치를 정확히 인식하고 클릭, 입력, 스크롤 등 모든 브라우저 동작을 대신 수행합니다.

기존 브라우저 자동화 도구들은 DOM 셀렉터나 XPath에 의존합니다. 버튼 하나를 클릭하려면 개발자가 CSS 클래스나 ID를 직접 찾아서 넘겨줘야 합니다. 페이지 구조가 바뀌면 셀렉터가 깨지고, 동적으로 생성된 요소는 아예 잡기가 어렵습니다. Playwright나 Puppeteer가 강력하지만, 결국 코드로 DOM을 다뤄야 한다는 한계는 같습니다.

쿠마는 다르게 접근합니다. 화면에 보이는 것을 그대로 인식합니다. 텍스트든, 이미지든, 좌표든 — 사람이 눈으로 보고 클릭하는 방식과 똑같이 동작합니다. 셀렉터 없이도, DOM 구조를 몰라도 됩니다.

피킹 시스템이 핵심입니다. 브라우저 익스텐션이 페이지 위에 오버레이를 띄우고, Claude가 원하는 위치에 발바닥을 찍으면 해당 좌표와 요소 정보가 에이전트로 전달됩니다. 이 정보를 바탕으로 클릭, 드래그, 타이핑, 스크롤, 스크린샷 등을 수행합니다.

작업 카드 시스템으로 복잡한 자동화도 가능합니다. 여러 단계로 이루어진 작업을 카드 형태로 정의하면, 쿠마가 순서대로 실행합니다. 로그인 → 데이터 입력 → 결과 확인처럼 반복적인 플로우를 한 번만 정의해두면 됩니다.

발바닥 피드백은 단순한 귀여움이 아닙니다. 에이전트가 어디를 보고 있고, 무엇을 클릭했는지 시각적으로 확인할 수 있게 해주는 디버깅 인터페이스입니다. 뭔가 잘못됐을 때 쿠마가 어디를 찍었는지 바로 알 수 있습니다.

Kuma Picker is an AI agent tool that lets Claude control the browser directly. Tap the paw on any element on screen, and Kuma recognizes the exact position — then performs clicks, inputs, scrolling, and every other browser action on your behalf.

Traditional browser automation tools rely on DOM selectors and XPath. To click a single button, a developer has to find the CSS class or ID and pass it manually. When page structure changes, selectors break. Dynamically generated elements are even harder to target. Playwright and Puppeteer are powerful, but the fundamental limitation remains: you still have to manipulate the DOM through code.

Kuma takes a different approach. It recognizes what is visible on screen. Text, images, coordinates — it works exactly the way a human sees and clicks. No selectors needed. No DOM structure required.

The picking system is the core. A browser extension overlays the page, and when Claude taps the paw at the desired position, the coordinates and element information are sent to the agent. From there it performs clicks, drags, typing, scrolling, screenshots, and more.

The paw feedback is not just cute. It is a debugging interface that lets you visually confirm where the agent is looking and what it clicked. When something goes wrong, you can immediately see where Kuma tapped.`

type Interval = { left: number; right: number }

type PositionedLine = {
  x: number
  y: number
  width: number
  text: string
}

type CircleObstacle = {
  cx: number
  cy: number
  r: number
  hPad: number
  vPad: number
}

type RipplePhase = 'expanding' | 'held' | 'fading'

type Ripple = {
  trail: { x: number; y: number }[]
  phaseStart: number
  phase: RipplePhase
}

function resolveAssetUrl(assetUrl: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(assetUrl) || assetUrl.startsWith('data:') || assetUrl.startsWith('blob:')) {
    return assetUrl
  }
  if (assetUrl.startsWith('/')) {
    return new URL(assetUrl, window.location.origin).href
  }
  return new URL(assetUrl, import.meta.url).href
}

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLDivElement)) throw new Error('#stage not found')
const stageEl = stage

// --- paw cursor ---
const pawEl = document.createElement('img')
pawEl.className = 'paw'
pawEl.src = resolveAssetUrl(pawUrl)
pawEl.alt = 'Kuma paw'
pawEl.draggable = false
stageEl.appendChild(pawEl)

// --- logos (one per panel) ---
function createLogo(): HTMLImageElement {
  const el = document.createElement('img')
  el.className = 'kuma-logo'
  el.src = resolveAssetUrl(kumaFaceUrl)
  el.alt = 'Kuma'
  el.draggable = false
  el.style.width = `${LOGO_SIZE}px`
  el.style.height = `${LOGO_SIZE}px`
  stageEl.appendChild(el)
  return el
}
const leftLogoEl = createLogo()
const rightLogoEl = createLogo()

// --- panel labels ---
function createLabel(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'panel-label'
  el.textContent = text
  el.style.top = `${GUTTER}px`
  stageEl.appendChild(el)
  return el
}
const leftLabelEl = createLabel('Pretext')
const rightLabelEl = createLabel('Naive DOM')

// --- divider ---
const dividerEl = document.createElement('div')
dividerEl.className = 'divider'
stageEl.appendChild(dividerEl)

// --- ripple canvas ---
const rippleCanvas = document.createElement('canvas')
rippleCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50'
stageEl.appendChild(rippleCanvas)
const rippleCtx = rippleCanvas.getContext('2d')!

// --- FPS display ---
const fpsEl = document.createElement('div')
fpsEl.className = 'fps'
document.body.appendChild(fpsEl)

// --- naive DOM measurer ---
const naiveMeasurer = document.createElement('span')
naiveMeasurer.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${BODY_FONT}`
stageEl.appendChild(naiveMeasurer)

// --- state ---
const pointer = { x: -9999, y: -9999 }
const ripples: Ripple[] = []
let isPressed = false
let scheduledRaf = false

await document.fonts.ready
const prepared = prepareWithSegments(BODY_TEXT, BODY_FONT)

// --- tokenize text for naive approach (collapse newlines like white-space: normal) ---
const naiveTokens: string[] = []
{
  const normalized = BODY_TEXT.replace(/\n+/g, ' ')
  const words = normalized.split(/( +)/)
  for (const w of words) {
    if (w !== '') naiveTokens.push(w)
  }
}

// --- left panel line pool (pooled) ---
const leftPool: HTMLSpanElement[] = []

function syncLeftPool(count: number): void {
  while (leftPool.length < count) {
    const el = document.createElement('span')
    el.className = 'line'
    stageEl.appendChild(el)
    leftPool.push(el)
  }
  for (let i = 0; i < leftPool.length; i++) {
    leftPool[i]!.style.display = i < count ? '' : 'none'
  }
}

// --- right panel elements (no pooling) ---
let rightEls: HTMLSpanElement[] = []

// --- circle-band intersection ---
function circleIntervalForBand(
  cx: number, cy: number, r: number,
  bandTop: number, bandBottom: number,
  hPad: number, vPad: number,
): Interval | null {
  const top = bandTop - vPad
  const bottom = bandBottom + vPad
  if (top >= cy + r || bottom <= cy - r) return null
  const minDy = cy >= top && cy <= bottom ? 0 : cy < top ? top - cy : cy - bottom
  if (minDy >= r) return null
  const maxDx = Math.sqrt(r * r - minDy * minDy)
  return { left: cx - maxDx - hPad, right: cx + maxDx + hPad }
}

function carveSlots(base: Interval, blocked: Interval[]): Interval[] {
  let slots = [base]
  for (let i = 0; i < blocked.length; i++) {
    const interval = blocked[i]!
    const next: Interval[] = []
    for (let j = 0; j < slots.length; j++) {
      const slot = slots[j]!
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter(s => s.right - s.left >= MIN_SLOT_WIDTH)
}

// --- build ripple obstacles ---
function getRippleObstacles(now: number): CircleObstacle[] {
  const obstacles: CircleObstacle[] = []

  for (let i = 0; i < ripples.length; i++) {
    const ripple = ripples[i]!
    let expandT: number
    let strength: number
    if (ripple.phase === 'expanding') {
      const t = Math.min(1, (now - ripple.phaseStart) / RIPPLE_EXPAND_DURATION)
      expandT = 1 - (1 - t) * (1 - t)
      strength = 1
    } else if (ripple.phase === 'held') {
      expandT = 1
      strength = 1
    } else {
      const t = Math.min(1, (now - ripple.phaseStart) / RIPPLE_FADE_DURATION)
      if (t >= 1) continue
      expandT = 1 - t
      strength = 1 - t
    }

    const r = expandT * RIPPLE_OBSTACLE_PEAK
    const hPad = Math.round(20 * strength)
    const vPad = Math.round(8 * strength)
    const trail = ripple.trail

    if (trail.length <= 1) {
      obstacles.push({ cx: trail[0]!.x, cy: trail[0]!.y, r, hPad, vPad })
    } else {
      const step = Math.max(r * 0.6, 30)
      obstacles.push({ cx: trail[0]!.x, cy: trail[0]!.y, r, hPad, vPad })
      for (let j = 1; j < trail.length; j++) {
        const px = trail[j - 1]!.x
        const py = trail[j - 1]!.y
        const qx = trail[j]!.x
        const qy = trail[j]!.y
        const dx = qx - px
        const dy = qy - py
        const segDist = Math.sqrt(dx * dx + dy * dy)
        const segSteps = Math.max(1, Math.ceil(segDist / step))
        for (let s = 1; s <= segSteps; s++) {
          const st = s / segSteps
          obstacles.push({
            cx: px + dx * st,
            cy: py + dy * st,
            r, hPad, vPad,
          })
        }
      }
    }
  }

  return obstacles
}

// --- Pretext layout (canvas measurement, cached, pure math) ---
function pretextLayout(
  prep: PreparedTextWithSegments,
  regionX: number, regionY: number,
  regionW: number, regionH: number,
  lineHeight: number,
  obstacles: CircleObstacle[],
): PositionedLine[] {
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let lineTop = regionY
  const lines: PositionedLine[] = []

  while (lineTop + lineHeight <= regionY + regionH) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight
    const blocked: Interval[] = []
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i]!
      const interval = circleIntervalForBand(o.cx, o.cy, o.r, bandTop, bandBottom, o.hPad, o.vPad)
      if (interval !== null) blocked.push(interval)
    }
    const slots = carveSlots({ left: regionX, right: regionX + regionW }, blocked)
    if (slots.length === 0) { lineTop += lineHeight; continue }

    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si]!
      const line = layoutNextLine(prep, cursor, slot.right - slot.left)
      if (line === null) break
      lines.push({ x: Math.round(slot.left), y: Math.round(lineTop), width: line.width, text: line.text })
      cursor = line.end
    }

    if (layoutNextLine(prep, cursor, regionW) === null) break
    lineTop += lineHeight
  }

  return lines
}

// --- Naive DOM layout (offsetWidth measurement per word, no caching) ---
function naiveMeasureWidth(text: string): number {
  naiveMeasurer.textContent = text
  return naiveMeasurer.offsetWidth // forces reflow
}

function naiveLayout(
  regionX: number, regionY: number,
  regionW: number, regionH: number,
  lineHeight: number,
  obstacles: CircleObstacle[],
): PositionedLine[] {
  const lines: PositionedLine[] = []
  let lineTop = regionY
  let tidx = 0

  while (lineTop + lineHeight <= regionY + regionH && tidx < naiveTokens.length) {
    const blocked: Interval[] = []
    for (const o of obstacles) {
      const iv = circleIntervalForBand(o.cx, o.cy, o.r, lineTop, lineTop + lineHeight, o.hPad, o.vPad)
      if (iv) blocked.push(iv)
    }
    const slots = carveSlots({ left: regionX, right: regionX + regionW }, blocked)
    if (slots.length === 0) { lineTop += lineHeight; continue }

    for (const slot of slots) {
      if (tidx >= naiveTokens.length) break
      const maxW = slot.right - slot.left
      let lineText = ''

      while (tidx < naiveTokens.length) {
        const candidate = lineText + naiveTokens[tidx]!
        const w = naiveMeasureWidth(candidate)
        if (w > maxW && lineText.length > 0) break
        lineText = candidate
        tidx++
      }

      const trimmed = lineText.trimEnd()
      if (trimmed) {
        lines.push({
          x: Math.round(slot.left),
          y: Math.round(lineTop),
          width: naiveMeasureWidth(trimmed),
          text: trimmed,
        })
      }
    }

    lineTop += lineHeight
  }

  return lines
}

// --- render right panel (destroy & recreate every frame) ---
function renderNaiveLines(lines: PositionedLine[]): void {
  for (const el of rightEls) el.remove()
  rightEls = []

  for (const line of lines) {
    const el = document.createElement('span')
    el.className = 'line'
    el.style.left = `${line.x}px`
    el.style.top = `${line.y}px`
    el.style.font = BODY_FONT
    el.style.lineHeight = `${BODY_LINE_HEIGHT}px`
    el.textContent = line.text
    stageEl.appendChild(el)
    rightEls.push(el)
    void el.offsetWidth // force reflow per element
  }
}

// --- ripple drawing on canvas ---
function drawRipples(now: number, w: number, h: number): void {
  const dpr = window.devicePixelRatio || 1
  const cw = Math.round(w * dpr)
  const ch = Math.round(h * dpr)
  if (rippleCanvas.width !== cw || rippleCanvas.height !== ch) {
    rippleCanvas.width = cw
    rippleCanvas.height = ch
  }

  const ctx = rippleCtx
  ctx.clearRect(0, 0, cw, ch)
  ctx.save()
  ctx.scale(dpr, dpr)

  for (let i = ripples.length - 1; i >= 0; i--) {
    const ripple = ripples[i]!

    if (ripple.phase === 'expanding') {
      const t = (now - ripple.phaseStart) / RIPPLE_EXPAND_DURATION
      if (t >= 1) {
        ripple.phase = isPressed ? 'held' : 'fading'
        ripple.phaseStart = now
      }
    }

    let expandT: number
    let opacity: number
    if (ripple.phase === 'expanding') {
      const t = (now - ripple.phaseStart) / RIPPLE_EXPAND_DURATION
      expandT = 1 - (1 - t) * (1 - t)
      opacity = 1
    } else if (ripple.phase === 'held') {
      expandT = 1
      opacity = 1
    } else {
      const t = (now - ripple.phaseStart) / RIPPLE_FADE_DURATION
      if (t >= 1) {
        ripples.splice(i, 1)
        continue
      }
      expandT = 1 - t
      opacity = 1 - t
    }

    const diameter = (expandT * RIPPLE_OBSTACLE_PEAK + 20) * 2
    const trail = ripple.trail

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (trail.length <= 1) {
      const r = diameter / 2
      ctx.beginPath()
      ctx.arc(trail[0]!.x, trail[0]!.y, r, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255, 140, 50, 0.12)'
      ctx.lineWidth = 24
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(trail[0]!.x, trail[0]!.y, r, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255, 140, 50, 0.4)'
      ctx.lineWidth = 2
      ctx.stroke()
    } else {
      const path = new Path2D()
      path.moveTo(trail[0]!.x, trail[0]!.y)
      for (let j = 1; j < trail.length - 1; j++) {
        const mx = (trail[j]!.x + trail[j + 1]!.x) / 2
        const my = (trail[j]!.y + trail[j + 1]!.y) / 2
        path.quadraticCurveTo(trail[j]!.x, trail[j]!.y, mx, my)
      }
      path.lineTo(trail[trail.length - 1]!.x, trail[trail.length - 1]!.y)

      ctx.strokeStyle = 'rgba(255, 140, 50, 0.06)'
      ctx.lineWidth = diameter + 24
      ctx.stroke(path)

      ctx.strokeStyle = 'rgba(255, 140, 50, 0.3)'
      ctx.lineWidth = diameter
      ctx.stroke(path)

      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'black'
      ctx.lineWidth = Math.max(0, diameter - 4)
      ctx.stroke(path)
      ctx.globalCompositeOperation = 'source-over'
    }

    ctx.restore()
  }

  ctx.restore()
}

// --- FPS tracking ---
let fpsFrames = 0
let fpsAccLeft = 0
let fpsAccRight = 0
let fpsDisplayTime = performance.now()
let leftNeedsRender = true
let rightNeedsRender = true

// --- render ---
function render(now: number): void {
  scheduledRaf = false
  const W = document.documentElement.clientWidth
  const H = document.documentElement.clientHeight
  const halfW = W / 2
  const gutter = GUTTER
  const textTop = gutter + 28

  // paw position
  pawEl.style.left = `${pointer.x}px`
  pawEl.style.top = `${pointer.y}px`

  // draw ripples
  drawRipples(now, W, H)

  // shared ripple obstacles
  const rippleObs = getRippleObstacles(now)

  // --- LEFT: Pretext (only when cursor is on left side or ripples active) ---
  const cursorOnLeft = pointer.x > 0 && pointer.x < halfW
  const leftActive = cursorOnLeft || ripples.length > 0 || leftNeedsRender

  const leftX = gutter
  const leftW = halfW - gutter - DIVIDER_GAP / 2
  const regionH = H - textTop - gutter

  const leftLogoCx = leftX + leftW / 2
  const leftLogoCy = textTop + LOGO_SIZE / 2 + 10
  leftLogoEl.style.left = `${leftLogoCx - LOGO_SIZE / 2}px`
  leftLogoEl.style.top = `${leftLogoCy - LOGO_SIZE / 2}px`

  let t0 = performance.now()
  let t1 = t0
  if (leftActive) {
    const leftObs: CircleObstacle[] = [
      ...rippleObs,
      { cx: leftLogoCx, cy: leftLogoCy, r: LOGO_SIZE / 2 + 14, hPad: 14, vPad: 6 },
    ]
    if (cursorOnLeft) {
      leftObs.push({ cx: pointer.x, cy: pointer.y, r: PAW_OBSTACLE_RADIUS, hPad: 12, vPad: 4 })
    }

    const leftLines = pretextLayout(prepared, leftX, textTop, leftW, regionH, BODY_LINE_HEIGHT, leftObs)
    syncLeftPool(leftLines.length)
    for (let i = 0; i < leftLines.length; i++) {
      const line = leftLines[i]!
      const el = leftPool[i]!
      el.style.left = `${line.x}px`
      el.style.top = `${line.y}px`
      el.style.font = BODY_FONT
      el.style.lineHeight = `${BODY_LINE_HEIGHT}px`
      el.textContent = line.text
    }
    leftNeedsRender = false
    t1 = performance.now()
  }

  // --- RIGHT: Naive DOM (only when cursor is on right side or ripples active) ---
  const cursorOnRight = pointer.x >= halfW && pointer.x > 0
  const rightActive = cursorOnRight || ripples.length > 0 || rightNeedsRender

  const rightX = halfW + DIVIDER_GAP / 2
  const rightW = halfW - gutter - DIVIDER_GAP / 2

  const rightLogoCx = rightX + rightW / 2
  const rightLogoCy = textTop + LOGO_SIZE / 2 + 10
  rightLogoEl.style.left = `${rightLogoCx - LOGO_SIZE / 2}px`
  rightLogoEl.style.top = `${rightLogoCy - LOGO_SIZE / 2}px`

  let t2 = t1
  if (rightActive) {
    const rightObs: CircleObstacle[] = [
      ...rippleObs,
      { cx: rightLogoCx, cy: rightLogoCy, r: LOGO_SIZE / 2 + 14, hPad: 14, vPad: 6 },
    ]
    if (cursorOnRight) {
      rightObs.push({ cx: pointer.x, cy: pointer.y, r: PAW_OBSTACLE_RADIUS, hPad: 12, vPad: 4 })
    }

    const rightLines = naiveLayout(rightX, textTop, rightW, regionH, BODY_LINE_HEIGHT, rightObs)
    renderNaiveLines(rightLines)
    rightNeedsRender = false

    t2 = performance.now()
  }

  // --- UI chrome ---
  dividerEl.style.left = `${halfW}px`
  dividerEl.style.top = '0'
  leftLabelEl.style.left = `${halfW / 2}px`
  leftLabelEl.style.top = `${gutter}px`
  rightLabelEl.style.left = `${halfW + halfW / 2}px`
  rightLabelEl.style.top = `${gutter}px`

  // --- FPS ---
  fpsFrames++
  fpsAccLeft += t1 - t0
  fpsAccRight += t2 - t1
  if (now - fpsDisplayTime >= 500) {
    const fps = Math.round(fpsFrames * 1000 / (now - fpsDisplayTime))
    const avgL = (fpsAccLeft / fpsFrames).toFixed(2)
    const avgR = (fpsAccRight / fpsFrames).toFixed(2)
    fpsEl.textContent = `${fps} FPS  |  Pretext: ${avgL}ms  |  DOM: ${avgR}ms`
    fpsFrames = 0
    fpsAccLeft = 0
    fpsAccRight = 0
    fpsDisplayTime = now
  }

  // keep animating
  if (ripples.some(r => r.phase !== 'held')) {
    scheduleRender()
  }
}

function scheduleRender(): void {
  if (scheduledRaf) return
  scheduledRaf = true
  requestAnimationFrame(render)
}

// --- events ---
function pushTrailPoint(x: number, y: number): void {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i]!
    if (r.phase === 'expanding' || r.phase === 'held') {
      const trail = r.trail
      const last = trail[trail.length - 1]!
      const dx = x - last.x
      const dy = y - last.y
      if (dx * dx + dy * dy >= TRAIL_MIN_DIST * TRAIL_MIN_DIST) {
        trail.push({ x, y })
      }
      break
    }
  }
}

document.addEventListener('mousemove', e => {
  pointer.x = e.clientX
  pointer.y = e.clientY
  if (isPressed) pushTrailPoint(e.clientX, e.clientY)
  scheduleRender()
})

document.addEventListener('touchmove', e => {
  const touch = e.touches[0]
  if (touch) {
    pointer.x = touch.clientX
    pointer.y = touch.clientY
    if (isPressed) pushTrailPoint(touch.clientX, touch.clientY)
    scheduleRender()
  }
}, { passive: true })

document.addEventListener('mousedown', e => {
  isPressed = true
  pawEl.classList.add('paw--pressed')
  ripples.push({
    trail: [{ x: e.clientX, y: e.clientY }],
    phaseStart: performance.now(),
    phase: 'expanding',
  })
  scheduleRender()
})

document.addEventListener('mouseup', () => {
  isPressed = false
  pawEl.classList.remove('paw--pressed')
  const now = performance.now()
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i]!
    if (r.phase === 'held' || r.phase === 'expanding') {
      r.phase = 'fading'
      r.phaseStart = now
    }
  }
  scheduleRender()
})

document.addEventListener('touchstart', e => {
  const touch = e.touches[0]
  if (touch) {
    isPressed = true
    pointer.x = touch.clientX
    pointer.y = touch.clientY
    pawEl.classList.add('paw--pressed')
    ripples.push({
      trail: [{ x: touch.clientX, y: touch.clientY }],
      phaseStart: performance.now(),
      phase: 'expanding',
    })
    scheduleRender()
  }
}, { passive: true })

document.addEventListener('touchend', () => {
  isPressed = false
  pawEl.classList.remove('paw--pressed')
  const now = performance.now()
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i]!
    if (r.phase === 'held' || r.phase === 'expanding') {
      r.phase = 'fading'
      r.phaseStart = now
    }
  }
  scheduleRender()
}, { passive: true })

window.addEventListener('mouseleave', () => {
  pointer.x = -9999
  pointer.y = -9999
  scheduleRender()
})

window.addEventListener('resize', () => {
  leftNeedsRender = true
  rightNeedsRender = true
  scheduleRender()
})

// initial render
scheduleRender()
