import { clawdRects, colEdge, ORANGE, W } from './clawd'
import type { HatPhase, Step } from './clawd'

// ── 桌面版整列一張圖 ─────────────────────────────────────────────
// 桌面 App 不讓 Box 真的浮起來：Clawd 一移動就把橘框推走（2026-11-23 使用者回報）。
// 所以把 Clawd、狀態字、橘框、額度全畫進同一張固定大小的 SVG，框與字座標寫死，
// Clawd 只在圖裡移動，經過橘框時畫在框的上層（從框前面跑過）。

export const BAND_W = 700
export const BAND_H = 66

const PX = 2.5 // Clawd 每格 2.5 像素，40 x 20
const CLAWD_W = Math.round(W * PX)
const CLAWD_H = 20
const JUMP_PX = 5
const STEP_PX = 9 // 每一步 9 像素（每 0.18 秒一步，約每秒 50 像素）
const HOME_X = 4
// Clawd 腳底的高度；上面留給帽子（約 13 像素）與跳躍（10 像素）
const GROUND = 48
const CLAWD_TOP = GROUND - CLAWD_H
const MOOD_Y = 62

// 橘框與欄位的固定座標
const BOX = { x: 56, y: 15, w: 300, h: 44 }
const COL = { label: 66, bar: 112, barW: 80, percentRight: 232, detail: 242 }
const ROW_Y = [33, 51]
const FONT = "Consolas,'Microsoft JhengHei','PingFang TC',monospace"

/** Clawd 最遠能跑幾步：跑到圖的最右邊 */
export const MAX_STEPS = Math.floor((BAND_W - HOME_X - CLAWD_W - 1) / STEP_PX)

// 帽子：藍色禮帽，帽簷 10 格寬、帽身 6 格寬 4 格高（以 Clawd 的格子計）
const HAT_BLUE = '#4F7CEB'
const HAT_BAND = '#F2F2F2'

export type BandRow = { label: string; percent: number; detail: string; color?: string }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toneColor(color: string | undefined): string {
  if (color === 'red') return '#E5534B'
  if (color === 'yellow') return '#D4A72C'

  return '#BBBBBB'
}

/** 框與文字：不含 Clawd 與帽子，每一格都一模一樣 */
export function bandStatic(rows: BandRow[], mood: string): string {
  let s = `<rect x="${BOX.x}" y="${BOX.y}" width="${BOX.w}" height="${BOX.h}" rx="8" fill="none" stroke="${ORANGE}" stroke-width="1"/>`
  if (rows.length === 0) {
    s += `<text x="${BOX.x + 10}" y="${BOX.y + 26}" font-family="${FONT}" font-size="12" fill="#999999">等第一輪回覆後顯示額度</text>`
  }
  rows.slice(0, 2).forEach((r, i) => {
    const y = ROW_Y[i] ?? 0
    const fillW = Math.round((Math.max(0, Math.min(100, r.percent)) / 100) * COL.barW)
    const c = toneColor(r.color)
    s += `<text x="${COL.label}" y="${y}" font-family="${FONT}" font-size="12" fill="#CCCCCC">${esc(r.label)}</text>`
    s += `<rect x="${COL.bar}" y="${y - 9}" width="${COL.barW}" height="9" fill="#4A4A4A"/>`
    s += `<rect x="${COL.bar}" y="${y - 9}" width="${fillW}" height="9" fill="${c}"/>`
    s += `<text x="${COL.percentRight}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="12" fill="${c}">${Math.round(r.percent)}%</text>`
    s += `<text x="${COL.detail}" y="${y}" font-family="${FONT}" font-size="12" fill="#999999">${esc(r.detail)}</text>`
  })
  s += `<text x="${HOME_X}" y="${MOOD_Y}" font-family="${FONT}" font-size="11" fill="${ORANGE}">${esc(mood)}</text>`

  return s
}

/** 一頂帽子，帽簷左緣在 (left, bottom)，bottom 是帽簷底；rotate 為繞帽子中心的角度 */
function hatSvg(left: number, bottom: number, rotate: number): string {
  const brimL = Math.round(left) + colEdge(3, PX)
  const brimR = Math.round(left) + colEdge(13, PX)
  const crownL = Math.round(left) + colEdge(5, PX)
  const crownR = Math.round(left) + colEdge(11, PX)
  const b = Math.round(bottom)
  const brimH = Math.round(PX)
  const crownH = Math.round(4 * PX)
  const bandH = Math.round(PX)
  const cx = (brimL + brimR) / 2
  const cy = b - (brimH + crownH) / 2

  return (
    `<g transform="rotate(${rotate} ${cx} ${cy})">` +
    `<rect x="${brimL}" y="${b - brimH}" width="${brimR - brimL}" height="${brimH}" fill="${HAT_BLUE}"/>` +
    `<rect x="${crownL}" y="${b - brimH - crownH}" width="${crownR - crownL}" height="${crownH}" fill="${HAT_BLUE}"/>` +
    `<rect x="${crownL}" y="${b - brimH - bandH}" width="${crownR - crownL}" height="${bandH}" fill="${HAT_BAND}"/>` +
    `</g>`
  )
}

/** 帽子這一格畫在哪：掉下來、戴著、往後翻落、落在地上 */
function hatAt(phase: HatPhase, clawdX: number, clawdTop: number): string {
  // 戴在頭上時，帽簷底貼著頭頂
  if (phase <= 0) return hatSvg(clawdX, clawdTop + (phase === 0 ? 0 : phase * 4), 0)
  // 往後（往左）翻落，最後端正落在地上，位置固定在跑到最遠處的左邊
  const farX = HOME_X + MAX_STEPS * STEP_PX
  if (phase === 1) return hatSvg(farX - 6, CLAWD_TOP - 4, -25)
  if (phase === 2) return hatSvg(farX - 16, CLAWD_TOP + 8, -70)

  return hatSvg(farX - 26, GROUND, 0)
}

/** 整列一張圖：框與文字固定，Clawd 依 step 畫在第幾步、跳多高，帽子依階段畫 */
export function bandSvg(rows: BandRow[], mood: string, step: Step, frame: number, isWorking: boolean): string {
  const x = HOME_X + Math.min(step.p, MAX_STEPS) * STEP_PX
  const top = CLAWD_TOP - step.y * JUMP_PX
  const clawd = clawdRects(PX, x, top, step.pose, frame, isWorking ? step.dir : 0)
  const hat = step.hat === undefined ? '' : hatAt(step.hat, x, top)
  // 落在地上的帽子畫在 Clawd 後面（Clawd 跑回去時從帽子前面經過）；戴著或在空中的畫在前面
  const behind = step.hat === 3 ? hat : ''
  const front = step.hat !== undefined && step.hat !== 3 ? hat : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAND_W}" height="${BAND_H}" viewBox="0 0 ${BAND_W} ${BAND_H}" shape-rendering="crispEdges" text-rendering="geometricPrecision">` +
    `<rect width="${BAND_W}" height="${BAND_H}" fill="${ORANGE}" fill-opacity="0"/>` +
    bandStatic(rows, mood) +
    // Clawd 最後畫，疊在框的上面：從框前面跑過
    `<g>${behind}${clawd}${front}</g>` +
    `</svg>`
  )
}
