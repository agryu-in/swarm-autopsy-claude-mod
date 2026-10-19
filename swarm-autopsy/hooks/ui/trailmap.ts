// The contribution trail as desktop Svg (DESIGN-CONTRACT §2, §8.3; Sunset Glass
// §11, SG-9). Pure: a layout and a string out. Two drawings, both in image mode
// and sized by the pane (a viewBox about the pane's pixel width, no size of
// their own, so the image fills its slot at a near 1:1 type size, R1 §6.3d):
// - the map (wide panes): one identity-tinted band per agent, stages as columns,
//   nodes as stage pills, evidence-coded edges (LINKED solid ◆, INFERRED dashed
//   ◇) routed through the gutters between columns and the channels between
//   lanes, drawn before the nodes so they never run through node text; the
//   selected node's path glows coral, the rest dims but stays;
// - the overview (narrower panes, or a map too large): one bead per node by
//   stage, no edges.
// Neither is pressable and neither holds anything the native list beside it
// lacks: the list is the clickable twin with every node, edge and basis. Image
// mode shows no tooltip, so none is carried. Text is drawn in currentColor: the
// renderer gives the root the pane's own ink, so it reads on dark and light.

import type { Snapshot, SpendBucket, SpendOutcome, VerificationVerdict } from '../../types'
import { EVIDENCE_GLYPH, displayPath, truncate } from '../lib/format'
import { agentRecord } from '../lib/outcome'
import { SVG_HEX, chipTextHex, identityHex } from '../lib/palette'
import { MAIN } from '../lib/reduce'
import type { Trail, TrailEdge, TrailLane, TrailNode } from '../lib/trail'
import { svgEscape } from './svg'
import { FLOW_OF, FLOW_STAGES, STAGE_GLYPH, STAGE_TITLE, badgeFor, isBackEdge, middleTruncate, pathOf } from './trail-model'

/** The engine's own limit is 131,072 characters; ours leaves room (DESIGN-CONTRACT §2). */
export const MAP_MAX_SOURCE = 60_000
/** Past this many nodes the map is not built at all (the overview is drawn instead): its markup would not fit. */
export const MAP_MAX_NODES = 160
/**
 * Desktop pixels per body column. The harness measures 1ch at 7.91 px (R1 §5.2), so a drawing `columns × 8` wide fills
 * the map's glass panel at about 0.97 of its size: its type is drawn near 1:1.
 */
export const CELL_PX = 8
const MAP_MIN_WIDTH = 800
const OVERVIEW_MIN_WIDTH = 300
const FONT_FAMILY = 'ui-sans-serif, system-ui, sans-serif'

/** Text in the pane's ink (`.t`), secondary text at reduced strength (`.m`). */
const STYLE = '<style>.t{fill:currentColor}.m{fill:currentColor;fill-opacity:.66}</style>'
const INK = 'currentColor'

const EDGE_HEX = {
  get LINKED() {
    return SVG_HEX.link
  },
  get INFERRED() {
    return SVG_HEX.caution
  },
}
/**
 * Stage hues as the list's roles: delegation and verification in the accent (the theme's, read at drawing time, as
 * STAGE_ROLE does), findings analytic, changes in the ink.
 */
const STAGE_HEX: Record<TrailNode['stage'], string> = {
  get delegation(): string {
    return SVG_HEX.accent
  },
  get investigation() {
    return SVG_HEX.muted
  },
  get finding() {
    return SVG_HEX.analytic
  },
  change: INK,
  get verification(): string {
    return SVG_HEX.accent
  },
}
/** A running verification keeps its stage's accent until a verdict colours it. */
const VERDICT_HEX: Record<VerificationVerdict, string> = {
  get passed() {
    return SVG_HEX.ok
  },
  get failed() {
    return SVG_HEX.fail
  },
  get inconclusive() {
    return SVG_HEX.caution
  },
  get running(): string {
    return SVG_HEX.accent
  },
}
const VERDICT_MARK: Record<VerificationVerdict, string> = { passed: '✓', failed: '✕', inconclusive: '~', running: '…' }
const VERDICTS: readonly VerificationVerdict[] = ['passed', 'failed', 'inconclusive', 'running']
const BUCKET_HEX: Record<SpendBucket['bucket'], string> = {
  get coordinator() {
    return SVG_HEX.main
  },
  get verified() {
    return SVG_HEX.ok
  },
  get 'changed-unverified'() {
    return SVG_HEX.caution
  },
  get 'failed-or-inconclusive'() {
    return SVG_HEX.fail
  },
  get 'report-only'() {
    return SVG_HEX.link
  },
  get mixed() {
    return SVG_HEX.analytic
  },
  get unresolved() {
    return SVG_HEX.unknownFill
  },
  get 'no-usage-recorded'() {
    return SVG_HEX.unknownFill
  },
}

const LEGEND_H = 24
const HEAD_H = 20
const LANE_GAP = 16
const PAD = 8
const ROW_GAP = 6
const GUTTER = 16
/** Spread of parallel runs: within a gutter (GUTTER wide) and within a channel between lanes (LANE_GAP high). */
const GUTTER_SPAN = 12
const CHANNEL_SPAN = 10
const CHAR_EM = 0.5
const CORNER = 5
const TITLE_MAX = 300
/** Where a node's label starts: after the glyph's disc. */
const LABEL_INSET = 25
/** Labels may grow with the room an expanded pane gives (Sunset Glass §10). */
const LABEL_MAX = 40
/** Characters a flagged node's label leaves for its `?`. */
const FLAG_CHARS = 3
/** Opacity of what a selection or a filter is not about: dimmed, never hidden. */
const DIM = '0.5'
const FAINT = '0.45'
const EDGE_OFF = '0.3'

export type MapInput = {
  widthPx: number
  /** F3, for each lane's outcome badge; no badges without it. */
  spend?: SpendOutcome
  selectedNodeId?: string
  focusAgentId?: string
  /** The lanes to draw (a trail filter and the lane cap), by agent id; every lane when absent. */
  lanes?: readonly string[]
  /** The nodes a filter is about; the others are drawn faint. Every node when absent. */
  emphasis?: ReadonlySet<string>
  cwd?: string
}

type Point = [number, number]
export type MapBox = { id: string; x: number; y: number; w: number; h: number }
export type MapNode = MapBox & { node: TrailNode; col: number }
export type MapEdge = { id: string; edge: TrailEdge; points: Point[] }
export type MapLane = { agentId: string; y: number; h: number; nodes: TrailNode[] }
export type MapLayout = {
  width: number
  height: number
  fontSize: number
  labelChars: number
  label: { w: number }
  colX: (col: number) => number
  colW: number
  outcomeX: number
  lanes: MapLane[]
  nodes: MapNode[]
  labels: MapBox[]
  edges: MapEdge[]
  droppedBackEdges: number
}

/** `drawable`: something to draw, within MAP_MAX_SOURCE. The view draws the overview, or nothing, otherwise. */
export type MapPicture = { source: string; alt: string; width: number; height: number; drawable: boolean }

const DEFAULT_INPUT: MapInput = { widthPx: MAP_MIN_WIDTH }

const r1 = (n: number): number => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
/** Characters XML refuses: C0 controls (but tab and line feed), DEL, the non-characters U+FFFE/U+FFFF, lone surrogates. */
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
/** Clips by code point, drops what XML refuses (a clip elsewhere may have split a pair), escapes. */
const text = (s: string, max = TITLE_MAX): string => svgEscape(middleTruncate(s.replace(UNSAFE, ''), max).replace(UNSAFE, ''))

/** The root element: a viewBox and no size, so the image takes its slot's width at the drawing's own ratio. */
const svgOpen = (width: number, height: number, font: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}" font-size="${font}">${STYLE}`

function visibleLanes(trail: Trail, input: MapInput): TrailLane[] {
  const shown = trail.lanes.filter(l => !input.lanes || input.lanes.includes(l.agentId))
  const fromMain = trail.edges.some(e => e.from === `agent:${MAIN}` && shown.some(l => l.nodes.some(n => n.id === e.to)))
  return fromMain && !shown.some(l => l.agentId === MAIN) ? [{ agentId: MAIN, nodes: [] }, ...shown] : shown
}

/** The short label a node shows in the map (prose cut at its end, commands and paths in the middle); the list's row has it whole. */
export function nodeLabel(snapshot: Snapshot, node: TrailNode, chars: number, cwd?: string): string {
  if (node.stage === 'delegation') {
    const description = agentRecord(snapshot, node.agentId)?.description
    return description ? `“${truncate(description, chars - 2)}”` : truncate(node.title, chars)
  }
  if (node.stage === 'investigation') return truncate(node.title.replace(/^Investigated: /, ''), chars)
  if (node.stage === 'finding') return truncate(node.title.replace(/^Report: /, ''), chars)
  if (node.stage === 'change') return middleTruncate(displayPath(node.path ?? '', cwd), chars)
  return middleTruncate(node.command ?? node.title, chars)
}

const nodeHex = (node: TrailNode): string => (node.stage === 'verification' ? VERDICT_HEX[node.verdict ?? 'running'] : STAGE_HEX[node.stage])

/** Column of a stage (0 = Delegation … 3 = Verification). */
const colOf = (node: TrailNode): number => FLOW_STAGES.indexOf(FLOW_OF[node.stage])

type Sizing = { width: number; labelW: number; outcomeW: number; colW: number; boxW: number; nodeH: number; fontSize: number; labelChars: number }

/** Columns from the drawing's width; the type grows to 12 where a node has room for 24 characters of it. */
function sizing(widthPx: number): Sizing {
  const width = Math.round(Math.max(MAP_MIN_WIDTH, widthPx))
  const labelW = Math.round(clamp(width * 0.15, 112, 180))
  const outcomeW = Math.round(clamp(width * 0.12, 96, 160))
  const colW = (width - labelW - outcomeW) / FLOW_STAGES.length
  const boxW = colW - GUTTER
  const room = (font: number) => Math.floor((boxW - LABEL_INSET - 8) / (CHAR_EM * font))
  const fontSize = room(12) >= 24 ? 12 : room(11) >= 18 ? 11 : 10
  return { width, labelW, outcomeW, colW, boxW, nodeH: fontSize >= 12 ? 26 : 24, fontSize, labelChars: clamp(room(fontSize), 18, LABEL_MAX) }
}

/** Lanes stacked with channels between them; nodes in their stage's column, investigation above the report. */
function placeLanes(trail: Trail, input: MapInput, s: Sizing) {
  const colX = (col: number) => s.labelW + col * s.colW
  const lanes: MapLane[] = []
  const nodes: MapNode[] = []
  const labels: MapBox[] = []
  let y = LEGEND_H + HEAD_H + LANE_GAP
  for (const lane of visibleLanes(trail, input)) {
    const perCol = FLOW_STAGES.map((_, col) => lane.nodes.filter(n => colOf(n) === col))
    const rows = Math.max(1, ...perCol.map(list => list.length))
    const h = rows * (s.nodeH + ROW_GAP) - ROW_GAP + PAD * 2
    lanes.push({ agentId: lane.agentId, y, h, nodes: lane.nodes })
    labels.push({ id: `label:${lane.agentId}`, x: 4, y: y + PAD, w: s.labelW - GUTTER - 6, h: Math.min(h - PAD * 2, 30) })
    perCol.forEach((list, col) => {
      const ordered = [...list].sort((a, b) => (a.stage === b.stage ? 0 : a.stage === 'investigation' ? -1 : 1))
      ordered.forEach((node, row) => nodes.push({ id: node.id, node, col, x: colX(col), y: y + PAD + row * (s.nodeH + ROW_GAP), w: s.boxW, h: s.nodeH }))
    })
    y += h + LANE_GAP
  }
  return { colX, lanes, nodes, labels, height: y }
}

type Anchor = { right: number; left: number; cy: number; col: number; laneTop: number }

function anchorsOf(lanes: readonly MapLane[], nodes: readonly MapNode[], labels: readonly MapBox[]): Map<string, Anchor> {
  const anchors = new Map<string, Anchor>()
  const laneTop = new Map(lanes.map(l => [l.agentId, l.y]))
  for (const n of nodes) anchors.set(n.id, { right: n.x + n.w, left: n.x, cy: n.y + n.h / 2, col: n.col, laneTop: laneTop.get(n.node.agentId) ?? n.y })
  for (const l of labels) anchors.set(`agent:${l.id.slice('label:'.length)}`, { right: l.x + l.w, left: l.x, cy: l.y + 8, col: -1, laneTop: l.y - PAD })
  return anchors
}

/** Offsets that spread `count` parallel runs evenly over `span` pixels, centred on the channel. */
const spreadOf = (k: number, count: number, span: number): number => (count <= 1 ? 0 : -span / 2 + (span * k) / (count - 1))

/**
 * Where a run leaves or reaches a node side: edges leave from the upper half and arrive in the lower half, so a stub of
 * one edge never lies on a stub of another; several on one side are spread over that half.
 */
const sideOffset = (ids: readonly string[], id: string, sign: -1 | 1): number => {
  const k = Math.max(0, ids.indexOf(id))
  return sign * (ids.length <= 1 ? 4 : 1 + (k * 7) / (ids.length - 1))
}

/** Orthogonal routes in gutters and channels only, each parallel run in a channel at its own offset. Real trail edges only. */
function routeEdges(trail: Trail, anchors: ReadonlyMap<string, Anchor>, s: Sizing): MapEdge[] {
  const drawn = trail.edges.filter(e => !isBackEdge(e) && anchors.has(e.from) && anchors.has(e.to))
  const gutterX = (col: number) => s.labelW + (col + 1) * s.colW - GUTTER / 2
  const channels = (e: TrailEdge): string[] => {
    const from = anchors.get(e.from)
    const to = anchors.get(e.to)
    if (!from || !to) return []
    return to.col === from.col + 1 ? [`v${from.col}`] : [`v${from.col}`, `v${to.col - 1}`, `h${to.laneTop}`]
  }
  const users = new Map<string, string[]>()
  for (const e of drawn) for (const c of channels(e)) users.set(c, [...(users.get(c) ?? []), e.id])
  const offset = (channel: string, id: string, span: number) => {
    const list = users.get(channel) ?? []
    return spreadOf(Math.max(0, list.indexOf(id)), list.length, span)
  }
  const outs = (id: string) => drawn.filter(e => e.from === id).map(e => e.id)
  const ins = (id: string) => drawn.filter(e => e.to === id).map(e => e.id)
  return drawn.flatMap(edge => {
    const from = anchors.get(edge.from)
    const to = anchors.get(edge.to)
    if (!from || !to) return []
    const sy = from.cy + (from.col < 0 ? 0 : sideOffset(outs(edge.from), edge.id, -1))
    const ty = to.cy + sideOffset(ins(edge.to), edge.id, 1)
    const vs = gutterX(from.col) + offset(`v${from.col}`, edge.id, GUTTER_SPAN)
    const points: Point[] = [[from.right, sy], [vs, sy]]
    if (to.col === from.col + 1) {
      points.push([vs, ty])
    } else {
      const vt = gutterX(to.col - 1) + offset(`v${to.col - 1}`, edge.id, GUTTER_SPAN)
      const hy = to.laneTop - LANE_GAP / 2 + offset(`h${to.laneTop}`, edge.id, CHANNEL_SPAN)
      points.push([vs, hy], [vt, hy], [vt, ty])
    }
    points.push([to.left, ty])
    return [{ id: edge.id, edge, points: points.map(([px, py]): Point => [r1(px), r1(py)]) }]
  })
}

/** Where every lane, node and edge goes. Exported for tests (edges never cross a node or a lane label, nor each other's runs). */
export function layoutTrailMap(trail: Trail, input: MapInput): MapLayout {
  const s = sizing(input.widthPx)
  const placed = placeLanes(trail, input, s)
  const edges = routeEdges(trail, anchorsOf(placed.lanes, placed.nodes, placed.labels), s)
  return {
    width: s.width,
    height: placed.height,
    fontSize: s.fontSize,
    labelChars: s.labelChars,
    label: { w: s.labelW },
    colX: placed.colX,
    colW: s.colW,
    outcomeX: placed.colX(FLOW_STAGES.length),
    lanes: placed.lanes,
    nodes: placed.nodes,
    labels: placed.labels,
    edges,
    droppedBackEdges: trail.edges.filter(isBackEdge).length,
  }
}

/** A cubic segment to `b` with control points `c1`, `c2`. */
const cubic = (c1: Point, c2: Point, b: Point): string => ` C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(b[0])},${r1(b[1])}`

/** An orthogonal route with rounded corners, every piece a cubic (a straight run is a cubic with its controls on the line). */
function routePath(points: readonly Point[]): string {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]?.[0] || p[1] !== points[i - 1]?.[1])
  const [first, ...rest] = pts
  if (!first || rest.length === 0) return ''
  let d = `M${r1(first[0])},${r1(first[1])}`
  let at: Point = first
  rest.forEach((cur, i) => {
    const next = rest[i + 1]
    if (!next) {
      d += cubic(at, cur, cur)
      return
    }
    const inLen = Math.hypot(cur[0] - at[0], cur[1] - at[1]) || 1
    const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1
    const a = Math.min(CORNER, inLen / 2)
    const b = Math.min(CORNER, outLen / 2)
    const enter: Point = [cur[0] - ((cur[0] - at[0]) / inLen) * a, cur[1] - ((cur[1] - at[1]) / inLen) * a]
    const leave: Point = [cur[0] + ((next[0] - cur[0]) / outLen) * b, cur[1] + ((next[1] - cur[1]) / outLen) * b]
    d += cubic(at, enter, enter)
    // The quadratic corner (enter, cur, leave) as a cubic.
    d += cubic(
      [enter[0] + (2 / 3) * (cur[0] - enter[0]), enter[1] + (2 / 3) * (cur[1] - enter[1])],
      [leave[0] + (2 / 3) * (cur[0] - leave[0]), leave[1] + (2 / 3) * (cur[1] - leave[1])],
      leave,
    )
    at = leave
  })
  return d
}

/**
 * The edge ends: a diamond where an edge leaves (filled ◆ for LINKED, hollow ◇ for INFERRED, as the list's `─◆→` and
 * `╌◇→`) and an arrow where it arrives, each in the evidence hue and a fixed size whatever the stroke.
 */
function markers(): string {
  return (['LINKED', 'INFERRED'] as const)
    .map(k => {
      const hex = EDGE_HEX[k]
      const diamond = k === 'LINKED' ? `fill="${hex}"` : `fill="${hex}" fill-opacity="0.15" stroke="${hex}" stroke-width="1.6"`
      return (
        `<marker id="sa-dia-${k}" viewBox="0 0 12 12" refX="1" refY="6" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M1,6 L6,1 L11,6 L6,11 z" ${diamond}/></marker>` +
        `<marker id="sa-arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${hex}"/></marker>`
      )
    })
    .join('')
}

function legend(width: number, selected: boolean): string {
  const y = 14
  const sample = (x: number, kind: 'LINKED' | 'INFERRED') =>
    `<line x1="${x}" y1="${y - 4}" x2="${x + 30}" y2="${y - 4}" stroke="${EDGE_HEX[kind]}" stroke-width="2"${kind === 'INFERRED' ? ' stroke-dasharray="5 4"' : ''} marker-start="url(#sa-dia-${kind})" marker-end="url(#sa-arrow-${kind})"/>` +
    `<text x="${x + 38}" y="${y}" class="t" font-weight="600">${EVIDENCE_GLYPH[kind]} ${kind}</text>`
  const verdicts = VERDICTS.map(v => `<tspan fill="${VERDICT_HEX[v]}" font-weight="700">${VERDICT_MARK[v]}</tspan> ${v}`).join('  ')
  const right = selected ? `<tspan fill="${SVG_HEX.accent}" font-weight="700">━</tspan> the selected node’s path` : 'report hand-backs: in the list'
  return (
    `<g class="legend">${sample(8, 'LINKED')}${sample(140, 'INFERRED')}` +
    `<text x="282" y="${y}" class="m">${verdicts}</text>` +
    (width >= 900 ? `<text x="${width - 8}" y="${y}" class="m" text-anchor="end">${right}</text>` : '') +
    `</g>`
  )
}

/** A lane: a band tinted by the agent's identity with an edge bar, its chip, type and task; the focused lane is stronger. */
function laneLabel(snapshot: Snapshot, lane: MapLane, layout: MapLayout, focus: boolean, font: number): string {
  const agent = agentRecord(snapshot, lane.agentId)
  const room = Math.floor((layout.label.w - GUTTER - 32) / (CHAR_EM * font))
  const y = lane.y + PAD
  const main = agent?.isMain === true || (!agent && lane.agentId === MAIN)
  const hex = main ? SVG_HEX.main : (identityHex(agent) ?? SVG_HEX.muted)
  const band =
    `<rect class="lane" x="0" y="${lane.y}" width="${layout.width}" height="${lane.h}" rx="10" fill="${hex}" fill-opacity="${focus ? 0.16 : 0.07}"` +
    `${focus ? ` stroke="${hex}" stroke-opacity="0.7" stroke-width="1.5"` : ''}/>` +
    `<rect x="1" y="${lane.y + 5}" width="3" height="${lane.h - 10}" rx="1.5" fill="${hex}"/>`
  if (main) return `${band}<text x="12" y="${y + 13}" fill="${SVG_HEX.main}" font-weight="700" font-size="${font + 1}">◎ main</text>`
  const chip =
    `<rect x="10" y="${y}" width="18" height="18" rx="4" fill="${hex}"/>` +
    `<text x="19" y="${y + 13}" text-anchor="middle" fill="${chipTextHex()}" font-weight="700" font-size="${font}">${text(agent?.label ?? '?', 3)}</text>`
  const type = `<text x="34" y="${y + 13}" class="t" font-weight="600" font-size="${font}">${text(truncate(agent?.type ?? 'type unknown', room))}</text>`
  // Every lane is at least one node row tall, room for the task under the chip.
  const task = agent?.description ? `<text x="12" y="${y + 30}" class="m" font-size="${font - 1}">${text(`“${truncate(agent.description, room + 2)}”`)}</text>` : ''
  return `${band}${chip}${type}${task}`
}

/** The lane's F3 bucket as a pill in the bucket's hue, its words on one line or two. */
function outcomeBadge(spend: SpendOutcome | undefined, lane: MapLane, x: number, w: number, font: number): string {
  const badge = spend ? badgeFor(spend, lane.agentId) : undefined
  if (!badge) return ''
  const hex = BUCKET_HEX[badge.bucket]
  const room = Math.floor((w - 24) / (CHAR_EM * font))
  const words = `${badge.evidence ? `${EVIDENCE_GLYPH[badge.evidence]} ` : ''}${badge.label}`
  const space = words.lastIndexOf(' ', room)
  const cut = words.length <= room ? words.length : space > 0 ? space : room
  const rest = words.slice(cut).trim()
  const top = lane.y + PAD
  const h = rest ? font * 2 + 14 : font + 11
  return (
    `<rect x="${r1(x + 4)}" y="${top}" width="${r1(w - 12)}" height="${h}" rx="${r1(Math.min(h / 2, 11))}" fill="${hex}" fill-opacity="0.14" stroke="${hex}" stroke-opacity="0.55"/>` +
    `<text x="${r1(x + 12)}" y="${top + font + 4}" fill="${hex}" font-weight="700" font-size="${font}">${text(words.slice(0, cut), room)}</text>` +
    (rest ? `<text x="${r1(x + 12)}" y="${top + font * 2 + 7}" fill="${hex}" font-weight="700" font-size="${font}">${text(rest, room)}</text>` : '')
  )
}

type NodeState = { selected: boolean; onPath: boolean; dim: string | undefined; flagged: boolean }

/** A node as a stage pill: its glyph (a check's verdict) in a disc, its short label, `?` when a flag rests on it. */
function nodeMarkup(snapshot: Snapshot, n: MapNode, layout: MapLayout, state: NodeState, cwd?: string): string {
  const hex = nodeHex(n.node)
  const font = layout.fontSize
  const r = n.h / 2
  const cy = n.y + r
  const base = r1(cy + font * 0.36)
  const glyph = n.node.stage === 'verification' ? VERDICT_MARK[n.node.verdict ?? 'running'] : STAGE_GLYPH[n.node.stage]
  const width = state.selected ? 2.2 : state.onPath ? 1.8 : 1.2
  const ring = state.selected
    ? `<rect class="ring sel" x="${r1(n.x - 4)}" y="${n.y - 4}" width="${r1(n.w + 8)}" height="${n.h + 8}" rx="${r + 4}" fill="${SVG_HEX.accent}" fill-opacity="0.12" stroke="${SVG_HEX.accent}" stroke-width="2.5"/>`
    : state.onPath
      ? `<rect class="ring" x="${r1(n.x - 3)}" y="${n.y - 3}" width="${r1(n.w + 6)}" height="${n.h + 6}" rx="${r + 3}" fill="none" stroke="${SVG_HEX.accent}" stroke-opacity="0.6" stroke-width="1.5"/>`
      : ''
  const dash = n.node.stage === 'investigation' ? ' stroke-dasharray="3 2"' : ''
  const flag = state.flagged ? `<text x="${r1(n.x + n.w - 9)}" y="${base}" text-anchor="end" fill="${SVG_HEX.caution}" font-weight="700" font-size="${font}">?</text>` : ''
  // A flagged node's label gives up room for its `?`, so the two never overlap.
  const chars = layout.labelChars - (state.flagged ? FLAG_CHARS : 0)
  const label = text(nodeLabel(snapshot, n.node, chars, cwd), chars)
  return (
    `<g class="node"${state.dim ? ` opacity="${state.dim}"` : ''}>${ring}` +
    `<rect class="pill" x="${Math.round(n.x)}" y="${Math.round(n.y)}" width="${Math.round(n.w)}" height="${n.h}" rx="${r}" fill="${hex}" fill-opacity="0.13" stroke="${hex}" stroke-opacity="0.85" stroke-width="${width}"${dash}/>` +
    `<circle cx="${r1(n.x + 12)}" cy="${cy}" r="${r - 4}" fill="${hex}" fill-opacity="0.24"/>` +
    `<text x="${r1(n.x + 12)}" y="${base}" text-anchor="middle" fill="${hex}" font-weight="700" font-size="${font}">${glyph}</text>` +
    `<text x="${r1(n.x + LABEL_INSET)}" y="${base}" class="t" font-size="${font}"${n.node.stage === 'change' ? ' font-weight="600"' : ''}>${label}</text>` +
    `${flag}</g>`
  )
}

type EdgeState = 'on' | 'off' | 'plain'

/** An edge in its evidence hue (LINKED solid, INFERRED dashed), with a coral glow beneath it when it is on the selected path. */
function edgeMarkup(e: MapEdge, state: EdgeState): string {
  const kind = e.edge.evidence
  const d = routePath(e.points)
  const dash = kind === 'INFERRED' ? ' stroke-dasharray="5 4"' : ''
  const width = state === 'on' ? 2.4 : 1.5
  // `opacity` (not stroke-opacity) so the diamond and the arrow dim with their line.
  const opacity = state === 'off' ? ` opacity="${EDGE_OFF}"` : ''
  const halo =
    state === 'on' ? `<path d="${d}" class="halo" fill="none" stroke="${SVG_HEX.accent}" stroke-width="7" stroke-opacity="0.38" stroke-linecap="round" stroke-linejoin="round"/>` : ''
  return (
    halo +
    `<path d="${d}" class="edge ${state}" fill="none" stroke="${EDGE_HEX[kind]}" stroke-width="${width}"${opacity}${dash} marker-start="url(#sa-dia-${kind})" marker-end="url(#sa-arrow-${kind})"/>`
  )
}

function mapHeader(layout: MapLayout): string {
  const columns = [
    ...FLOW_STAGES.map((stage, col) => ({ x: layout.colX(col) + 4, title: `${STAGE_GLYPH[stage]} ${STAGE_TITLE[stage]}` })),
    { x: layout.outcomeX + 6, title: STAGE_TITLE.outcome },
  ]
  return columns.map(h => `<text x="${r1(h.x)}" y="${LEGEND_H + 14}" class="t" font-weight="700" font-size="${layout.fontSize}">${h.title}</text>`).join('')
}

function mapSource(snapshot: Snapshot, trail: Trail, input: MapInput, layout: MapLayout): string {
  const selectedId = input.selectedNodeId
  const path = pathOf(trail, selectedId)
  const flagged = new Set(trail.flags.flatMap(f => (f.evidence === 'UNRESOLVED' && f.nodeId ? [f.nodeId] : [])))
  const font = layout.fontSize
  const lanes = layout.lanes.map(l => laneLabel(snapshot, l, layout, l.agentId === input.focusAgentId, font) + outcomeBadge(input.spend, l, layout.outcomeX, layout.width - layout.outcomeX, font)).join('')
  const edgeState = (e: MapEdge): EdgeState => (!selectedId ? 'plain' : path.edges.has(e.id) ? 'on' : 'off')
  // Edges first (dimmed ones under the path), nodes on top: an edge never covers node text.
  const edges = [...layout.edges]
    .sort((a, b) => Number(edgeState(a) === 'on') - Number(edgeState(b) === 'on'))
    .map(e => edgeMarkup(e, edgeState(e)))
    .join('')
  const nodes = layout.nodes
    .map(n => {
      const selected = n.id === selectedId
      const onPath = path.nodes.has(n.id)
      const faint = input.emphasis !== undefined && !input.emphasis.has(n.id)
      const offPath = selectedId !== undefined && !selected && !onPath
      const dim = faint ? FAINT : offPath ? DIM : undefined
      return nodeMarkup(snapshot, n, layout, { selected, onPath, dim, flagged: flagged.has(n.id) }, input.cwd)
    })
    .join('')
  return `${svgOpen(layout.width, layout.height, font)}<defs>${markers()}</defs>${legend(layout.width, selectedId !== undefined)}${mapHeader(layout)}${lanes}${edges}${nodes}</svg>`
}

/**
 * The wide map. Not `drawable` (the view draws the overview) when it has no node, more than MAP_MAX_NODES nodes (not
 * built at all), or markup past MAP_MAX_SOURCE.
 */
export function trailSvg(snapshot: Snapshot, trail: Trail, input: MapInput = DEFAULT_INPUT): MapPicture {
  const layout = layoutTrailMap(trail, input)
  const linked = layout.edges.filter(e => e.edge.evidence === 'LINKED').length
  const alt =
    `Contribution trail map, stages as columns (Delegation, Findings, Changes, Verification, Outcome), one row per agent: ` +
    `${layout.lanes.length} lanes, ${layout.nodes.length} nodes, ${layout.edges.length} edges drawn (${linked} LINKED solid, ${layout.edges.length - linked} INFERRED dashed); ` +
    `${layout.droppedBackEdges} report hand-backs to the spawner are listed below only. The list below carries every node and edge with its evidence.`
  const base = { alt, width: layout.width, height: layout.height }
  if (layout.nodes.length === 0 || layout.nodes.length > MAP_MAX_NODES) return { ...base, source: '', drawable: false }
  const source = mapSource(snapshot, trail, input, layout)
  return { ...base, source, drawable: source.length <= MAP_MAX_SOURCE }
}

// ── the overview (narrower desktop panes, and maps too large to draw) ──

const BEAD_STEP = 13
const OVERVIEW_FONT = 11
const ROW_H = 24
const OVERVIEW_TOP = 22

type OverviewGrid = { width: number; labelW: number; outcomeW: number; colW: number; perBead: number }

function overviewRow(snapshot: Snapshot, lane: TrailLane, i: number, grid: OverviewGrid, input: MapInput): string {
  const y = OVERVIEW_TOP + i * ROW_H
  const agent = agentRecord(snapshot, lane.agentId)
  const main = agent?.isMain === true
  const hex = main ? SVG_HEX.main : (identityHex(agent) ?? SVG_HEX.muted)
  const room = Math.floor((grid.labelW - 30) / (CHAR_EM * OVERVIEW_FONT))
  const focus = lane.agentId === input.focusAgentId
  const band =
    `<rect class="lane" x="0" y="${y + 1}" width="${grid.width}" height="${ROW_H - 2}" rx="6" fill="${hex}" fill-opacity="${focus ? 0.18 : 0.07}"${focus ? ` stroke="${hex}" stroke-opacity="0.7"` : ''}/>` +
    `<rect x="1" y="${y + 4}" width="3" height="${ROW_H - 8}" rx="1.5" fill="${hex}"/>`
  const label = main
    ? `<text x="8" y="${y + 16}" fill="${SVG_HEX.main}" font-weight="700">◎ main</text>`
    : `<rect x="8" y="${y + 4}" width="16" height="16" rx="3" fill="${hex}"/><text x="16" y="${y + 16}" text-anchor="middle" fill="${chipTextHex()}" font-weight="700">${text(agent?.label ?? '?', 3)}</text>` +
      (room >= 4 ? `<text x="29" y="${y + 16}" class="t">${text(truncate(agent?.type ?? 'type unknown', room))}</text>` : '')
  const beads = FLOW_STAGES.map((stage, col) => {
    const list = lane.nodes.filter(n => FLOW_OF[n.stage] === stage)
    const shown = list.slice(0, grid.perBead)
    const x0 = grid.labelW + col * grid.colW + 8
    const dots = shown
      .map((n, k) => {
        const selected = n.id === input.selectedNodeId
        return `<circle cx="${r1(x0 + k * BEAD_STEP)}" cy="${y + 12}" r="${selected ? 6 : 5}" fill="${nodeHex(n)}"${selected ? ` stroke="${SVG_HEX.accent}" stroke-width="2.5"` : ''}/>`
      })
      .join('')
    return dots + (list.length > shown.length ? `<text x="${r1(x0 + shown.length * BEAD_STEP)}" y="${y + 16}" class="m">+${list.length - shown.length}</text>` : '')
  }).join('')
  const badge = input.spend ? badgeFor(input.spend, lane.agentId) : undefined
  const words = badge ? `${badge.evidence ? `${EVIDENCE_GLYPH[badge.evidence]} ` : ''}${badge.label}` : ''
  const outcome = badge
    ? `<text x="${r1(grid.width - grid.outcomeW + 4)}" y="${y + 16}" fill="${BUCKET_HEX[badge.bucket]}" font-weight="700">${text(words, Math.floor((grid.outcomeW - 6) / (CHAR_EM * OVERVIEW_FONT)))}</text>`
    : ''
  return `<g>${band}${label}${beads}${outcome}</g>`
}

function overviewSource(snapshot: Snapshot, lanes: readonly TrailLane[], grid: OverviewGrid, input: MapInput): string {
  const heads = FLOW_STAGES.map((stage, col) => {
    const title = grid.colW >= 88 ? `${STAGE_GLYPH[stage]} ${STAGE_TITLE[stage]}` : STAGE_GLYPH[stage]
    return `<text x="${r1(grid.labelW + col * grid.colW + 4)}" y="15" class="t" font-weight="700">${title}</text>`
  }).join('')
  const outcomeHead = `<text x="${r1(grid.width - grid.outcomeW + 4)}" y="15" class="t" font-weight="700">${STAGE_TITLE.outcome}</text>`
  const height = OVERVIEW_TOP + lanes.length * ROW_H + 4
  return `${svgOpen(grid.width, height, OVERVIEW_FONT)}${heads}${outcomeHead}${lanes.map((lane, i) => overviewRow(snapshot, lane, i, grid, input)).join('')}</svg>`
}

/** One bead per node by stage, verification beads in their verdict's colour; no edges (the list carries them). */
export function trailOverviewSvg(snapshot: Snapshot, trail: Trail, input: MapInput = DEFAULT_INPUT): MapPicture {
  const lanes = trail.lanes.filter(l => !input.lanes || input.lanes.includes(l.agentId))
  const width = Math.round(Math.max(OVERVIEW_MIN_WIDTH, input.widthPx))
  const labelW = Math.round(clamp(width * 0.2, 60, 160))
  const outcomeW = Math.round(clamp(width * 0.22, 64, 180))
  const colW = (width - labelW - outcomeW) / FLOW_STAGES.length
  const grid: OverviewGrid = { width, labelW, outcomeW, colW, perBead: Math.max(1, Math.floor((colW - 14) / BEAD_STEP)) }
  const source = overviewSource(snapshot, lanes, grid, input)
  const nodes = lanes.reduce((n, l) => n + l.nodes.length, 0)
  const alt = `Contribution trail overview: ${lanes.length} lanes, ${nodes} nodes as beads by stage (Delegation, Findings, Changes, Verification), verification beads in their verdict's colour, each lane's outcome at the end. Edges and evidence are in the list below.`
  return { source, alt, width, height: OVERVIEW_TOP + lanes.length * ROW_H + 4, drawable: lanes.length > 0 && source.length <= MAP_MAX_SOURCE }
}
