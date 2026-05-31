# policy.yaml primer

What the fields in `~/.fivedrisk/policy.yaml` mean. The fivedrisk Python
library is the source of truth; this primer is a quick read for the
operator hand-editing the file.

## The 5 dimensions

Every action is scored on five dimensions, each 0 to 4:

| Dim | Name | What it captures |
|---|---|---|
| D | data_sensitivity | How sensitive is the data being touched? 0 = public, 4 = secrets, PII, financial records |
| T | tool_privilege | How privileged is the tool? 0 = read-only, 4 = root / destructive |
| R | reversibility | How undoable is the action? 0 = trivial undo, 4 = irreversible (rm, force-push, drop table) |
| E | external_impact | How much does it touch the outside world? 0 = local-only, 4 = production system / external counterparty |
| A | autonomy_context | How autonomous is the agent right now? 0 = step-by-step approval, 4 = fully autonomous long-horizon |

Scores combine into a single weighted score; the score plus per-dimension
thresholds determine the band.

## Bands

| Band | Default trigger | Plugin behavior |
|---|---|---|
| GREEN | score < `yellow_score` | pass through, log GREEN row |
| YELLOW | `yellow_score` <= score < `orange_score` | pass through, log YELLOW row with full dimension scores |
| ORANGE | `orange_score` <= score < `red_score`, OR any dim >= `orange_threshold` | `requireApproval`, log ORANGE row with HITL history |
| RED | score >= `red_score`, OR any dim >= `red_threshold` | block, log RED row with escalation detail |

Lower the band scores to make the gate stricter; raise them to loosen.

## Top-level fields

```yaml
version: "0.2.0"   # schema version; do not edit

bands:
  yellow_score: 0.9    # GREEN/YELLOW boundary
  orange_score: 1.5    # YELLOW/ORANGE boundary
  red_score: 2.2       # ORANGE/RED boundary

thresholds:
  red_threshold: 4     # any dim hitting this forces RED regardless of weighted score
  orange_threshold: 3  # any dim hitting this forces at least ORANGE

enable_yellow_band: true   # set false to collapse GREEN+YELLOW into GREEN

weights:
  data_sensitivity: 1.0
  tool_privilege: 1.4
  reversibility: 1.8
  external_impact: 1.2
  autonomy_context: 0.9
```

## tool_defaults

Per-tool starting scores. Keyed by tool name (the OpenClaw tool name, or
an MCP tool name like `filesystem.write`):

```yaml
tool_defaults:
  Bash:
    tool_privilege: 3
    reversibility: 3
    external_impact: 2
  WebFetch:
    tool_privilege: 2
    reversibility: 1
    external_impact: 2
```

The scoring engine uses these as the starting point; bash_overrides
(below) and the injection scanner can bump individual dimensions.

## bash_overrides

Regex patterns matched against Bash command strings, with per-dimension
overrides applied on match:

```yaml
bash_overrides:
  "rm -rf":
    tool_privilege: 4
    reversibility: 4
  "curl.*\\|.*sh":
    tool_privilege: 4
    external_impact: 3
    reversibility: 3
```

Patterns are evaluated in order; first match wins. Quote the keys.
Backslashes need to be doubled in YAML strings (`\\|` for a literal `|`).

## Tuning patterns

| You want... | Edit |
|---|---|
| Block more aggressively | Lower `bands.red_score` and `bands.orange_score` |
| Send everything writeable to HITL | Lower `bands.orange_score` to ~1.0 |
| Loosen for a sandbox env | Raise `bands.yellow_score` and `bands.orange_score` |
| Cover a new MCP tool | Add an entry under `tool_defaults` |
| Block a specific command shape | Add a regex under `bash_overrides` |
| Stop logging YELLOW band entirely | Set `enable_yellow_band: false` |

## What this file does NOT contain

- API keys, tokens, credentials of any kind
- Per-decision history (that is the audit log at `~/.fivedrisk/audit.sqlite`)
- Per-session Markov state (also in the audit DB)
- HITL routing (Slack webhook URLs etc go in OpenClaw's native channel config, not here)

## See also

- fivedrisk library `ARCHITECTURE.md` for the full scoring algorithm.
- `references/hitl-patterns.md` for three concrete HITL integration shapes.
- `SKILL.md` step 2 for how this file was generated initially.
