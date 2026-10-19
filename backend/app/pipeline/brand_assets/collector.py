"""Insurer placeholder artwork pipeline.
Generates placeholder SVG marks for China and Indonesia insurers, sanitizes and hashes them, and
writes a manifest that labels every entry as a placeholder with an unverified license.
No real logo is downloaded. The files are NOT official brand marks; legacy file names that contain
"official" are kept only so existing paths keep working.
Never use em dashes in strings or docstrings.
"""

import json
from datetime import date
from pathlib import Path

from app.pipeline.brand_assets.sanitizer import AssetSanitizer
from app.pipeline.schemas.models import (
    AssetType,
    BrandAsset,
    EvidenceClass,
    LicenseStatus,
    PipelineVerificationStatus,
)

# Generated placeholder artwork (not official marks). "source_url" is only the publisher domain
# the real logo would have to be obtained from; it was never fetched.
PLACEHOLDER_SVG_DEFINITIONS: dict[str, dict] = {
    "cn-insurer-pingan": {
        "insurer_id": "cn-insurer-pingan",
        "display_name": "Ping An Insurance (中国平安)",
        "source_url": "https://www.pingan.com/app_common/images/logo.svg",
        "official_source_domain": "pingan.com",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#EA5414"/>
  <path d="M30 40 L42 28 L42 52 Z M46 28 L58 40 L46 52 Z" fill="#FFFFFF"/>
  <text x="85" y="47" font-family="Arial, 'PingFang SC', sans-serif" font-size="24" font-weight="bold" fill="#EA5414">中国平安</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="#333333">PING AN INSURANCE</text>
</svg>""",
        "original_filename": "pingan_logo_official.svg",
        "primary_color": "#EA5414",
    },
    "cn-insurer-picc": {
        "insurer_id": "cn-insurer-picc",
        "display_name": "PICC (中国人保)",
        "source_url": "https://www.picc.com/static/images/logo.svg",
        "official_source_domain": "picc.com",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#D81E06"/>
  <text x="45" y="48" font-family="Arial, sans-serif" font-size="18" font-weight="900" fill="#FFFFFF" text-anchor="middle">PICC</text>
  <text x="85" y="47" font-family="Arial, 'PingFang SC', sans-serif" font-size="24" font-weight="bold" fill="#D81E06">中国人保</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="#333333">PEOPLE'S INSURANCE CO.</text>
</svg>""",
        "original_filename": "picc_logo_official.svg",
        "primary_color": "#D81E06",
    },
    "cn-insurer-chinalife": {
        "insurer_id": "cn-insurer-chinalife",
        "display_name": "China Life (中国人寿)",
        "source_url": "https://www.chinalife.com.cn/chinalife/images/logo.svg",
        "official_source_domain": "chinalife.com.cn",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#008837"/>
  <circle cx="45" cy="40" r="16" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="8" fill="#008837"/>
  <text x="85" y="47" font-family="Arial, 'PingFang SC', sans-serif" font-size="24" font-weight="bold" fill="#008837">中国人寿</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="#333333">CHINA LIFE INSURANCE</text>
</svg>""",
        "original_filename": "chinalife_logo_official.svg",
        "primary_color": "#008837",
    },
    "cn-insurer-cpic": {
        "insurer_id": "cn-insurer-cpic",
        "display_name": "CPIC (中国太保)",
        "source_url": "https://www.cpic.com.cn/images/logo.svg",
        "official_source_domain": "cpic.com.cn",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#005BAC"/>
  <path d="M35 30 L55 30 L55 50 L35 50 Z" fill="#FFFFFF"/>
  <text x="85" y="47" font-family="Arial, 'PingFang SC', sans-serif" font-size="24" font-weight="bold" fill="#005BAC">中国太保</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="#333333">CHINA PACIFIC INSURANCE</text>
</svg>""",
        "original_filename": "cpic_logo_official.svg",
        "primary_color": "#005BAC",
    },
    "cn-platform-lxbx": {
        "insurer_id": "cn-platform-lxbx",
        "display_name": "Comprehensive Student Insurance Scheme (来华留学生保险)",
        "source_url": "https://www.lxbx.net/images/logo.svg",
        "official_source_domain": "lxbx.net",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 80" width="340" height="80">
  <rect width="340" height="80" rx="8" fill="#FFFFFF"/>
  <rect x="20" y="15" width="50" height="50" rx="10" fill="#1890FF"/>
  <path d="M32 40 L42 50 L58 30" stroke="#FFFFFF" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="85" y="44" font-family="Arial, 'PingFang SC', sans-serif" font-size="20" font-weight="bold" fill="#1890FF">来华留学生综合保险</text>
  <text x="85" y="64" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#666666">CSC COMPREHENSIVE SCHEME (PING AN)</text>
</svg>""",
        "original_filename": "lxbx_scheme_logo.svg",
        "primary_color": "#1890FF",
    },
    "id-public-bpjs-kesehatan": {
        "insurer_id": "id-public-bpjs-kesehatan",
        "display_name": "BPJS Kesehatan (JKN)",
        "source_url": "https://www.bpjs-kesehatan.go.id/bpjs/assets/frontend/images/logo.svg",
        "official_source_domain": "bpjs-kesehatan.go.id",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#008C44"/>
  <path d="M35 40 Q45 25 55 40 Q45 55 35 40 Z" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="5" fill="#008C44"/>
  <text x="85" y="46" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#008C44">BPJS Kesehatan</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#333333">JAMINAN KESEHATAN NASIONAL</text>
</svg>""",
        "original_filename": "bpjs_kesehatan_logo.svg",
        "primary_color": "#008C44",
    },
    "id-insurer-allianz": {
        "insurer_id": "id-insurer-allianz",
        "display_name": "Allianz Indonesia",
        "source_url": "https://www.allianz.co.id/media/allianz-logo.svg",
        "official_source_domain": "allianz.co.id",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#003781"/>
  <rect x="37" y="27" width="4" height="26" fill="#FFFFFF" rx="2"/>
  <rect x="44" y="22" width="4" height="36" fill="#FFFFFF" rx="2"/>
  <rect x="51" y="31" width="4" height="18" fill="#FFFFFF" rx="2"/>
  <text x="85" y="48" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#003781">Allianz</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#666666">PT ASURANSI ALLIANZ LIFE INDONESIA</text>
</svg>""",
        "original_filename": "allianz_indonesia_logo.svg",
        "primary_color": "#003781",
    },
    "id-insurer-prudential": {
        "insurer_id": "id-insurer-prudential",
        "display_name": "Prudential Indonesia",
        "source_url": "https://www.prudential.co.id/media/prudential-logo.svg",
        "official_source_domain": "prudential.co.id",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#ED1B2D"/>
  <path d="M36 40 A9 9 0 0 1 54 40 A9 9 0 0 1 36 40 Z" fill="#FFFFFF"/>
  <text x="85" y="48" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#ED1B2D">PRUDENTIAL</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#666666">PT PRUDENTIAL LIFE ASSURANCE</text>
</svg>""",
        "original_filename": "prudential_indonesia_logo.svg",
        "primary_color": "#ED1B2D",
    },
    "id-insurer-aia": {
        "insurer_id": "id-insurer-aia",
        "display_name": "AIA Indonesia",
        "source_url": "https://www.aia-financial.co.id/media/aia-logo.svg",
        "official_source_domain": "aia-financial.co.id",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#D31145"/>
  <path d="M35 55 L45 25 L55 55 L48 55 L45 44 L40 55 Z" fill="#FFFFFF"/>
  <text x="85" y="48" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#D31145">AIA</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#666666">PT AIA FINANCIAL</text>
</svg>""",
        "original_filename": "aia_indonesia_logo.svg",
        "primary_color": "#D31145",
    },
    "id-insurer-manulife": {
        "insurer_id": "id-insurer-manulife",
        "display_name": "Manulife Indonesia",
        "source_url": "https://www.manulife.co.id/media/manulife-logo.svg",
        "official_source_domain": "manulife.co.id",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <rect x="25" y="20" width="40" height="40" rx="6" fill="#00A758"/>
  <polygon points="32,50 40,30 46,45 52,32 58,50" fill="#FFFFFF"/>
  <text x="85" y="48" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#00A758">Manulife</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#666666">PT ASURANSI JIWA MANULIFE INDONESIA</text>
</svg>""",
        "original_filename": "manulife_indonesia_logo.svg",
        "primary_color": "#00A758",
    },
    "id-insurer-axa-mandiri": {
        "insurer_id": "id-insurer-axa-mandiri",
        "display_name": "AXA Mandiri",
        "source_url": "https://www.axa-mandiri.co.id/media/axa-mandiri-logo.svg",
        "official_source_domain": "axa-mandiri.co.id",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#00008F"/>
  <text x="45" y="48" font-family="Arial, sans-serif" font-size="16" font-weight="900" fill="#FFFFFF" text-anchor="middle">AXA</text>
  <text x="85" y="46" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#00008F">AXA Mandiri</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#666666">PT AXA MANDIRI FINANCIAL SERVICES</text>
</svg>""",
        "original_filename": "axa_mandiri_logo.svg",
        "primary_color": "#00008F",
    },
    "id-insurer-bri-life": {
        "insurer_id": "id-insurer-bri-life",
        "display_name": "BRI Life",
        "source_url": "https://brilife.co.id/media/bri-life-logo.svg",
        "official_source_domain": "brilife.co.id",
        "svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <rect width="320" height="80" rx="8" fill="#FFFFFF"/>
  <circle cx="45" cy="40" r="26" fill="#00529C"/>
  <text x="45" y="48" font-family="Arial, sans-serif" font-size="16" font-weight="900" fill="#FFFFFF" text-anchor="middle">BRI</text>
  <text x="85" y="46" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#00529C">BRI Life</text>
  <text x="85" y="65" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#666666">PT ASURANSI JIWA BRI LIFE (BANK BRI GROUP)</text>
</svg>""",
        "original_filename": "bri_life_logo.svg",
        "primary_color": "#00529C",
    },
}


class BrandAssetPipeline:
    def __init__(self, frontend_dir: Path, kb_dir: Path):
        self.frontend_asset_dir = frontend_dir / "public/assets/insurers"
        self.kb_asset_dir = kb_dir / "assets/insurers"

    def execute(self) -> list[BrandAsset]:
        """Runs the asset pipeline, sanitizes SVGs, writes to destinations, and produces manifest."""
        self.frontend_asset_dir.mkdir(parents=True, exist_ok=True)
        self.kb_asset_dir.mkdir(parents=True, exist_ok=True)

        asset_records: list[BrandAsset] = []
        manifest_entries: list[dict] = []

        for insurer_id, item in PLACEHOLDER_SVG_DEFINITIONS.items():
            svg_raw = item["svg"].encode("utf-8")
            sanitized_bytes, width, height = AssetSanitizer.sanitize_svg(svg_raw)
            sha256 = AssetSanitizer.compute_sha256(sanitized_bytes)

            dest_filename = item["original_filename"]
            placeholder_text = (
                f"Placeholder artwork for {item['display_name']}. Not the official logo and no "
                "trademark license has been verified."
            )
            # Write to frontend public directory
            insurer_frontend_dir = self.frontend_asset_dir / insurer_id
            insurer_frontend_dir.mkdir(parents=True, exist_ok=True)
            frontend_file = insurer_frontend_dir / dest_filename
            frontend_file.write_bytes(sanitized_bytes)

            # Write to kb assets directory
            insurer_kb_dir = self.kb_asset_dir / insurer_id
            insurer_kb_dir.mkdir(parents=True, exist_ok=True)
            kb_file = insurer_kb_dir / dest_filename
            kb_file.write_bytes(sanitized_bytes)

            asset_record = BrandAsset(
                asset_id=f"asset-{insurer_id}-primary",
                insurer_id=insurer_id,
                product_id=None,
                asset_type=AssetType.LOGO_PRIMARY,
                source_url=item["source_url"],
                official_source_domain=item["official_source_domain"],
                original_filename=dest_filename,
                mime_type="image/svg+xml",
                width=width,
                height=height,
                aspect_ratio=f"{width}:{height}",
                file_size_bytes=len(sanitized_bytes),
                sha256=sha256,
                license_status=LicenseStatus.NOT_VERIFIED,
                reuse_permission="None verified. Placeholder artwork only; obtain a licensed logo before display as an official mark.",
                attribution_required=True,
                attribution_text=placeholder_text,
                local_storage_path=f"/assets/insurers/{insurer_id}/{dest_filename}",
                collection_date=date(2026, 10, 18),
                verification_status=PipelineVerificationStatus.UNVERIFIED,
                evidence_class=EvidenceClass.PLACEHOLDER,
            )
            asset_records.append(asset_record)

            manifest_entries.append(
                {
                    "insurer_id": insurer_id,
                    "display_name": item["display_name"],
                    "primary_color": item["primary_color"],
                    "placeholder": True,
                    "evidence_class": "PLACEHOLDER",
                    "license_status": "NOT_VERIFIED",
                    "logo": {
                        "asset_id": asset_record.asset_id,
                        "status": "placeholder",
                        "fetched": False,
                        "sha256_of": "generated_placeholder_file",
                        "public_url": f"/assets/insurers/{insurer_id}/{dest_filename}",
                        "width": width,
                        "height": height,
                        "mime_type": "image/svg+xml",
                        "sha256": sha256,
                    },
                    "fallback": "insurance-category-icon",
                    "attribution": placeholder_text,
                }
            )

        manifest_data = {
            "schema_version": "1.5",
            "version": "1.0.0",
            "country_scope": ["CN", "ID"],
            "notice": (
                "All logos are generated placeholders, not official or retrieved brand assets. "
                "License status is NOT_VERIFIED. Do not present them as official logos."
            ),
            "placeholder": True,
            "insurers_count": len(manifest_entries),
            "generated_at": date(2026, 10, 18).isoformat(),
            "insurers": manifest_entries,
        }

        # Write manifest to both frontend and kb
        (self.frontend_asset_dir / "manifest.json").write_text(
            json.dumps(manifest_data, indent=2, ensure_ascii=False)
        )
        (self.kb_asset_dir / "manifest.json").write_text(
            json.dumps(manifest_data, indent=2, ensure_ascii=False)
        )

        return asset_records
