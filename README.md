# Claude Usage — Cinnamon panel applet

Shows remaining Claude Code budget in the Cinnamon panel.

Panel label looks like:

    Claude 38% · 1h47m

Click the label for a dropdown with the active 5-hour window, the rolling
7-day total, and a per-model breakdown.

## How it works

Claude Code writes per-turn token-usage records to `~/.claude/projects/**/*.jsonl`.
A small Python helper (`scripts/usage.py`) scans those files, detects the
active 5-hour rolling block (a new block starts whenever 5h have passed since
the previous block's start, or after a 5h gap of inactivity), and sums tokens.

The applet (`applet.js`) runs the helper every 60 seconds (configurable) and
renders the result. No network calls, no external dependencies beyond
Python 3.

### Weighted tokens

Raw token counts are dominated by `cache_read_input_tokens` (often 90%+),
which makes them misleading for rate-limit pressure. The helper also reports
a **weighted** token count using cost-proportional weights:

| Token kind            | Weight |
| --------------------- | ------ |
| input                 | 1.0    |
| cache_creation_input  | 1.25   |
| cache_read_input      | 0.1    |
| output                | 5.0    |

The panel percentage is computed against weighted tokens.

## Install

    bash install.sh

Then right-click the Cinnamon panel → **Applets** → find **Claude Usage** →
click +.

## Settings

| Key                | Default      | Notes                                                                  |
| ------------------ | ------------ | ---------------------------------------------------------------------- |
| `refresh-interval` | 60 s         | How often to re-scan the jsonl logs.                                   |
| `limit-5h`         | 8,000,000    | Weighted-token budget for the 5h rolling window.                       |
| `limit-week`       | 50,000,000   | Weighted-token budget for the rolling 7-day window.                    |

The defaults are rough estimates for heavy Opus use on a Max plan — tune them
to your observed maximum if you want the percentage to mean something
specific.

## Development

After editing files, hot-reload the applet without restarting Cinnamon:

    dbus-send --session --dest=org.Cinnamon.LookingGlass --type=method_call \
      /org/Cinnamon/LookingGlass org.Cinnamon.LookingGlass.ReloadExtension \
      string:'claude-usage@jakob' string:'APPLET'

Sanity-check the helper standalone:

    python3 scripts/usage.py | jq .
