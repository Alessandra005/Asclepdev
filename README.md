# Asclep

Ontology and decision-support layer that sits on top of existing EHRs and shows clinicians only the slice of data they need right now.

**The spec is the source of truth:** see `docs/SPEC.md` (exported from the Claude Doc). If code and spec disagree, the spec wins.

## Quick start

```bash
cp infra/.env.example infra/.env   # fill in real values
make up                            # start all services (mocks included)
make test                          # run backend tests
```

Gateway docs: http://localhost:8000/docs

## Layout and owners

| Path | Owner | What |
| --- | --- | --- |
| `packages/contracts` | Ron | Pydantic models shared by every service. **Frozen after hour 2.** |
| `services/api` | Ron (auth, rbac, audit, migrations) + Alessandra (routes, ontology, ingest, alerts, ehr) | FastAPI gateway |
| `services/lab-tech` | Brandon | CONCH pathology pipeline (starts as a contract-shaped mock) |
| `services/resident` | Brandon | LLM report + Ask + the Scribe (starts as a mock) |
| `services/mock-ehr` | Alessandra | HAPI FHIR config and loaders |
| `apps/desktop` | Daniel | Electron + React + Blueprint |
| `data/` | shared | seed data, slides (git-ignored), caches |
| `infra/` | Ron | docker-compose, env |

## Rules (from spec section 0 and 18)

1. Do not change `packages/contracts` or `services/api/migrations` without Ron. Leave a `# SPEC-QUESTION:` comment instead.
2. Every API route uses the `require()` dependency and writes an audit row. A test enforces this.
3. Every AI output is a draft. Nothing AI-generated is ever marked final.
4. Synthetic data only. No real PHI, ever.
5. Branch names `owner/short-topic`. `main` must always boot with `make up`.
6. Each service folder has an `AGENT_CONTEXT.md`: paste it into your coding agent first.
