# Timed messages and sarcasm level

Tasks EVE-55 (timing) and EVE-56 (texts). The overlay does not comment on every log line: it says something when a
situation has lasted a while, when it is over, or when something notable happens. Messages appear as chat bubbles at
the bottom right of the overlay for 60 s (EVE time) and can be closed while the overlay is interactive.

## When a message appears

| Trigger              | Sustained after | Source                                                    |
| -------------------- | --------------- | --------------------------------------------------------- |
| `neut`               | 3 min           | game log (`energy neutralized`)                           |
| `ecm`                | 1 min           | game log (`You're jammed by`)                             |
| `web`                | 2 min           | known capability of NPCs that keep attacking (not logged) |
| `sensorDamp`         | 2 min           | known capability (not logged)                             |
| `trackingDisruption` | 2 min           | known capability (not logged)                             |
| `guidanceDisruption` | 2 min           | known capability (not logged)                             |
| `targetPaint`        | 2 min           | known capability (not logged)                             |

- **ended**: 30 s without the situation, only after it was sustained.
- **events**: `longFight` (5 min with at least two kinds of threat) and `multiTrigger` (two different triggers of the
  selected encounter shot within a minute).
- A pause longer than 30 s restarts the clock.
- Scram and point are not messages: they stay instant threat lines at every level.

## Sarcasm level

_Settings → Overlay → Backseat Capsuleer_ (0–3, default 0), the voice of the timed messages:

| Level | Tone                                                        |
| ----- | ----------------------------------------------------------- |
| 0     | plain and explanatory: what happens and what to do about it |
| 1     | friendly, still with the hint                               |
| 2     | sarcastic, with a short hint                                |
| 3     | pure sarcasm (the threat lines above still carry the facts) |

## Texts

Bundled texts: `messages/messages.yaml`. A level without texts uses the next lower one; each message gets one text,
picked at random without repeats until the list is used up.

```yaml
neut:
  sustained:
    0: ['{npcs} {has} been draining your capacitor for {min} min. …']
    3: ['{Min} minutes, {gj} GJ. Are you donating capacitor to charity, capsuleer?']
  ended:
    3: ['Well, that seems quieter. Did you fix it, or did they get bored?']
```

Placeholders: `{npcs}` (who), `{has}` (has/have), `{min}` (minutes as a number), `{Min}` (as a word, "Three"),
`{gj}` (GJ neutralized in this stretch; neut only).

Your own `messages.yaml` in the app's data folder (Linux: `~/.local/share/gridwise/`) replaces single lists of
the bundled file, e.g. only `neut → sustained → 3`. It is read at start; `npm run kb -- check` validates both files.
Quote texts that contain placeholders inside `[…]` lists (`['{npcs} …']`), otherwise YAML reads `{…}` as a map.
