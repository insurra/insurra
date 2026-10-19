"""Emergency guidance service (SC-08).

Provides country-aware emergency contacts for China and Indonesia, evaluates red flags in
Mandarin, Indonesian, and English, and generates immediate safety interruption guidance without
delaying care for insurance verification or attempting medical diagnosis.
"""

from app.workflow import kbdata

RED_FLAG_PATTERNS = {
    "CHEST_PAIN": {
        "category": "MEDICAL",
        "phrases": [
            "chest pain",
            "severe chest pain",
            "pressure in chest",
            "heart attack",
            "nyeri dada",
            "sakit dada",
            "dada sesak",
            "serangan jantung",
            "胸痛",
            "胸口剧痛",
            "心脏绞痛",
            "胸闷胸痛",
        ],
        "guidance": "Severe chest pain can indicate a cardiac emergency. Call emergency medical services immediately.",
    },
    "BREATHING_DIFFICULTY": {
        "category": "MEDICAL",
        "phrases": [
            "difficulty breathing",
            "shortness of breath",
            "cannot breathe",
            "choking",
            "sesak napas",
            "sulit bernapas",
            "tidak bisa bernapas",
            "tersedak",
            "呼吸困难",
            "喘不过气",
            "呼吸衰竭",
            "窒息",
        ],
        "guidance": "Acute breathing difficulty is a critical red flag. Contact ambulance services right away.",
    },
    "LOSS_OF_CONSCIOUSNESS": {
        "category": "MEDICAL",
        "phrases": [
            "loss of consciousness",
            "fainted",
            "unresponsive",
            "passed out",
            "seizure",
            "pingsan",
            "hilang kesadaran",
            "tidak sadar",
            "kejang",
            "昏迷",
            "失去意识",
            "晕倒",
            "抽搐",
        ],
        "guidance": "Unresponsiveness or seizure requires urgent on-site medical attention. Do not attempt unguided movement.",
    },
    "SEVERE_BLEEDING": {
        "category": "MEDICAL",
        "phrases": [
            "severe bleeding",
            "hemorrhage",
            "bleeding heavily",
            "blood loss",
            "pendarahan hebat",
            "pendarahan berat",
            "darah keluar banyak",
            "大出血",
            "严重出血",
            "失血过多",
        ],
        "guidance": "Apply direct pressure with a clean cloth and summon emergency medical personnel immediately.",
    },
    "SERIOUS_INJURY": {
        "category": "MEDICAL",
        "phrases": [
            "traffic accident",
            "serious injury",
            "severe burn",
            "head trauma",
            "bone fracture",
            "kecelakaan lalu lintas",
            "cedera berat",
            "luka bakar parah",
            "trauma kepala",
            "patah tulang",
            "车祸",
            "严重外伤",
            "严重烧伤",
            "头部创伤",
            "骨折",
        ],
        "guidance": "For severe trauma or accidents, keep the injured person still and call both medical and traffic/police assistance.",
    },
    "SELF_HARM": {
        "category": "SELF_HARM",
        "phrases": [
            "suicide",
            "kill myself",
            "want to die",
            "self harm",
            "end my life",
            "bunuh diri",
            "ingin mati",
            "menyakiti diri",
            "mengakhiri hidup",
            "自杀",
            "想死",
            "自残",
            "轻生",
        ],
        "guidance": "You are not alone, and help is available right now. Please reach out to trusted 24/7 mental health crisis support lines.",
    },
}


def get_emergency_contacts(country_code: str) -> dict:
    code = kbdata.require_country(country_code)
    raw_data = kbdata.emergency(code)
    contacts_list = (
        (raw_data.get("data") or {}).get("contacts", []) if isinstance(raw_data, dict) else []
    )

    if code == "CN":
        default_contacts = [
            {
                "service_code": "medical",
                "label": "Medical Ambulance (急救)",
                "phone_number": "120",
                "jurisdiction": "CN Mainland National",
                "verified": True,
            },
            {
                "service_code": "police",
                "label": "Police Emergency (报警)",
                "phone_number": "110",
                "jurisdiction": "CN Mainland National",
                "verified": True,
            },
            {
                "service_code": "fire",
                "label": "Fire Rescue (火警)",
                "phone_number": "119",
                "jurisdiction": "CN Mainland National",
                "verified": True,
            },
            {
                "service_code": "traffic",
                "label": "Traffic Accident (交警)",
                "phone_number": "122",
                "jurisdiction": "CN Mainland National",
                "verified": True,
            },
        ]
        mental_health = {
            "label": "Beijing Psychological Crisis Intervention Hotline",
            "phone_number": "010-82951332",
            "available": "24/7 Free Consultation",
        }
    else:  # ID
        default_contacts = [
            {
                "service_code": "general",
                "label": "National Emergency Call Center (Darurat Umum)",
                "phone_number": "112",
                "jurisdiction": "ID Local Implementation",
                "verified": True,
            },
            {
                "service_code": "medical",
                "label": "Medical Emergency PSC Kemenkes (Ambulans)",
                "phone_number": "119",
                "jurisdiction": "ID National",
                "verified": True,
            },
            {
                "service_code": "police",
                "label": "Police (Polisi)",
                "phone_number": "110",
                "jurisdiction": "ID National",
                "verified": True,
            },
            {
                "service_code": "fire",
                "label": "Fire Department (Pemadam Kebakaran)",
                "phone_number": "113",
                "jurisdiction": "ID National",
                "verified": True,
            },
            {
                "service_code": "search_rescue",
                "label": "National Search and Rescue (BASARNAS)",
                "phone_number": "115",
                "jurisdiction": "ID National",
                "verified": True,
            },
        ]
        mental_health = {
            "label": "Sejiwa Kemenkes / Into The Light Crisis Support",
            "phone_number": "119 ext 8",
            "available": "24/7 Mental Health Hotline",
        }

    return {
        "country_code": code,
        "primary_emergency_number": "120" if code == "CN" else "112",
        "contacts": default_contacts if not contacts_list else contacts_list,
        "mental_health_crisis_line": mental_health,
        "source_reference": raw_data.get("source_url")
        or ("https://bjca.miit.gov.cn" if code == "CN" else "https://layanan112.komdigi.go.id"),
        "disclaimer": "INSURRA provides direct emergency phone connections for safety only. Emergency guidance does not evaluate claim eligibility, require upfront policy verification, or constitute medical diagnosis.",
    }


def evaluate_triage(text: str, country_code: str) -> dict:
    code = kbdata.require_country(country_code)
    normalized = (text or "").casefold()
    matched_flags = []
    safety_flows = []

    for flag_id, info in RED_FLAG_PATTERNS.items():
        if any(phrase in normalized for phrase in info["phrases"]):
            matched_flags.append(
                {
                    "flag_id": flag_id,
                    "category": info["category"],
                    "guidance": info["guidance"],
                }
            )
            if info["category"] == "MEDICAL" and "EMERGENCY_MEDICAL" not in safety_flows:
                safety_flows.append("EMERGENCY_MEDICAL")
            elif info["category"] == "SELF_HARM" and "SELF_HARM_SUPPORT" not in safety_flows:
                safety_flows.append("SELF_HARM_SUPPORT")

    emergency_info = get_emergency_contacts(code)

    return {
        "has_red_flag": bool(matched_flags),
        "country_code": code,
        "matched_flags": matched_flags,
        "safety_flows": safety_flows,
        "emergency_contacts": emergency_info["contacts"],
        "mental_health_crisis_line": emergency_info["mental_health_crisis_line"],
        "recommended_action": (
            "INTERRUPT_NON_EMERGENCY_FLOW" if matched_flags else "CONTINUE_STANDARD_CARE_FLOW"
        ),
        "guidance_message": (
            "Potential medical emergency detected. Please call local emergency services immediately before pursuing insurance claim paperwork."
            if any(f["category"] == "MEDICAL" for f in matched_flags)
            else "Confidential support is available 24/7. Please connect with crisis support personnel."
            if any(f["category"] == "SELF_HARM" for f in matched_flags)
            else "No immediate red flag expressions detected. You may proceed with normal claim guidance."
        ),
    }
