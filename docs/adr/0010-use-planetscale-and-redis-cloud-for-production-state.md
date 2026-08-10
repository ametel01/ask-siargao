# Use PlanetScale and Redis Cloud for production state

Ask Siargao will use separate PlanetScale Postgres databases and paid Redis Cloud Essentials
subscriptions for production and Protected Staging in Singapore. Production uses PostgreSQL 17 on
the smallest highly available PlanetScale cluster that satisfies the launch limits, while Protected
Staging may use the smallest single-node cluster; application traffic uses the included local
PgBouncer and controlled migrations use direct connections. PlanetScale custom backups extend PITR
to the accepted seven-day window, while Redis Cloud supplies TLS, single-primary Redis semantics,
replication, AOF persistence, and `noeviction` behavior for strict allowance, idempotency, lease, and
cost-circuit state; this accepts two managed data vendors rather than operating either datastore.
