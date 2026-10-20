# logs — append-only change ledger (covers both the ideas and output layers)

Convention: each line is `- date · card/doc · action · delta (minimal old → new) · reason`;
record the **delta itself**; once output exists, one line per layer per change;
append only, never rewrite old lines.

- 2026-10-19 · target.md · set target · empty target → multi-user AIRI backend with MCP and knowledge base · user requested the analysis
- 2026-10-19 · sources · add evidence · empty → five repository evidence cards · architecture must reuse verified project boundaries
- 2026-10-19 · ideas · transcribe decisions · empty → modular API, owner scope, remote MCP, PostgreSQL knowledge base · derived from the user's simplicity and capability requirements
- 2026-10-19 · output · first assembly · empty → system design, modules, file map, and implementation plan · user requested a complete backend analysis
- 2026-10-19 · board · add comparison · empty → first-version scope comparison · make deferred choices visible
