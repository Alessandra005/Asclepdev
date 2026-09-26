# Agent context: services/lab-tech
Owner: Brandon. Spec sections given to agents: 0, 9, 18 (+ contracts in packages/contracts/asclep_contracts/lab.py).
- Response MUST be `ClassifyResult`. Never add prose fields.
- Never mark anything final. Confidence is a model score, not a probability.
- Cache embeddings to data/embeddings/<slide_id>.pt. Fixed seed 42 for tile sampling.
