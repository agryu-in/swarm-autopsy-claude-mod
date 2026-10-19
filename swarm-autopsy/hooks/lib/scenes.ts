// The look as two categories (modes) of scenes. Spooky: dark gray, a little haunted, each lit by one cold or
// guttering light. Cozy: warm and pleasant, lamplight and golden hour, each with a lofi track. A scene carries its
// title, motto, palette, the name of the context gauge it draws and its music. Its palette recolours the whole pane
// (lib/themes.ts). Pure data.

export type ModeId = 'spooky' | 'cozy'

export type SceneId =
  | 'fogbound-cemetery'
  | 'drowned-lighthouse'
  | 'hollow-library'
  | 'crooked-manor'
  | 'clocktower'
  | 'mire-lights'
  | 'cat-cafe'
  | 'fireside-tea'
  | 'golden-porch'
  | 'sunset-pier'
  | 'flower-shop'
  | 'forest-cabin'

export type Palette = {
  /** Sky gradient: top, middle, horizon. */
  sky: readonly [string, string, string]
  /** The pane's background; the scene fades into it. */
  base: string
  /** Panels on top of the base. */
  surface: string
  /** Main text and headings. */
  ink: string
  /** Secondary text and quiet marks. */
  muted: string
  /** The one light of the scene: brand mark, section markers, the gauge. */
  accent: string
  /** A second, quieter light. */
  accent2: string
  /** The empty part of a gauge, a bar's track. */
  track: string
}

export type Scene = {
  id: SceneId
  mode: ModeId
  title: string
  motto: string
  palette: Palette
  /** The context gauge drawn into the scene, as its caption names it. */
  gauge: string
  /** What the gauge is, for alt text (`a lantern on the gate post`). */
  gaugeThing: string
  /** What each active subagent appears as in the scene (`bat`), for alt text. */
  swarmThing: string
  /** The scene's music, a file of the mod's (`music/<scene>.mp3`); absent, the scene stays silent. */
  music?: string
  /** The track's title and author, as music/CREDITS.md lists them. */
  musicTitle?: string
  /**
   * What fills the air the pane adds above the painting (a tall pane): night stars, a slow high mist, or warm dust
   * motes drifting in lamplight (an interior).
   */
  air: 'stars' | 'mist' | 'motes'
}

export type Mode = { id: ModeId; label: string; blurb: string; scenes: readonly SceneId[] }

export const MODES: readonly Mode[] = [
  {
    id: 'spooky',
    label: 'Spooky',
    blurb: 'fog, midnight and lights that should not be there',
    scenes: ['fogbound-cemetery', 'drowned-lighthouse', 'hollow-library', 'crooked-manor', 'clocktower', 'mire-lights'],
  },
  {
    id: 'cozy',
    label: 'Cozy',
    blurb: 'lamplight, golden hour and lofi',
    scenes: ['cat-cafe', 'fireside-tea', 'golden-porch', 'sunset-pier', 'flower-shop', 'forest-cabin'],
  },
]

export const SCENES: Readonly<Record<SceneId, Scene>> = {
  'fogbound-cemetery': {
    id: 'fogbound-cemetery',
    mode: 'spooky',
    air: 'mist',
    title: 'Fogbound Cemetery',
    motto: 'Every agent leaves a stone.',
    palette: {
      sky: ['#24272c', '#3a3e45', '#5a5e64'],
      base: '#151619',
      surface: '#1f2125',
      ink: '#e7e4dc',
      muted: '#9b9a95',
      accent: '#dcb46a',
      accent2: '#86ad92',
      track: '#2c2e33',
    },
    gauge: 'LANTERN',
    gaugeThing: 'a lantern on the gate post, its oil burning',
    swarmThing: 'crow',
    music: 'music/fogbound-cemetery.mp3',
    musicTitle: 'The Past · TAD',
  },
  'drowned-lighthouse': {
    id: 'drowned-lighthouse',
    mode: 'spooky',
    air: 'mist',
    title: 'Drowned Lighthouse',
    motto: 'The beam finds what the fog hides.',
    palette: {
      sky: ['#1d2329', '#333d46', '#525e67'],
      base: '#121619',
      surface: '#1b2126',
      ink: '#e3e8eb',
      muted: '#93a0a8',
      accent: '#b9d6e4',
      accent2: '#e2b45e',
      track: '#26303a',
    },
    gauge: 'BEACON',
    gaugeThing: 'the lamp room of the lighthouse',
    swarmThing: 'gull',
    music: 'music/drowned-lighthouse.mp3',
    musicTitle: 'Lofi Again · omfgdude',
  },
  'hollow-library': {
    id: 'hollow-library',
    mode: 'spooky',
    air: 'mist',
    title: 'Hollow Library',
    motto: 'The books remember who wrote them.',
    palette: {
      sky: ['#1b191a', '#2a2627', '#3b3536'],
      base: '#141213',
      surface: '#201d1e',
      ink: '#ece4d8',
      muted: '#a39888',
      accent: '#e39b52',
      accent2: '#9a8bc2',
      track: '#2e292a',
    },
    gauge: 'CANDLE',
    gaugeThing: 'a tall candle burning down on the reading desk',
    swarmThing: 'floating book',
    music: 'music/hollow-library.mp3',
    musicTitle: 'Chill Lofi Inspired · omfgdude',
  },
  'crooked-manor': {
    id: 'crooked-manor',
    mode: 'spooky',
    air: 'stars',
    title: 'Crooked Manor',
    motto: 'One window is always lit.',
    palette: {
      sky: ['#111216', '#1d1f26', '#33353e'],
      base: '#0e0f12',
      surface: '#191a1f',
      ink: '#e5e3ea',
      muted: '#8f8d99',
      accent: '#e8dcae',
      accent2: '#c7584c',
      track: '#25262d',
    },
    gauge: 'MOON',
    gaugeThing: 'the moon waxing over the manor',
    swarmThing: 'bat',
    music: 'music/crooked-manor.mp3',
    musicTitle: 'Lofi Hip Hop · omfgdude',
  },
  clocktower: {
    id: 'clocktower',
    mode: 'spooky',
    air: 'stars',
    title: 'Clocktower at Midnight',
    motto: 'Every turn is counted.',
    palette: {
      sky: ['#15171b', '#252930', '#3d424a'],
      base: '#101114',
      surface: '#1b1d21',
      ink: '#e6e6e1',
      muted: '#999b9d',
      accent: '#7fbca6',
      accent2: '#e3bb62',
      track: '#292c31',
    },
    gauge: 'HOUR',
    gaugeThing: 'the clock face filling like a dial',
    swarmThing: 'raven',
    music: 'music/clocktower.mp3',
    musicTitle: 'Since 2 A.M. · TAD',
  },
  'mire-lights': {
    id: 'mire-lights',
    mode: 'spooky',
    air: 'stars',
    title: 'Mire Lights',
    motto: 'Follow no light you did not start.',
    palette: {
      sky: ['#0f1311', '#1a211d', '#2b342f'],
      base: '#0c0f0d',
      surface: '#161b18',
      ink: '#e1e8de',
      muted: '#8e9a8f',
      accent: '#c4e58f',
      accent2: '#8fb4da',
      track: '#212923',
    },
    gauge: 'WISPS',
    gaugeThing: 'a jar of gathered will-o-wisps',
    swarmThing: 'wisp',
    music: 'music/mire-lights.mp3',
    musicTitle: 'Lofi Hip Hop Loop · omfgdude',
  },

  // ── Cozy: warm, pleasant, lamplit; each scored with a lofi track ──

  'cat-cafe': {
    id: 'cat-cafe',
    mode: 'cozy',
    air: 'motes',
    title: 'Rainy Cat Café',
    motto: 'Stay for one more cup.',
    palette: {
      sky: ['#2b2a3d', '#4a4560', '#7a6475'],
      base: '#1a1517',
      surface: '#261e20',
      ink: '#f3e7da',
      muted: '#b3a092',
      accent: '#f2b36b',
      accent2: '#8fb8c9',
      track: '#33292b',
    },
    gauge: 'LATTE',
    gaugeThing: 'a latte on the window counter, filling to the brim',
    swarmThing: 'umbrella',
    music: 'music/cat-cafe.mp3',
    musicTitle: 'Cat Caffe · TAD',
  },
  'fireside-tea': {
    id: 'fireside-tea',
    mode: 'cozy',
    air: 'motes',
    title: 'Fireside Tea',
    motto: 'The kettle knows when to sing.',
    palette: {
      sky: ['#1c1420', '#2e1f2a', '#4a2d32'],
      base: '#150f10',
      surface: '#221819',
      ink: '#f5e6d6',
      muted: '#b39c8c',
      accent: '#ff9a52',
      accent2: '#9cc2a4',
      track: '#2e2223',
    },
    gauge: 'HEARTH',
    gaugeThing: 'the fire in the hearth, burning higher',
    swarmThing: 'candle',
    music: 'music/fireside-tea.mp3',
    musicTitle: 'A Cup of Tea · TAD',
  },
  'golden-porch': {
    id: 'golden-porch',
    mode: 'cozy',
    air: 'mist',
    title: 'Golden Hour Porch',
    motto: 'Nowhere to be but here.',
    palette: {
      sky: ['#3a2a4a', '#8a5a6a', '#e0a070'],
      base: '#1b1412',
      surface: '#271c18',
      ink: '#f7ead8',
      muted: '#bba48e',
      accent: '#ffc46b',
      accent2: '#d9826a',
      track: '#33261f',
    },
    gauge: 'HONEY',
    gaugeThing: 'a jar of honey on the porch rail, filling',
    swarmThing: 'swallow',
    music: 'music/golden-porch.mp3',
    musicTitle: 'Countryside · TAD',
  },
  'sunset-pier': {
    id: 'sunset-pier',
    mode: 'cozy',
    air: 'stars',
    title: 'Sunset Pier',
    motto: 'The tide keeps its own time.',
    palette: {
      sky: ['#2a2346', '#6b4466', '#e08a6e'],
      base: '#14131c',
      surface: '#1f1d29',
      ink: '#f3e9e4',
      muted: '#ab9ea6',
      accent: '#ff9e7a',
      accent2: '#7cc4c0',
      track: '#2b2836',
    },
    gauge: 'LANTERNS',
    gaugeThing: 'the lanterns along the pier, lit one by one',
    swarmThing: 'sailboat',
    music: 'music/sunset-pier.mp3',
    musicTitle: 'Oceanside · TAD',
  },
  'flower-shop': {
    id: 'flower-shop',
    mode: 'cozy',
    air: 'stars',
    title: 'Twilight Flower Shop',
    motto: 'Something is always about to bloom.',
    palette: {
      sky: ['#232a45', '#3d3f63', '#6c5a7a'],
      base: '#16141a',
      surface: '#221f27',
      ink: '#f4e8ee',
      muted: '#ae9fab',
      accent: '#ffa6b8',
      accent2: '#a8d08d',
      track: '#2d2934',
    },
    gauge: 'VASE',
    gaugeThing: 'a glass vase in the shop window, filling as the bouquet opens',
    swarmThing: 'butterfly',
    music: 'music/flower-shop.mp3',
    musicTitle: 'Florist · TAD',
  },
  'forest-cabin': {
    id: 'forest-cabin',
    mode: 'cozy',
    air: 'mist',
    title: 'Rainy Forest Cabin',
    motto: 'Let it rain a little longer.',
    palette: {
      sky: ['#1a2422', '#2c3a36', '#4a5a50'],
      base: '#111613',
      surface: '#1b221e',
      ink: '#eef0e2',
      muted: '#a3ab98',
      accent: '#ffbf5e',
      accent2: '#8fc7a8',
      track: '#26302a',
    },
    gauge: 'RAIN BARREL',
    gaugeThing: 'a rain barrel by the cabin door, filling',
    swarmThing: 'firefly',
    music: 'music/forest-cabin.mp3',
    musicTitle: 'Rainy Forest · TAD',
  },
}

export const SCENE_IDS = Object.keys(SCENES) as SceneId[]

/** The chosen mode and the scene remembered for each mode. */
export type Mood = { mode: ModeId; sceneByMode: Record<ModeId, SceneId> }

export const DEFAULT_MOOD: Mood = {
  mode: 'spooky',
  sceneByMode: { spooky: 'fogbound-cemetery', cozy: 'cat-cafe' },
}

/** The modes before the two categories (0.3 and earlier): each now a part of Spooky. */
const OLD_SPOOKY_MODES = new Set(['gray-hour', 'midnight', 'witching'])

const isMode = (value: unknown): value is ModeId => MODES.some(m => m.id === value)
const modeOf = (id: ModeId): Mode => MODES.find(m => m.id === id) ?? MODES[0]!

/**
 * A stored mood, checked: unknown modes or scenes, or a scene of another mode, fall back to the defaults. A mood stored
 * before the two categories (Gray Hour, Midnight, Witching Hour) becomes Spooky, on the scene it was showing.
 */
export function cleanMood(value: unknown): Mood {
  if (typeof value !== 'object' || value === null) return DEFAULT_MOOD
  const raw = value as { mode?: unknown; sceneByMode?: unknown }
  const stored = typeof raw.sceneByMode === 'object' && raw.sceneByMode !== null ? (raw.sceneByMode as Record<string, unknown>) : {}
  const old = typeof raw.mode === 'string' && OLD_SPOOKY_MODES.has(raw.mode) ? raw.mode : undefined
  const mode = isMode(raw.mode) ? raw.mode : old !== undefined ? 'spooky' : DEFAULT_MOOD.mode
  const sceneByMode = { ...DEFAULT_MOOD.sceneByMode }
  const remembered = (m: Mode): unknown => stored[m.id] ?? (m.id === 'spooky' && old !== undefined ? stored[old] : undefined)
  for (const m of MODES) {
    const id = remembered(m)
    if (typeof id === 'string' && m.scenes.includes(id as SceneId)) sceneByMode[m.id] = id as SceneId
  }
  return { mode, sceneByMode }
}

export const currentScene = (mood: Mood): Scene => SCENES[mood.sceneByMode[mood.mode]] ?? SCENES[DEFAULT_MOOD.sceneByMode[DEFAULT_MOOD.mode]]

/** The mood switched to `mode`, its remembered scene with it. */
export const withMode = (mood: Mood, mode: string): Mood => (isMode(mode) ? { ...mood, mode } : mood)

/** The mood showing `scene`: its mode chosen, and the scene remembered there. */
export function withScene(mood: Mood, scene: string): Mood {
  const found = SCENES[scene as SceneId]
  if (!found) return mood
  return { mode: found.mode, sceneByMode: { ...mood.sceneByMode, [found.mode]: found.id } }
}

export const scenesOf = (mode: ModeId): readonly Scene[] => modeOf(mode).scenes.map(id => SCENES[id])
