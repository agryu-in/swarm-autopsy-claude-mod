# Swarm Autopsy · Claude Mod

A live forensic pane for multi-agent Claude Code sessions. It shows:
- what each subagent was asked to do;
- what it observably did, and what its tokens were;
- how its report connects to the edits and tests that followed;
- where agents collided, and what is still unresolved.

Every claim carries an evidence label, so you can always tell what was **observed** from what was **inferred**.

In the Claude desktop app the pane is drawn over a **still, animated scene** that never moves while you scroll. There are
two categories of six scenes:
- **Spooky:** dark gray and a little haunted;
- **Cozy:** warm lamplight and golden hour.

Every scene has its own **lofi track** and **liquid-glass** cards whose transparency you choose. In the terminal it draws
a clean classic look.

> A community mod, not made by or affiliated with Anthropic.

![Swarm Autopsy in the Claude desktop app, over the Cozy scene Twilight Flower Shop: the toolbar, four summary cards, the coordinator, five subagents' cards, recent activity and health](docs/images/pane-cozy-twilight-flower-shop.jpg)

<p align="center">
  <img src="docs/images/side-pane-spooky-fogbound-cemetery.jpg" alt="The default side pane, over the Spooky scene Fogbound Cemetery: the toolbar, the four summary cards two to a row, the coordinator and the subagents" width="23%">
  <img src="docs/images/pane-spooky-fogbound-cemetery.jpg" alt="The expanded pane over Fogbound Cemetery, with five subagents of five different types, the code reviewer still active" width="75%">
</p>

<p align="center"><i>The default side pane and the expanded pane. Five subagents of five different types (Explore,
general-purpose, a coder, a test engineer and a code reviewer) fixing a bug in a demo project, live.</i></p>

<p align="center">
  <img src="docs/images/pane-cozy-rainy-forest-cabin.jpg" alt="The same session over the Cozy scene Rainy Forest Cabin" width="49%">
  <img src="docs/images/pane-spooky-hollow-library.jpg" alt="The same session over the Spooky scene Hollow Library" width="49%">
  <img src="docs/images/pane-spooky-drowned-lighthouse.jpg" alt="The same session over the Spooky scene Drowned Lighthouse" width="49%">
  <img src="docs/images/pane-spooky-mire-lights.jpg" alt="The same session over the Spooky scene Mire Lights" width="49%">
</p>

<p align="center"><i>The same session over Rainy Forest Cabin, Hollow Library, Drowned Lighthouse and Mire Lights.</i></p>

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install swarm-autopsy --marketplace agryu-in/swarm-autopsy-claude-mod
```

Answer `y` to add the marketplace, then press Enter to choose the user scope, so the mod is installed for every project.

From a shell:

```bash
claude plugin install swarm-autopsy --marketplace agryu-in/swarm-autopsy-claude-mod
```

**In the Claude desktop app**, where `/plugin` does not run:
1. Click **+** next to the prompt box, then **Plugins**.
2. Choose **Add marketplace** and enter `agryu-in/swarm-autopsy-claude-mod`.
3. Choose **Add plugin**.

A mod installed from a terminal at the user scope loads in the desktop app's local sessions too. In a chat that was
already open, run `/reload-plugins`.

**Requirements:**
- Claude Code with mods (function hooks): 2.1.287 or later. Tested with Claude Code 2.1.301 (CLI) and 2.1.299 (the
  desktop app's engine). The mod API is early access and may change between releases.
- For the music: macOS, or Linux with PulseAudio or PipeWire (`paplay` and `pactl`). Without either, the pane simply
  says there is no audio player.
- `git` is optional: the Collisions view uses it to resolve worktree roots.

## Use it

| Command | What it does |
| --- | --- |
| `/swarm-autopsy` | Opens the pane: docked beside the transcript, or inline above the prompt in a non-fullscreen terminal |
| `/swarm-autopsy live` | Opens it on a view; also `trail`, `collisions`, `forensics`, `spend` or `health` |
| `/swarm-autopsy export` | Writes the collected session to a JSON file under the session's root and says where |
| `/swarm-autopsy close` | Closes the pane |

In the terminal, `1` to `6` switch views while the pane has the keyboard (`ctrl+x tab`, or a click). Tab walks the
buttons, and Esc hands the keys back. On the desktop, click the tabs.

## The views

| View | Shows |
| --- | --- |
| **Live** | The coordinating session, and one card per subagent: type, parent, task, state, last event, current tool, files, whether a report was captured, its own token usage (and its spawn tree's), and a context gauge. A card opens into its delegated prompt, files, report, context history, token ledger, spend-vs-outcome classification and event history. |
| **Trail** | Per agent, the chain from delegation to verification, and the edges between chains. Each edge carries its evidence and the rule that drew it. On the desktop, a map draws the same graph (solid = LINKED, dashed = INFERRED). |
| **Collisions** | A file × agent matrix (W written, r read, × failed edit), and signals: shared or interleaved writes, one agent replacing text another wrote, writes after a stale read, the same path changed in separate worktrees, edits during a running test, repeated failures, contradictory results. |
| **Forensics** | Every observed event in order, filterable (all / agents / files / tests / failures / signals) and by agent, paged, with the selected event's evidence: source hook, ids, paths, command, diff excerpt, result, and verdict basis. |
| **Spend** | The token ledger: per agent, its own requests (direct) and its whole spawn tree (subtree), with the four token categories kept apart, and session totals. A ≈$ API-equivalent estimate is shown only after you turn it on. Below it, *spend vs outcome*: each agent's tokens grouped by what its work amounted to (verified, changed but unverified, failed or inconclusive, report only, unresolved, mixed), with the denominator stated. |
| **Health** | The findings the other analyses already raised, grouped by source, each with its evidence label, its agents and its events. No score and no traffic light. |

## The desktop look

**The toolbar** is a quiet glass bar fixed at the top of the pane:

| Control | What it does |
| --- | --- |
| **Mode** | The category: Spooky or Cozy |
| **Scene** | The scene within the category |
| **▶ Play / ⏸ Pause** and **Volume** ▁▃▅▇█ | The scene's lofi track |
| **Transparency** ◆◆◆◇◇ | How clear the liquid glass is, from frosted to crystal |

Your choices are kept for every chat. One chat plays the music at a time. When that chat closes, another takes over.

**The background** stays perfectly still while the content scrolls over it. It is drawn for the pane's own shape: a tall
side dock, a normal pane, or a wide one. A view too long for one drawing comes in **parts**, each scrolling smoothly over
the still scene. **Next part ▾** at the bottom of a part moves on.

**The scenes.** Each draws the main session's context fill as part of the picture, and one figure per active subagent:

| Mode | Scene | The context gauge | Each active subagent is |
| --- | --- | --- | --- |
| Spooky | Fogbound Cemetery | a lantern on the gate post, its oil lit | a crow on the fence |
| | Drowned Lighthouse | the lamp room filling with light | a gull |
| | Hollow Library | a candle burning down | a floating book |
| | Crooked Manor | the moon waxing | a bat |
| | Clocktower at Midnight | the clock face filling like a dial | a raven |
| | Mire Lights | a jar of gathered wisp light | a will-o'-wisp |
| Cozy | Rainy Cat Café | a latte filling to the brim | an umbrella passing in the rain |
| | Fireside Tea | the fire in the hearth, burning higher | a candle lit on the mantel |
| | Golden Hour Porch | a jar of honey on the porch rail | a swallow |
| | Sunset Pier | the pier's lanterns, lit one by one | a sailboat on the horizon |
| | Twilight Flower Shop | a glass vase filling as the bouquet opens | a butterfly |
| | Rainy Forest Cabin | a rain barrel by the door | a firefly |

**Colour.** Every colour that carries meaning follows the scene but keeps its meaning: verified stays green, a failure
red, caution warm. Each scene's palette is checked for 4.5:1 text contrast on its glass.

## All twelve scenes

Each scene draws the main session's context as part of the picture (here at 62%) and one figure per active subagent.

![The six Cozy scenes](docs/images/cozy.png)

![The six Spooky scenes](docs/images/spooky.png)

## Reading the evidence labels

| Label | Glyph | Meaning |
| --- | --- | --- |
| OBSERVED | ● | Reported directly by an event, message, command result or tool result. |
| LINKED | ◆ | Connected by explicit identifiers: a spawn's parent, `agentId` on the agent's own events, a verbatim excerpt of one agent's report in another's delegation prompt, a delegation prompt naming the exact path the agent then edited, or an edit replacing text another agent wrote. |
| INFERRED | ◇ | Plausible from indirect evidence: a shared path or file stem plus event order. A candidate, not proof. |
| UNRESOLVED | ? | Not enough evidence to decide: an *unlinked contribution*, an *unverified change*, a latest test run that failed. |
| UNAVAILABLE | ∅ | The interface does not expose it: a subagent's context %, the task of an agent spawned before the mod loaded. |

Numbers carry a simpler label:
- **OBSERVED ●:** read from an event.
- **ESTIMATED ≈:** computed from a stated assumption, such as a ≈$ figure, or a subagent's % on the same model as the
  main session.
- **UNAVAILABLE ∅:** not exposed or not yet captured.

## What it deliberately does not do

- **Model calls:** it never calls a model, so it cannot invent connections. Every link comes from a fixed rule over
  identifiers, paths and event order.
- **Value judgements:** it never calls a contribution "ignored", "unused" or "wasted". It can only say that no
  downstream evidence was captured.
- **Test results:** it never labels a test passed unless the tool's captured result says success.
- **Context %:** it shows one only where a window is known.
- **Your session:** it never blocks, delays or rewrites a tool call, spawn or prompt. Its hooks pass every result
  through unchanged.
- **Privacy:** it has no cloud service, network call or database. The session's record lives in the session and resets
  on `/clear`. Only your scene, music and glass choices are kept across sessions, in the mod's own store. `export`
  writes a file only when you ask.

## Known limitations

- Activity before the mod loaded is not captured; the pane says so, and agents still running are adopted.
- Shell commands' file side effects are not attributed to paths. Only Edit, Write and NotebookEdit count as writes.
- The timeline keeps the latest 1,200 events, and older ones are counted as dropped. Agent totals still include them.
- Path mentions in reports are read with a pattern, so a link from a shared file name is INFERRED, never proof.
- The desktop scenes use the desktop app's drawing surface. Other surfaces draw the classic look.

## Develop

The mod lives in `swarm-autopsy/`. Its tests run in Claude Code's own test host:

```bash
claude plugin validate ./swarm-autopsy
```

```bash
claude plugin test ./swarm-autopsy
```

To type-check: load the mod once (for example with `claude --plugin-dir ./swarm-autopsy`), which writes its types into
`swarm-autopsy/.claude-plugin/types/`, then run `npx tsc -p swarm-autopsy`.

## Credits and licence

- **The code:** © 2026 agryu-in, all rights reserved; it carries no open-source licence. You are welcome to install and
  use the mod. To reuse or change its code elsewhere, ask first.
- **The music:** CC0 lofi by TAD and omfgdude, from [OpenGameArt](https://opengameart.org). Each track's page and author
  are listed in [swarm-autopsy/music/CREDITS.md](swarm-autopsy/music/CREDITS.md). Thank you both.
