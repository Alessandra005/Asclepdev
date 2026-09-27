"""The Resident's requirement checks (spec 10.1, 10.4). Pure functions: text in, list of problems out.

Every check returns plain-English problems; an empty list means the text passes. The problems are fed back to
the model on a retry, so they say what to fix. The same functions run on the report and on Ask answers.
"""
import re

CITE = re.compile(r"\[\[obj:(\w+):([0-9a-fA-F-]{36})\]\]")
PLACEHOLDER = re.compile(r"\{\{FINDING\.[A-Z_]+\}\}")
NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)?")
PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*%")

# Every name a subtype goes by. A name of any subtype other than the finding's label fails locked_values_intact.
SUBTYPE_TERMS = {
    "LUAD": ("LUAD", "adenocarcinoma"),
    "LUSC": ("LUSC", "squamous"),
    "benign": ("benign", "normal lung tissue"),
}

DOSING = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?)(?:/(?:kg|m2))?\s+(?:daily|once|twice|every|per|iv|po|orally|"
    r"intravenously|q\d)|\b(?:bid|tid|qid|q\d+[hdw])\b|\bevery \d+ (?:hours|days|weeks)\b|"
    r"\b(?:take|administer|infuse|inject)\b[^.]*\b\d+\s*(?:mg|mcg|ml|units?)\b",
    re.IGNORECASE,
)
# Sentences that report missing or denied data need no citation: there is nothing to cite.
NOTHING_TO_CITE = re.compile(
    r"don't have access|do not have access|no (?:matching )?(?:records?|results?|data)|not (?:found|on file)|"
    r"couldn't find|could not find|returned nothing|did not return|no .{0,30} (?:on file|recorded)",
    re.IGNORECASE,
)
MAX_ASK_WORDS = 150
STATUS_WORDS = {"backordered", "backorder", "restock", "stock", "allergy", "allergic", "pending", "confirmed",
                "overridden", "rejected", "abnormal", "critical", "elevated", "diagnosis", "diagnosed"}


def plain(text: str) -> str:
    """Text without citation tokens or placeholders, for word and number checks."""
    return PLACEHOLDER.sub("", CITE.sub("", text))


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [p.strip().lstrip("-*0123456789. ").strip() for p in parts
            if p.strip() and not p.strip().startswith("#")]


def locked_values_intact(text: str, label: str, class_scores: dict[str, float]) -> list[str]:
    """No other subtype named, and every percentage is one of the model's class scores (spec 10.1 step 3)."""
    problems = []
    for other, terms in SUBTYPE_TERMS.items():
        if other == label:
            continue
        for term in terms:
            if re.search(rf"\b{re.escape(term)}\b", text, re.IGNORECASE):
                problems.append(f"Do not name '{term}': the finding's label is locked. Use {{{{FINDING.LABEL}}}}.")
    scores = [v * 100 for v in class_scores.values()]
    for pct in PERCENT.findall(plain(text)):
        if not any(abs(float(pct) - s) < 0.51 for s in scores):
            problems.append(f"'{pct}%' is not a model score. Use {{{{FINDING.CONFIDENCE}}}} or {{{{FINDING.SCORES}}}}.")
    return problems


def numbers_grounded(text: str, sources: str) -> list[str]:
    """Every number in the text appears in the sources: the Resident never computes numbers (spec 7A.7)."""
    known = {float(n) for n in NUMBER.findall(sources)}
    bad = sorted({n for n in NUMBER.findall(plain(text)) if float(n) not in known})
    return [f"The number(s) {', '.join(bad)} are not in the records. Copy numbers exactly; never compute them."] \
        if bad else []


def citations_resolve(text: str, allowed_ids: set[str]) -> list[str]:
    """Every [[obj:type:id]] names a record the Resident was given (this patient's, or this user's tool results)."""
    bad = sorted({oid for _, oid in CITE.findall(text) if oid.lower() not in allowed_ids})
    return [f"Citation id {oid} is not in the records you were given. Cite only those ids." for oid in bad]


def is_claim(sentence: str, names: set[str]) -> bool:
    """A sentence states a record fact when it carries record content: a number, a subtype, a status word, or a
    name from the records (patient, medication, ...). "You may want to check with pathology" is not a claim."""
    words = {w.lower() for w in re.findall(r"[A-Za-z]{4,}", sentence)}
    return bool(NUMBER.search(sentence) or words & names or words & STATUS_WORDS
                or any(re.search(rf"\b{re.escape(t)}\b", sentence, re.IGNORECASE)
                       for terms in SUBTYPE_TERMS.values() for t in terms))


def every_claim_cited(text: str, names: set[str] = frozenset()) -> list[str]:
    """No record fact without a citation (spec 10.4). Sentences about missing or denied data need none."""
    bad = [s for s in sentences(text) if not CITE.search(s) and not NOTHING_TO_CITE.search(s) and is_claim(s, names)]
    return [f"Cite this sentence with [[obj:type:id]] or remove it: \"{s[:80]}\"" for s in bad]


def drop_uncited(text: str, names: set[str] = frozenset()) -> str:
    """Deterministic repair (spec 10.1: "uncited clinical sentences are removed"): drop malformed citation tokens,
    then every sentence that states a record fact without a citation. Never adds text."""
    text = re.sub(r"\s*\[\[obj:[^\]]*\]\]", lambda m: m[0] if CITE.fullmatch(m[0].strip()) else "", text)
    for s in re.split(r"(?<=[.!?])\s+|\n+", text):
        core = s.strip().lstrip("-*0123456789. ").strip()
        if core and not CITE.search(core) and not NOTHING_TO_CITE.search(core) and is_claim(core, names):
            text = text.replace(s, "")
    return re.sub(r"\n\s*[-*]\s*(?=\n|$)", "", re.sub(r"[ \t]+\n", "\n", text)).strip()


def citations_well_formed(text: str) -> list[str]:
    """Every [[obj:...]] token is [[obj:Type:<uuid>]]; a made-up id like 'none' is not a citation."""
    bad = [t for t in re.findall(r"\[\[obj:[^\]]*\]\]", text) if not CITE.fullmatch(t)]
    return [f"{t} is not a valid citation. Cite a record id from the tool results, or cite nothing." for t in bad]


def no_dosing(text: str) -> list[str]:
    return ["Remove dose, route, or frequency instructions: the Resident never gives dosing."] \
        if DOSING.search(plain(text)) else []


def length_limit(text: str, limit: int = MAX_ASK_WORDS) -> list[str]:
    n = len(plain(text).split())
    return [f"The answer is {n} words; keep it under {limit}."] if n > limit else []


if __name__ == "__main__":
    scores = {"LUAD": 0.87, "LUSC": 0.10, "benign": 0.03}
    assert locked_values_intact("{{FINDING.LABEL}}, consistent with adenocarcinoma; 87%", "LUAD", scores) == []
    assert locked_values_intact("squamous features", "LUAD", scores)
    assert locked_values_intact("confidence 91%", "LUAD", scores)
    assert no_dosing("Pembrolizumab 100 mg/4 mL is backordered") == []
    assert no_dosing("give 200 mg every 3 weeks")
    oid = "0135214a-d303-4261-88a5-2e057af2c2cd"
    fixed = drop_uncited(f"No biopsy finding is on file [[obj:Finding:none]]. Pembrolizumab is backordered "
                         f"[[obj:InventoryItem:{oid}]]. An order is possible, but pembrolizumab is out of stock.")
    assert fixed == f"No biopsy finding is on file. Pembrolizumab is backordered [[obj:InventoryItem:{oid}]].", fixed
    print("ok")
