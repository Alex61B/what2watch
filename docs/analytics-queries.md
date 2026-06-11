# Analytics queries (Event table)

First-party product analytics live in the `Event` table (see the event-tracking spec/plan).
No dashboard yet — these are copy-paste SQL. Pseudonymous: `anonId` (device) + optional `userId`.

## Top movies by clean average dwell (excludes capped values)

```sql
SELECT props->>'movieId' AS movie,
       round(avg((props->>'dwellMs')::int)) AS avg_dwell_ms,
       count(*) AS views
FROM "Event"
WHERE type = 'card_decided'
  AND coalesce((props->>'dwellCapped')::bool, false) = false
GROUP BY 1
ORDER BY avg_dwell_ms DESC
LIMIT 25;
```

## YES-rate per movie (min 5 votes)

```sql
SELECT props->>'movieId' AS movie,
       round(100.0 * avg(((props->>'vote') = 'true')::int), 1) AS yes_pct,
       count(*) AS votes
FROM "Event"
WHERE type = 'card_decided'
GROUP BY 1
HAVING count(*) >= 5
ORDER BY yes_pct DESC;
```

## Funnel: created → started → matched (last 7 days)

```sql
SELECT type, count(DISTINCT "roomId") AS rooms
FROM "Event"
WHERE type IN ('room_created', 'room_started', 'room_matched')
  AND ts > now() - interval '7 days'
GROUP BY type;
```

## Feature usage

```sql
SELECT props->>'feature' AS feature, count(*) AS uses
FROM "Event"
WHERE type = 'feature_used'
GROUP BY 1
ORDER BY uses DESC;
```

## DAU (distinct devices/day) + logged-in split

```sql
SELECT date_trunc('day', ts) AS day,
       count(DISTINCT "anonId") AS dau,
       count(DISTINCT "userId") FILTER (WHERE "userId" IS NOT NULL) AS logged_in
FROM "Event"
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;
```

## Retention purge — 90 days (run manually / via a future cron)

```sql
DELETE FROM "Event" WHERE ts < now() - interval '90 days';
```

> Note: `room_created/joined/started` and `feature_used` are wired in Phase 2b; `card_decided`
> and `room_matched` are live as of Phase 2a.
