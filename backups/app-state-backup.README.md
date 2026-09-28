# YetLand application state backup

This private backup contains non-user application configuration and catalogs extracted from the runtime state.

Excluded: users and direct identifiers, sessions, messages, conversation logs, summaries, analytics, quotas, payments, subscriptions, auth tokens, API credentials, API keys, secrets, and other runtime-sensitive records.

API/provider configuration is intentionally omitted entirely. This file is not a production restore image; review it before using it to seed another environment.
