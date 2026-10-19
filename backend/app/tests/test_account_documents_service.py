from app.core.config import ROOT
from app.services.account_documents import classify_document, extract_text_or_ocr
from app.services.kb_loader import CountryKBLoader


def test_chinese_filenames_classify_against_country_document_vocabulary():
    country = CountryKBLoader(ROOT / "kb").load("CN")
    assert classify_document(None, country, "学生保险凭证.pdf") == "insurance_certificate"
    assert classify_document(None, country, "保险条款.pdf") == "policy_wording"
    assert classify_document(None, country, "医疗收费发票.pdf") == "medical_fapiao"


def test_image_ocr_requests_chinese_indonesian_and_english(monkeypatch):
    commands = []

    def fake_run(command, *, content=None, timeout=30):
        commands.append(command)
        if "--list-langs" in command:
            return b"List of available languages (3):\neng\nind\nchi_sim\n"
        return b"sample text"

    monkeypatch.setattr("app.services.account_documents._run", fake_run)
    pages = extract_text_or_ocr(b"\x89PNG\r\n\x1a\nsynthetic", "image/png", "CN")

    assert pages[0].text == "sample text"
    assert ["-l", "eng+ind+chi_sim"] == commands[1][-2:]


def test_chinese_ocr_fails_clearly_when_language_data_is_missing(monkeypatch):
    monkeypatch.setattr(
        "app.services.account_documents._run",
        lambda *_args, **_kwargs: b"List of available languages (2):\neng\nind\n",
    )
    from app.core.errors import AppError

    try:
        extract_text_or_ocr(b"\x89PNG\r\n\x1a\nsynthetic", "image/png", "CN")
    except AppError as exc:
        assert exc.code == "OCR_LANGUAGE_UNAVAILABLE"
    else:
        raise AssertionError("Chinese OCR must not silently fall back without chi_sim data")


def test_supported_countries_use_continuity_task_not_visa_cover():
    loader = CountryKBLoader(ROOT / "kb")
    for country_code in ("AU", "CN", "ID"):
        tasks = loader.load(country_code).resources.tasks.data
        task_codes = {task.task_code for task in tasks}
        assert "coverage_continuity" in task_codes
        assert "visa_cover" not in task_codes
