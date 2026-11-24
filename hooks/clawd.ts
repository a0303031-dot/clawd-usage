export const ORANGE = '#D77757'
const EYE = '#1A1A1A'

// ── Clawd 像素圖：16 x 8，左右對稱（第 c 欄對第 15-c 欄）────────────────
// 動畫不靠 SVG 的 CSS：App 會一直重畫這個框，圖片一重載 CSS 動畫就回到起點。
// 改由計時器推進 frame，每一格算出 Clawd 在哪、腳怎麼擺，畫成靜態圖。
export type Pose = 'idle' | 'run'

export const W = 16
export const H = 8
// 身體：頭、帶兩側小手的中段、下身，各兩列
const BODY: [number, number, number, number][] = [
  // [x, y, 寬, 高]
  [2, 0, 12, 2],
  [0, 2, 16, 2],
  [2, 4, 12, 2],
]
const EYES = [4, 11] // 直條眼睛，佔第 1、2 列
const LEGS_A = [3, 10] // 跑步時與 B 組輪流抬腳
const LEGS_B = [5, 12]

/** Clawd 的像素格：0 空、1 身體、2 眼睛。eyeDx 讓眼睛看前進方向。 */
export function clawdGrid(pose: Pose, frame: number, eyeDx: number = 0): number[][] {
  const grid: number[][] = Array.from({ length: H }, () => Array<number>(W).fill(0))
  const fill = (x: number, y: number, w: number, h: number, v: number) => {
    for (let j = y; j < y + h; j++) {
      const row = grid[j]
      if (row) for (let i = x; i < x + w; i++) row[i] = v
    }
  }
  BODY.forEach(([x, y, w, h]) => fill(x, y, w, h, 1))
  EYES.forEach(x => fill(x + eyeDx, 1, 1, 2, 2))
  const lifted = pose === 'run' ? (frame % 2 === 0 ? LEGS_A : LEGS_B) : []
  ;[...LEGS_A, ...LEGS_B].forEach(x => fill(x, 6, 1, lifted.includes(x) ? 1 : 2, 1))

  return grid
}

/** 終端機：半格方塊字元，一列字畫兩列像素，共 4 列 16 欄；眼睛留空。 */
export function clawdBlocks(pose: Pose, frame: number, eyeDx: number = 0): string[] {
  const grid = clawdGrid(pose, frame, eyeDx)
  const lines: string[] = []
  for (let y = 0; y < H; y += 2) {
    let s = ''
    for (let x = 0; x < W; x++) {
      const top = grid[y]?.[x] === 1
      const bottom = grid[y + 1]?.[x] === 1
      s += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }
    lines.push(s)
  }

  return lines
}

/**
 * 帽子的階段：-3、-2、-1 從上面往下掉（離頭 3、2、1 格高），0 戴在頭上，
 * 1、2 往後翻落，3 落在地上（之後 Clawd 跑回去，帽子留在原地）。沒有這個欄位就是沒帽子。
 */
export type HatPhase = -3 | -2 | -1 | 0 | 1 | 2 | 3

/** Clawd 這一格在哪：離原位幾步（p）、跳多高（y）、面向哪邊、腳怎麼擺、帽子在哪個階段。 */
export type Step = { p: number; y: number; dir: 1 | -1; pose: Pose; hat?: HatPhase }

export const HOME: Step = { p: 0, y: 0, dir: 1, pose: 'idle' }

/** 跑到最遠處之後、回頭之前的格數：帽子掉下來 4 格、跳三下 12 格、帽子翻落 3 格 */
export const SHOW_FRAMES = 4 + 12 + 3

/**
 * 路線：從原位往右跑，從橘框前面經過，跑到最旁邊 → 帽子從天而降戴上 → 戴著帽子跳三下 →
 * 帽子往後掉到地上 → 回頭跑回原位（帽子留在地上）→ 轉身，再來一輪。
 * maxP 是最遠能跑幾步。
 */
export function pathAt(frame: number, maxP: number): Step {
  const steps: Step[] = []
  for (let p = 0; p <= maxP; p++) steps.push({ p, y: 0, dir: 1, pose: 'run' })
  for (const hat of [-3, -2, -1, 0] as const) steps.push({ p: maxP, y: 0, dir: 1, pose: 'idle', hat })
  for (let j = 0; j < 3; j++) for (const y of [1, 2, 1, 0]) steps.push({ p: maxP, y, dir: 1, pose: 'idle', hat: 0 })
  for (const hat of [1, 2, 3] as const) steps.push({ p: maxP, y: 0, dir: 1, pose: 'idle', hat })
  for (let k = 0; k < 2; k++) steps.push({ p: maxP, y: 0, dir: -1, pose: 'idle', hat: 3 })
  for (let p = maxP; p >= 0; p--) steps.push({ p, y: 0, dir: -1, pose: 'run', hat: 3 })
  for (let k = 0; k < 2; k++) steps.push({ p: 0, y: 0, dir: 1, pose: 'idle' })

  return steps[((frame % steps.length) + steps.length) % steps.length] ?? HOME
}

/** 第 i 條欄格線的整數像素位置，左半從左算、右半從右算，左右對稱。 */
export function colEdge(i: number, px: number): number {
  return i <= W / 2 ? Math.round(i * px) : Math.round(W * px) - Math.round((W - i) * px)
}

/** 把 Clawd 畫成一串 SVG rect，左上角在 (left, top) 像素。 */
export function clawdRects(px: number, left: number, top: number, pose: Pose, frame: number, eyeDx: number): string {
  let rects = ''
  clawdGrid(pose, frame, eyeDx).forEach((row, y) => {
    // 同一列連續同色的像素合成一個 rect，圖比較小
    let x = 0
    while (x < row.length) {
      const v = row[x] ?? 0
      let end = x
      while (end < row.length && row[end] === v) end++
      if (v !== 0) {
        // px 可以是小數（例如 2.5），格線取整數像素圖才不會糊；
        // 欄的格線從左右兩端鏡像算，左眼右眼、左腳右腳才會一樣寬
        const x0 = Math.round(left) + colEdge(x, px)
        const x1 = Math.round(left) + colEdge(end, px)
        const y0 = Math.round(top) + Math.round(y * px)
        const y1 = Math.round(top) + Math.round((y + 1) * px)
        rects += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${v === 2 ? EYE : ORANGE}"/>`
      }
      x = end
    }
  })

  return rects
}

/**
 * 桌面版：一條跑道的靜態 SVG，寬 width、高 height 像素。
 * clawd 有值時把 Clawd 畫在第 x 像素、往上跳 lift 像素的位置；沒有就是空跑道。
 */
export function laneSvg(
  width: number,
  height: number,
  px: number,
  clawd?: { x: number; lift: number; pose: Pose; frame: number; eyeDx: number },
): string {
  const rects = clawd ? clawdRects(px, clawd.x, height - H * px - clawd.lift, clawd.pose, clawd.frame, clawd.eyeDx) : ''

  // 墊一塊透明底：Clawd 跑開時原位留空，圖也照樣佔同樣大小，旁邊的框不會被擠動
  const base = `<rect width="${width}" height="${height}" fill="${ORANGE}" fill-opacity="0"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${base}${rects}</svg>`
}
