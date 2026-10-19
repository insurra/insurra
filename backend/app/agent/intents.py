"""Deterministic intent router for policy Q&A and agentic proposals."""

import re

from app.schemas.foundation import AskIntent
from app.services.retrieval import terms

MEDICAL_ADVICE_RE = re.compile(
    r"obat apa|obat (?:yang )?cocok|cara mengobati|diagnos[ia]|"
    r"what medicine|what treatment|should i take|吃什么药|如何治疗",
    re.I,
)
REMINDER_RE = re.compile(
    r"\b(remind|reminder|ingatkan|pengingat)\b|到期提醒|提醒我",
    re.I,
)
SERVICING_RE = re.compile(
    r"\b(certificate copy|another .*certificate|salinan sertifikat|change address|"
    r"ubah alamat|beneficiary|ahli waris|policy servicing)\b|申请证明|变更地址|保单服务",
    re.I,
)
COVERAGE_STATUS_RE = re.compile(
    r"\b(why is my coverage flagged|coverage gap|jeda perlindungan|status perlindungan)\b|"
    r"为什么.*提醒|保障缺口",
    re.I,
)
CLAIM_HELP_RE = re.compile(
    r"\b(prepare a .*claim|help me .*claim|ajukan klaim|cara klaim|dokumen klaim)\b|"
    r"申请理赔|报销流程",
    re.I,
)
CARE_NAV_RE = re.compile(
    r"\b(where should i go|ke mana .*berobat|jalur berobat|compare pathways)\b|"
    r"去哪里看病|就医路径",
    re.I,
)
POLICY_QUESTION_RE = re.compile(
    r"polis|asuransi|manfaat|ditanggung|klaim|sisa|limit|excess|"
    r"insurance|policy|benefit|cover|claim|保单|保险|保障|报销|限额|门诊|住院|牙科",
    re.I,
)


def classify_intent(question: str, country, has_chat_history: bool = False) -> AskIntent:
    if MEDICAL_ADVICE_RE.search(question):
        return "MEDICAL_ADVICE"
    if REMINDER_RE.search(question):
        return "REMINDER_REQUEST"
    if SERVICING_RE.search(question):
        return "SERVICING_REQUEST"
    if COVERAGE_STATUS_RE.search(question):
        return "COVERAGE_STATUS"
    if CLAIM_HELP_RE.search(question):
        return "CLAIM_HELP"
    if CARE_NAV_RE.search(question):
        return "CARE_NAVIGATION"
    if (
        has_chat_history
        or POLICY_QUESTION_RE.search(question)
        or (terms(question, country) & set(country.resources.retrieval_terms.data))
    ):
        return "POLICY_QUESTION"
    return "OUT_OF_SCOPE"
