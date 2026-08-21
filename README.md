# Claude Usage — status-bar readouts

Shows how much of your Claude Code budget you have consumed, in your status bar.
The percentage counts **up** as you use budget. Ships two front-ends over
one data source (`scripts/usage.py`): a **Cinnamon panel applet** and an
**xmobar / xmonad** integration.

Label looks like:

    Claude 38% · 1h47m

In Cinnamon, click the label for a dropdown with the active 5-hour window, the
rolling 7-day total, and a per-model breakdown.

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

## Install (Cinnamon)

    bash install.sh

Then right-click the Cinnamon panel → **Applets** → find **Claude Usage** →
click +.

## Settings

| Key                | Default      | Notes                                                                  |
| ------------------ | ------------ | ---------------------------------------------------------------------- |
| `refresh-interval` | 60 s         | How often to re-scan the jsonl logs.                                   |
| `limit-5h`         | 90,000,000   | Weighted-token budget for the 5h rolling window.                       |
| `limit-week`       | 50,000,000   | Weighted-token budget for the rolling 7-day window.                    |

These budgets are local guesses, not your account's real rate limit — nothing
here talks to Anthropic. Uncalibrated, the panel percentage will not match the
one Claude Code's own `/status` reports, and can be off by an order of
magnitude.

### Calibrating

Do this once per plan tier:

1. Note the 5h percentage that `/status` shows inside Claude Code — call it `P`.
2. Read the weighted tokens for the same window:
   `python3 scripts/usage.py | jq .block.weighted` — call it `W`.
3. Set `limit-5h` to `W / (P / 100)`.

Example: `/status` says 8%, `block.weighted` is 7,450,000 → `limit-5h` =
93,000,000. Repeat with `/status`'s weekly percentage and `.week.weighted`
for `limit-week`.

The 5h default above is one such measurement (heavy Opus 5 use, Max plan), so
it is a better starting point than a round number — but it is still someone
else's account. Calibrate.

## xmobar / xmonad

xmobar has no applet model — it runs a command on an interval and drops the
output into its template. `scripts/usage.py` has a single-line mode for exactly
this:

    python3 scripts/usage.py --format xmobar

prints one line, e.g. `<fc=#e0c060>Claude 38% · 1h47m</fc>` (or `Claude idle`).
The `<fc>` color tracks 5h-budget usage: green `<60%`, yellow `60–85%`, red
`>85%`, grey when idle. Add `--no-color` for plain text.

No install/symlink is needed (unlike Cinnamon). Just wire it into your bar:

1. Copy the relevant bits from [`examples/xmobar/claude.xmobarrc`](examples/xmobar/claude.xmobarrc)
   into your xmobar config and fix the absolute path to `scripts/usage.py`.
2. Make sure xmonad launches that xmobar config — see
   [`examples/xmonad/xmonad.hs.snippet`](examples/xmonad/xmonad.hs.snippet).
   xmonad itself renders nothing here; xmobar polls the script via `Run Com`.

Tune the budgets with `--limit-5h` / `--limit-week` on the `Run Com` args, or by
exporting `CLAUDE_LIMIT_5H` / `CLAUDE_LIMIT_WEEK` in the session that starts
xmonad (xmobar inherits that environment).

## Development

After editing files, hot-reload the applet without restarting Cinnamon:

    dbus-send --session --dest=org.Cinnamon.LookingGlass --type=method_call \
      /org/Cinnamon/LookingGlass org.Cinnamon.LookingGlass.ReloadExtension \
      string:'claude-usage@jakob' string:'APPLET'

Sanity-check the helper standalone:

    python3 scripts/usage.py | jq .          # JSON (Cinnamon applet)
    python3 scripts/usage.py --format xmobar # single line (xmobar)
