// The art rules for the scenes, checked at several context fills and swarm sizes: unique ids
// per drawing, loops already running (no positive `begin`), deterministic output, no script or
// external reference, and under the Svg element's size limit.

import { describe, expect, test } from 'claude-code/testing'

import { sceneAlt, sceneSvg } from '../hooks/art/scene.ts'
import { SCENES, SCENE_IDS } from '../hooks/lib/scenes.ts'

const SVG_LIMIT = 131_072

/** Every art rule a drawing breaks, as a list (empty when it keeps them all): one assertion per drawing, not per id. */
function ruleProblems(svg: string, uidPrefix: string): string[] {
  const problems: string[] = []
  if (!svg.startsWith('<svg ')) problems.push('not an svg document')
  if (svg.length >= SVG_LIMIT) problems.push(`${svg.length} characters`)
  // every id defined belongs to this drawing, once
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map(m => m[1] ?? '')
  const known = new Set(ids)
  for (const id of ids) if (!id.startsWith(uidPrefix)) problems.push(`id ${id} lacks ${uidPrefix}`)
  if (known.size !== ids.length) problems.push('an id defined twice')
  // every reference points at an id of this drawing
  for (const ref of svg.matchAll(/url\(#([^)]+)\)/g)) if (!known.has(ref[1] ?? '')) problems.push(`url(#${ref[1]}) resolves to nothing`)
  // loops start at once
  for (const begin of svg.matchAll(/begin="([^"]+)"/g)) if (Number.parseFloat((begin[1] ?? '0').replace('s', '')) > 0) problems.push(`begin ${begin[1]}`)
  // nothing that runs or fetches
  if (/<script|\son[a-z]+=|href="http|xlink:href="http|<image/i.test(svg)) problems.push('something that runs or fetches')
  // numbers stay short (n()): no long float runs
  if (/\d\.\d{4,}/.test(svg)) problems.push('a long number')
  return [...new Set(problems)]
}

/** Each scene draws its whole rule run (16 drawings, twice each); on a loaded machine that takes more than 5 s. */
const SLOW = { timeoutMs: 60_000 }

describe('scene art', () => {
  for (const id of SCENE_IDS) {
    test(`${id}: follows the art rules at every fill and swarm size, the same every time`, SLOW, () => {
      const scene = SCENES[id]
      for (const context of [undefined, 0, 0.5, 1])
        for (const swarm of [0, 1, 4, 12]) {
          const input = { scene, context, contextText: context === undefined ? '—' : `${Math.round(context * 100)}%`, swarm, width: 340 }
          const svg = sceneSvg(input)
          expect({ context, swarm, problems: ruleProblems(svg, `sa-${id}-scene`) }).toEqual({ context, swarm, problems: [] })
          expect(sceneSvg(input)).toBe(svg)
        }
      // the gauge caption is drawn, by the scene's own name
      expect(sceneSvg({ scene, context: 0.42, contextText: '42%', swarm: 2, width: 340 })).toContain(scene.gauge)
      expect(sceneSvg({ scene, context: 0.42, contextText: '42%', swarm: 2, width: 340 })).toContain('42%')
      // a narrow pane scales it down rather than squashing it
      expect(sceneSvg({ scene, context: 0.3, contextText: '30%', swarm: 0, width: 260 })).toMatch(/width="260" height="291"/)
    })
  }

  test('each swarm figure is one active subagent: more agents draw more, at most nine', SLOW, () => {
    for (const id of SCENE_IDS) {
      const scene = SCENES[id]
      const size = (swarm: number) => sceneSvg({ scene, context: 0.5, contextText: '50%', swarm, width: 340 }).length
      expect(size(3)).toBeGreaterThan(size(0))
      expect(size(9)).toBeGreaterThan(size(3))
      expect(size(20)).toBe(size(9))
    }
  })

  test('the alt text names the scene, the gauge and the swarm', () => {
    const scene = SCENES['fogbound-cemetery']
    expect(sceneAlt(scene, '42%', 3)).toBe(
      'Fogbound Cemetery: Every agent leaves a stone. Main context 42%, shown as a lantern on the gate post, its oil burning; 3 crows, one per active subagent.',
    )
    expect(sceneAlt(scene, '—', 0)).toContain('no crows: no subagent is active')
  })
})
