import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { clawdBlocks, colEdge, laneSvg, pathAt, SHOW_FRAMES } from './clawd'
import { percentText, untilReset } from './register'
import { BAND_H, BAND_W, bandSvg, MAX_STEPS } from './band'

// 數字寬的空白（U+2007）
const FIGURE = String.fromCharCode(0x2007)

test('百分比與重設時間固定長度，數字變了框裡的字也不挪動', () => {
  expect(new Set([0, 9, 49, 100].map(p => percentText(p).length)).size).toBe(1)
  expect(percentText(23.5)).toBe(`${FIGURE}24%`)
  const at = (mins: number) => untilReset(new Date(mins * 60000).toISOString(), 0)
  // 5 小時窗：0 分到 4 時 59 分都一樣長
  const short = [5, 59, 65, 179, 299].map(at)
  expect(new Set(short.map(s => s.length)).size).toBe(1)
  expect(at(5)).toBe(`${FIGURE}0時05分後重設`)
  // 7 天窗：時數一位或兩位都一樣長
  expect(at(4 * 1440 + 2 * 60).length).toBe(at(4 * 1440 + 12 * 60).length)
})

const BAND = {
  plugin: 'clawd-usage',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

async function seed($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  on('clock.now', () => ({ value: 0 }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 84000, window: 200000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 63 }],
      cost: { usd: 1.234 },
    },
  }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

test('桌面版：Clawd 坐在框左原位，只列額度，不列 Context 與費用', async ($, on) => {
  await seed($, on)

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // 整列只有一張固定大小的圖：Clawd、狀態字、橘框、額度都在裡面
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(1)
    expect(svgs[0]?.props.width).toBe(BAND_W)
    expect(svgs[0]?.props.height).toBe(BAND_H)
    const source = String(svgs[0]?.props.source ?? '')
    expect(source).toContain('>5 小時<')
    expect(source).toContain('>63%<')
    expect(source).toContain('>待命<')
    expect(source).not.toMatch(/Context|42%|84k|費用|US\$/)
    expect(await ui.find({ type: 'Box' })).toBeUndefined()
    await ui.unmount()
  }
})

test('框與字固定：Clawd 跑到任何位置，框與文字的部分一字不差', () => {
  const rows = [
    { label: '5 小時', percent: 49, detail: '2時59分後重設' },
    { label: '7 天', percent: 24, detail: '4天2時後重設' },
  ]
  const withoutClawd = (svg: string) => svg.replace(/<g>.*<\/g>/, '')
  const base = withoutClawd(bandSvg(rows, '工作中', { p: 0, y: 0, dir: 1, pose: 'run' }, 0, true))
  for (let f = 0; f < 400; f += 7) {
    const step = pathAt(f, MAX_STEPS)
    const svg = bandSvg(rows, '工作中', step, f, true)
    expect(withoutClawd(svg)).toBe(base)
  }
  // Clawd 畫在框之後，所以疊在框上面：從框前面跑過
  const svg = bandSvg(rows, '工作中', { p: 20, y: 0, dir: 1, pose: 'run' }, 0, true)
  expect(svg.indexOf('<g>')).toBeGreaterThan(svg.indexOf('stroke="#D77757"'))
  // 跑到最遠也不超出圖的右邊
  const far = bandSvg(rows, '工作中', { p: MAX_STEPS, y: 0, dir: 1, pose: 'run' }, 0, true)
  const xs = [...far.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"[^>]*fill="#(?:D77757|1A1A1A)"\/>/g)].map(m => Number(m[1]) + Number(m[2]))
  expect(Math.max(...xs)).toBeLessThanOrEqual(BAND_W)
})

test('終端機：Clawd 用方塊字元畫在框左', async ($, on) => {
  await seed($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^ +██████████/ }))?.text).toBeTruthy()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('狀態字：待命、思考中、跑工具時工作中', async ($, on) => {
  let measureDuring = false
  let during: string | undefined
  on('tool.call', async () => {
    if (measureDuring) during = await mood(true)

    return { result: {} }
  })
  await seed($, on)

  const mood = async (isWorking: boolean) => {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking }, surface: 'desktop' })
    // 狀態字是圖的替代文字開頭
    const alt = String((await ui.find({ type: 'Svg' }))?.props.alt ?? '')
    await ui.unmount()

    return alt.split('，')[0]
  }

  expect(await mood(false)).toBe('待命')
  expect(await mood(true)).toBe('思考中')
  measureDuring = true
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  measureDuring = false
  expect(during).toBe('工作中')
  expect(await mood(true)).toBe('思考中')
})

test('路線：跑到最旁邊 → 帽子掉下來戴上 → 戴著跳三下 → 帽子掉了 → 回頭', () => {
  const M = 6
  const all = Array.from({ length: 120 }, (_, f) => pathAt(f, M))

  expect(all[0]).toEqual({ p: 0, y: 0, dir: 1, pose: 'run' })
  expect(all[M]).toMatchObject({ p: M, dir: 1, pose: 'run' })
  expect(all[M]?.hat).toBeUndefined()
  // 帽子從上面掉下來，戴到頭上
  expect(all.slice(M + 1, M + 5).map(s => s.hat)).toEqual([-3, -2, -1, 0])
  // 戴著帽子跳三下
  const jumps = all.slice(M + 5, M + 17)
  expect(jumps.every(s => s.p === M && s.hat === 0)).toBe(true)
  expect(jumps.filter(s => s.y === 2).length).toBe(3)
  // 跳完帽子往後掉到地上，臉還朝右
  expect(all.slice(M + 17, M + 20).map(s => s.hat)).toEqual([1, 2, 3])
  expect(all[M + 19]?.dir).toBe(1)
  // 然後回頭跑回去，帽子留在地上
  expect(all[M + 20]).toMatchObject({ p: M, dir: -1, hat: 3 })
  expect(all[M + 22]).toMatchObject({ p: M, dir: -1, pose: 'run', hat: 3 })
  expect(all[M + 22 + M]).toMatchObject({ p: 0, dir: -1 })
  const cycle = (M + 1) * 2 + SHOW_FRAMES + 2 + 2
  // 回到原位帽子就不見了，然後重來
  expect(all[cycle - 1]).toMatchObject({ p: 0, dir: 1, pose: 'idle' })
  expect(all[cycle - 1]?.hat).toBeUndefined()
  expect(all[cycle]).toEqual(all[0])
})

test('帽子：戴著時跟著 Clawd 跳，掉到地上後位置固定、不超出圖', () => {
  const rows = [{ label: '5 小時', percent: 49, detail: '' }]
  const hatXY = (svg: string) => svg.match(/<rect x="(\d+)" y="(-?\d+)"[^>]*fill="#4F7CEB"\/>/)?.slice(1, 3).map(Number)
  const onGround = hatXY(bandSvg(rows, '工作中', { p: MAX_STEPS, y: 0, dir: 1, pose: 'idle', hat: 0 }, 0, true))
  const inAir = hatXY(bandSvg(rows, '工作中', { p: MAX_STEPS, y: 2, dir: 1, pose: 'idle', hat: 0 }, 0, true))
  expect(inAir?.[1]).toBeLessThan(onGround?.[1] ?? 0)
  // 帽子最高點也在圖裡
  expect(inAir?.[1]).toBeGreaterThanOrEqual(0)
  const dropTop = hatXY(bandSvg(rows, '工作中', { p: MAX_STEPS, y: 0, dir: 1, pose: 'idle', hat: -3 }, 0, true))
  expect(dropTop?.[1]).toBeGreaterThanOrEqual(0)
  // 落地的帽子不管 Clawd 跑到哪都在同一個位置
  const a = hatXY(bandSvg(rows, '工作中', { p: MAX_STEPS, y: 0, dir: -1, pose: 'run', hat: 3 }, 0, true))
  const b = hatXY(bandSvg(rows, '工作中', { p: 3, y: 0, dir: -1, pose: 'run', hat: 3 }, 1, true))
  expect(a).toEqual(b)
})

test('終端機：Clawd 浮在上層從框前面跑過，框沒有定位與底色', async ($, on) => {
  await seed($, on)

  for (const surface of ['terminal'] as const) {
    const idle = await $.ui.mount({ ...BAND, surface })
    const homeWidth = (await idle.find({ type: 'Box', key: 'home' }))?.props.width
    expect(homeWidth).toBeDefined()
    expect(await idle.find({ type: 'Box', key: 'runner' })).toBeUndefined()
    await idle.unmount()

    const busy = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface })
    const runner = await busy.find({ type: 'Box', key: 'runner' })
    expect(runner?.props.position).toBe('absolute')
    expect(runner?.props.left).toBe(0)
    const anchor = await busy.find({ type: 'Box', key: 'anchor' })
    expect(anchor?.props.width).toBe(0)
    expect(anchor?.props.height).toBe(0)
    expect((await busy.find({ type: 'Box', key: 'home' }))?.props.width).toBe(homeWidth)
    const box = await busy.find({ type: 'Box', key: 'box' })
    expect(box?.props.position).toBeUndefined()
    expect(box?.props.backgroundColor).toBeUndefined()
    expect(box?.props.left).toBeUndefined()
    await busy.unmount()
  }
})

test('空位圖與有 Clawd 的圖一樣大', () => {
  const empty = laneSvg(44, 30, 2.5)
  const full = laneSvg(44, 30, 2.5, { x: 0, lift: 0, pose: 'idle', frame: 0, eyeDx: 0 })
  expect(empty).toContain('width="44" height="30"')
  expect(full).toContain('width="44" height="30"')
  expect(empty).toContain('fill-opacity="0"')
})

test('跑道圖：空跑道沒有 Clawd，跳起來時往上移', () => {
  expect(laneSvg(72, 24, 2).match(/<rect/g)?.length).toBe(1)
  const ground = laneSvg(72, 24, 2, { x: 0, lift: 0, pose: 'idle', frame: 0, eyeDx: 0 })
  const air = laneSvg(72, 24, 2, { x: 0, lift: 8, pose: 'idle', frame: 0, eyeDx: 0 })
  expect(ground).toContain('y="8"')
  expect(air).toContain('y="0"')
  expect(ground).not.toBe(air)
})

test('小數像素（2.5）時格線仍左右對稱', () => {
  const widths = Array.from({ length: 16 }, (_, i) => colEdge(i + 1, 2.5) - colEdge(i, 2.5))
  expect(widths).toEqual([...widths].reverse())
  expect(colEdge(16, 2.5)).toBe(40)
})

test('Clawd 左右對稱（靜止時）', () => {
  const rows = clawdBlocks('idle', 0)
  expect(rows.length).toBe(4)
  for (const r of rows) {
    expect(Array.from(r).length).toBe(16)
    expect(Array.from(r).reverse().join('')).toBe(r)
  }
})

test('跑步時換腳、眼睛看前進方向，待命時不動', () => {
  expect(clawdBlocks('run', 0)).not.toEqual(clawdBlocks('run', 1))
  expect(clawdBlocks('run', 0, 1)).not.toEqual(clawdBlocks('run', 0, -1))
  expect(clawdBlocks('idle', 0)).toEqual(clawdBlocks('idle', 1))
})

test('還沒有讀數時顯示等待字樣', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('state.get', () => ({ value: { value: null, version: 1 } }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source ?? '')).toContain('等第一輪回覆後顯示額度')
  await ui.unmount()
})

test('每次開工都從左邊起點出發，不接上一輪跑到一半的位置', async ($, on) => {
  const clock = mock.clock(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const picture = async () => {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface: 'desktop' })
    const source = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
    await ui.unmount()

    return source.match(/<g>.*<\/g>/)?.[0]
  }

  await $.prompt.submit({ text: '第一輪', wait: false, origin: { kind: 'composer' } })
  const start = await picture()
  await clock.advance(180 * 20)
  expect(await picture()).not.toBe(start)
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(180 * 5)

  await $.prompt.submit({ text: '第二輪', wait: false, origin: { kind: 'composer' } })
  expect(await picture()).toBe(start)
})
