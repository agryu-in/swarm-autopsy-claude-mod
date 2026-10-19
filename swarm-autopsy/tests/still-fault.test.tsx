// When the desktop app stops one of the still pane's Clients (`ui.fault`), the pane draws the engine tree with the scene as
// a frame that follows scrolling: it lags a scroll and then snaps back into place, which is what the person saw
// ("the background also moves and comes to the fixed position"; the app's log: the content Client
// "returned a tree the page cannot draw"). That fallback is for a moment now, not the rest of the session: after a
// short wait the pane draws a fresh pair of Clients (new keys, so the page starts new instances), at most three times an
// opening; opening the pane again starts over. The test host raises no `ui.fault`, so the steps are checked here as the
// pure state the hooks keep (still-retry.ts); the hooks only schedule the wait and redraw.

import { describe, expect, test } from 'claude-code/testing'

import { afterCooling, afterFault, afterOpen, clientKey, fallbackNote, FRESH, isClientKey, RETRY_MS } from '../hooks/ui/client/still-retry'

const REASON = 'render: returned a tree the page cannot draw (malformed or past its bounds)'

describe('a Client the desktop app stops', () => {
  test('a fresh pane draws its Clients under their own keys, and no note', () => {
    expect(fallbackNote(FRESH)).toBeUndefined()
    expect([clientKey('sa-scene', FRESH), clientKey('sa-content', FRESH)]).toEqual(['sa-scene', 'sa-content'])
  })

  test('a fault: the engine tree while it waits, saying so; then a fresh pair of Clients under new keys', () => {
    const faulted = afterFault(FRESH, REASON)
    expect(faulted.retryInMs).toBe(RETRY_MS[0])
    expect(fallbackNote(faulted.state)).toContain('trying again')
    expect(fallbackNote(faulted.state)).toContain('cannot draw')
    const back = afterCooling(faulted.state)
    expect(fallbackNote(back)).toBeUndefined()
    expect([clientKey('sa-scene', back), clientKey('sa-content', back)]).toEqual(['sa-scene-1', 'sa-content-1'])
  })

  test('three tries an opening, each wait longer; then the engine tree with why, until the pane is opened again', () => {
    let state = FRESH
    const waits: Array<number | undefined> = []
    for (let i = 0; i < 3; i++) {
      const faulted = afterFault(state, REASON)
      waits.push(faulted.retryInMs)
      state = afterCooling(faulted.state)
    }
    expect(waits).toEqual([...RETRY_MS])
    expect(waits).toEqual([...waits].sort((a, b) => (a ?? 0) - (b ?? 0)))
    const spent = afterFault(state, REASON)
    expect(spent.retryInMs).toBeUndefined()
    expect(fallbackNote(spent.state)).toContain('reopen the pane')
    // Cooling never ends a spent opening on its own.
    expect(fallbackNote(afterCooling(spent.state))).toContain('reopen the pane')
    const reopened = afterOpen(spent.state)
    expect(fallbackNote(reopened)).toBeUndefined()
    expect(clientKey('sa-content', reopened)).toBe('sa-content-4')
    expect(afterFault(reopened, REASON).retryInMs).toBe(RETRY_MS[0])
  })

  test('opening a pane that never faulted keeps its Clients as they are', () => {
    expect(afterOpen(FRESH)).toEqual(FRESH)
  })

  test('presses and faults are heard from every generation of a Client, and from no other element', () => {
    expect(['sa-content', 'sa-content-1', 'sa-content-12'].map(key => isClientKey(key, 'sa-content'))).toEqual([true, true, true])
    expect(['sa-scene', 'sa-content-x', 'sa-contents', 'tab-live'].map(key => isClientKey(key, 'sa-content'))).toEqual([false, false, false, false])
  })
})
