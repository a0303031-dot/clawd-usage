import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionCost, SessionRateLimit, Timer } from 'claude-code'

import type { Limit, Usage } from '../types'

import { clawdBlocks, HOME, ORANGE, pathAt, W } from './clawd'
import type { Step } from './clawd'
import { BAND_H, BAND_W, bandSvg, MAX_STEPS } from './band'
import type { BandRow } from './band'

// Clawd 佔幾個字元格寬（終端機就是 16 欄；桌面版整列畫成一張圖，見 band.ts）
const CLAWD_CELLS = { desktop: 6, terminal: W }
// 每 0.18 秒走半格（桌面約每秒 22 像素）
const TICK_MS = 180

// 終端機：Clawd 佔 5 列（4 列身體＋跳起來的 1 列）
function clawdRows(step: Step | undefined, frame: number): string[] {
  const blank = ' '.repeat(W)
  const rows = [blank, blank, blank, blank, blank]
  if (!step) return rows
  const top = step.y > 0 ? 0 : 1
  clawdBlocks(step.pose, frame, step.dir).forEach((line, i) => {
    rows[top + i] = line
  })

  return rows
}

const usageAtom = atom({ plugin: 'clawd-usage', key: 'usage' } as const, null)
const toolAtom = atom({ plugin: 'clawd-usage', key: 'isTool' } as const, false)
const frameAtom = atom({ plugin: 'clawd-usage', key: 'frame' } as const, 0)


const LABELS: Record<string, string> = {
  five_hour: '5 小時',
  seven_day: '7 天',
  spend_limit: '花費上限',
}

function toUsage(context: SessionContextUsage, rateLimits: SessionRateLimit[], cost?: SessionCost): Usage {
  const limits: Limit[] = rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))

  return {
    contextTokens: context.tokens,
    contextWindow: context.window,
    contextPercent: context.percent,
    limits,
    usd: cost?.usd,
  }
}

function bar(percent: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))

  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

function tone(percent: number): string | undefined {
  if (percent >= 90) return 'red'
  if (percent >= 70) return 'yellow'

  return undefined
}

export function untilReset(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  // 固定長度：時、分一律兩位（補數字寬的空白或 0），數字變了字數也不變，框裡的字不會挪動
  if (h >= 24) return `${Math.floor(h / 24)}天${pad2(h % 24)}時後重設`

  return `${pad2(h)}時${String(m).padStart(2, '0')}分後重設`
}

// 數字寬的空白（U+2007）：跟一個數字一樣寬，不會被畫面吃掉
const FIGURE_SPACE = ' '
function pad2(n: number): string {
  return String(n).padStart(2, FIGURE_SPACE)
}

/** 百分比固定三位寬：「 9%」「49%」「100%」前面補數字寬的空白 */
export function percentText(p: number): string {
  return `${String(Math.round(p)).padStart(3, FIGURE_SPACE)}%`
}

export const register: Register = on => {
  let toolsRunning = 0
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      const u = await $.session.usage()
      await update($, usageAtom, () => toUsage(u.context, u.rateLimits, u.cost))
    } catch {
      // 拿不到就維持原狀，等下一次 session.measure
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usageAtom, () => toUsage(e.context, e.rateLimits, e.cost))

    return next(e)
  })

  // 回合開始：思考中；終端機版開始換格
  on('prompt.submit', async ($, e, next) => {
    toolsRunning = 0
    await update($, toolAtom, () => false)
    ticker?.cancel()
    // 每次開工都從左邊起點（第 0 格）出發，不接上一輪跑到一半的位置
    await update($, frameAtom, () => 0)
    ticker = $.clock.every(TICK_MS, () => {
      void update($, frameAtom, f => (f + 1) % 100000)
    })

    return next(e)
  })

  // 跑工具時：工作中
  on('tool.call', async ($, e, next) => {
    toolsRunning += 1
    await update($, toolAtom, () => true)
    try {
      return await next(e)
    } finally {
      toolsRunning = Math.max(0, toolsRunning - 1)
      if (toolsRunning === 0) await update($, toolAtom, () => false)
    }
  })

  on('turn.complete', async ($, e, next) => {
    ticker?.cancel()
    ticker = undefined
    await update($, frameAtom, () => 0)
    toolsRunning = 0
    await update($, toolAtom, () => false)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) {
      return next(e)
    }

    const usage = await read($, usageAtom)
    const isTool = await read($, toolAtom)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    const worst = Math.max(0, ...(usage?.limits ?? []).map(l => l.percentUsed))
    const mood = e.props.isWorking ? (isTool ? '工作中' : '思考中') : worst >= 90 ? '快滿了' : '待命'

    // 只顯示 5 小時與 7 天額度。每列拆成「標籤／進度條／說明」三欄，
    // 各欄自成一個直排 Box，中文標籤寬度不一也不會把進度條推歪。
    const rows = (usage?.limits ?? []).map(l => ({
      key: `lim-${l.kind}`,
      label: LABELS[l.kind] ?? l.kind,
      meter: `${bar(l.percentUsed)} ${percentText(l.percentUsed)}`,
      detail: untilReset(l.resetsAt, now),
      color: tone(l.percentUsed),
    }))

    const elements = $.ui.resolve(e)
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const cells = Svg !== undefined ? CLAWD_CELLS.desktop : CLAWD_CELLS.terminal

    // 待命時坐在原位；工作時從原位跑到右端再回頭（計時器推進 frame，只在工作時讀，待命不會重畫）
    const frame = e.props.isWorking ? await read($, frameAtom) : 0

    // 桌面：整列畫成一張固定大小的圖，框與字座標寫死，Clawd 只在圖裡移動，推不動任何東西
    if (Svg !== undefined) {
      const step: Step = e.props.isWorking ? pathAt(frame, MAX_STEPS) : HOME
      const bandRows: BandRow[] = (usage?.limits ?? []).map(l => ({
        label: LABELS[l.kind] ?? l.kind,
        percent: l.percentUsed,
        detail: untilReset(l.resetsAt, now).replace(/ /g, ' ').trim(),
        color: tone(l.percentUsed),
      }))
      const alt = [mood, ...bandRows.map(r => `${r.label} ${Math.round(r.percent)}% ${r.detail}`)].join('，')

      return <Svg key="band" source={bandSvg(bandRows, mood, step, frame, e.props.isWorking)} alt={alt} width={BAND_W} height={BAND_H} />
    }

    const maxP = Math.max(0, 2 * (e.props.bodyColumns - cells - 1))
    const step: Step = e.props.isWorking ? pathAt(frame, maxP) : HOME

    // 以下只剩終端機：畫一隻 Clawd（here 為空時是同樣大小的空位）
    const drawClawd = (key: string, here: Step | undefined) => {
      return (
        <Box key={key} flexDirection="column">
          {clawdRows(here, frame).map((row, i) => (
            <Text key={`${key}${i}`} color={ORANGE} mono>
              {row}
            </Text>
          ))}
        </Box>
      )
    }

    // 每欄設最小寬度（字元格），內容長短變化也不會讓後面的欄位挪動
    const column = (key: string, pick: (r: (typeof rows)[number]) => string, isDim: boolean, minWidth: number) => (
      <Box key={key} flexDirection="column" minWidth={minWidth} flexShrink={0}>
        {rows.map(r => (
          <Text key={`${key}-${r.key}`} color={r.color} dimColor={isDim || r.color === undefined} mono tabular wrap="end">
            {pick(r)}
          </Text>
        ))}
      </Box>
    )

    // 版面：[定位點] [原位＋狀態字] [橘框：額度]，原位與橘框位置固定、不縮。
    // 工作時原位留空，Clawd 改畫在浮動 Box，用 left（字元格）從原位往右跑。
    // 浮動 Box 掛在列首寬高都是 0 的定位點裡：left 從原位算起，而且推不動任何東西。
    // 橘框沒有定位也沒有底色，浮動的 Clawd 會畫在它上面，從框前面跑過去。
    return (
      <Box flexDirection="row" alignItems="flex-start">
        <Box key="anchor" width={0} height={0} flexShrink={0}>
          {e.props.isWorking ? (
            <Box key="runner" position="absolute" top={0} left={Math.floor(step.p / 2)}>
              {drawClawd('runner-clawd', step)}
            </Box>
          ) : null}
        </Box>
        <Box key="home" flexDirection="column" width={cells} flexShrink={0}>
          {drawClawd('home-clawd', e.props.isWorking ? undefined : HOME)}
          <Text key="mood" color={ORANGE} size="caption">
            {mood}
          </Text>
        </Box>
        <Box key="box" flexDirection="column" flexShrink={0} borderStyle="round" borderColor={ORANGE} paddingX={1}>
          {rows.length === 0 ? (
            <Text key="wait" dimColor>
              等第一輪回覆後顯示額度
            </Text>
          ) : (
            <Box key="table" flexDirection="row" gap={1}>
              {column('label', r => r.label, false, 6)}
              {column('meter', r => r.meter, false, 15)}
              {column('detail', r => r.detail, true, 14)}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
