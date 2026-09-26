# Agent context: services/resident
Owner: Brandon. Spec sections given to agents: 0, 10 (all of 10.1 to 10.5), 18 (+ contracts).
- The LLM never types finding labels/numbers: use {{FINDING.*}} placeholders, substitute server-side, then validate.
- Every factual sentence ends with [[obj:<type>:<uuid>]]. Uncited clinical sentences are removed.
- Tool calls go through the gateway WITH THE USER'S TOKEN and header `X-Actor-Kind: resident`.
- Scribe: frames in memory only; never to disk, logs, Claude, or any external API. Qwen3.8-27B runs in the local `vlm` container.
- Pin the Mellea version. Fallback: direct Claude tool use + Pydantic + same validators.
