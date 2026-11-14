# Contractor settlements and unpaid completed work

Completed unpaid applications remain in the settlement queue even when their price is missing. The canonical server report includes amounts entered on applications or a positive volume × rate, carries unpaid balances across month filters, and excludes cancelled and unfinished work. Unknown prices and missing contractors are explicit counts, not fabricated zero-value settlements.

Finance, payouts, contractor profiles, object history and monthly financial statistics use the shared calculation. CSV exports the complete filtered result, including carried balances. Accrual dates follow completion; payments follow their own date. Debt is the current outstanding balance across all periods, including when viewing an earlier month.

Office owners, administrators and accountants can enter a price, fill an absent contractor, and record a completed payment. Writes are versioned and locked; repeated confirmation is idempotent. Paid financial fields cannot be overwritten. An append-only payout ledger and application timeline preserve amount, contractor and payment changes. The ledger has no client grants or RLS policies: only the authenticated office endpoint reads it through the service role. Historical financial applications and contractors cannot be cascade-deleted.

Validation: full `npm run test:portal`, TypeScript, production build, Deno check. PostgreSQL tests cover unknown prices, cross-month balances, derived prices, role denial, stale writes, repeated payments, retention, and more than 1,000 entries. Browser QA at 390 px covers entering a price, recording a synthetic payment, balance changes, contractor history, CSV, and read-only actions. Screenshot uses synthetic data only.

Deployment order: additive `20261114201146_contractor_debt_history.sql`, `rpv-portal`, then web assets. Existing amounts, contractor assignments and payment flags were verified unchanged. No real payout was recorded during release validation. Legacy zero amounts still require an authorized user to supply the agreed price.
