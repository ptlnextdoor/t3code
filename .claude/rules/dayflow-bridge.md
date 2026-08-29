---
paths:
  - "**/dayflow*"
  - "**/today*"
  - "**/Today*"
---

# Dayflow bridge

The TODAY panel reads the user's real screen-activity from Dayflow's local SQLite. **Read-only. Never write to this DB.**

- Path: `~/Library/Application Support/Dayflow/chunks.sqlite`
- Back up before any experiment: copies live in `.../Dayflow/backups/`.

## Key table: `timeline_cards`

AI-labeled activity blocks. Columns that matter:

| Column               | Meaning                                                 |
| -------------------- | ------------------------------------------------------- |
| `start_ts`, `end_ts` | Unix seconds. Duration = `end_ts - start_ts`            |
| `day`                | DATE                                                    |
| `title`              | AI summary of the activity block                        |
| `category`           | `Work` / `Distraction` / `Personal` / `System` / `Idle` |
| `is_deleted`         | Always filter `WHERE is_deleted = 0`                    |

## Canonical queries

Time by category today:

```sql
SELECT category, ROUND(SUM(end_ts-start_ts)/3600.0,1) hrs
FROM timeline_cards WHERE is_deleted=0 AND day=date('now','localtime')
GROUP BY category ORDER BY hrs DESC;
```

The panel also reads `~/.jcode/knowledge-org/NOW.md` (what needs the user today) and `~/.jcode/knowledge-org/FRONTS.md` (all 35 fronts). These are refreshed nightly by a launchd job (`com.aayu.jcode-knowledge-refresh`).
