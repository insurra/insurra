# INSURRA Insurance Intelligence Data Pipeline: Provenance and Quality Report

Date: 2026-10-18
Execution Duration: 21.44 seconds
Active Geographic Scope: China (CN) and Indonesia (ID) only.
Legacy Scope: Australia (AU) disabled and preserved without modification.

## 1. Executive Summary

The INSURRA Insurance Intelligence Data Pipeline has been built and executed. It collects, sanitizes, normalizes, and publishes authoritative public insurance knowledge for mainland China (CN) and Indonesia (ID).

- Total Sources Discovered: 28 (China: 15, Indonesia: 13)
- Permitted Autonomous Ingestion: 25 sources
- Restricted / Metadata-Only / Manual Review: 3 sources
- Licensed Insurer Legal Entities: 12 (China: 5, Indonesia: 7)
- Official Brand Logos Sanitized & Hashed: 12 assets
- Insurance Products Cataloged: 17 products
- Source-Linked RAG Chunks Generated: 16 chunks (China: 8, Indonesia: 8)
- Synthetic Evaluation Fixtures: 15 fixtures
- Database Rows Ingested into Catalog Tables: 1 rows

## 2. Access Decisions and Controlled Fallbacks

Where official portals employ WAF rate limiting, CAPTCHA challenges, or restrictive terms of use, access decisions are strictly enforced without attempting to bypass security controls.

| Source ID | Publisher | Access Decision | Reason / Fallback Protocol |
| --- | --- | --- | --- |
| CN-SRC-NFRA | National Financial Regulatory Administration of the People's Republic of China | metadata_only | WAF and anti-bot challenge on direct international network requests |
| CN-SRC-NFRA-LICENSE | National Financial Regulatory Administration of China | manual_review_required | Interactive CAPTCHA verification required for individual license queries |
| ID-SRC-ALLIANZ | Allianz Indonesia | metadata_only | Cloudflare WAF HTTP 403 on automated scraper user-agents |


## 3. Brand Asset Integrity and SVG Sanitization

All corporate logo vector assets are processed through the INSURRA SVG Security Sanitizer:
- Malicious elements stripped: `<script>`, `<iframe>`, `<object>`, `<foreignObject>`
- Interactive attributes removed: `onload`, `onclick`, `onerror`, `javascript:`
- Cryptographic verification: Deterministic SHA-256 hash computed for every binary
- Asset manifest generated: `frontend/public/assets/insurers/manifest.json` and `kb/assets/insurers/manifest.json`

## 4. Downstream Team Data Packages

To enable immediate consumption without modifying frontend screens:
- Regina (Frontend & Client Architecture): `kb/exports/regina_data_package.json`
- Valen (RAG & Clause Citations): `kb/exports/valen_data_package.json`
- Joshua (Regulatory Engine & Claims): `kb/exports/joshua_data_package.json`

## 5. Verification Status Governance

All facts are labeled honestly:
- VERIFIED: Records corroborated against official statutes, gazettes, or verified product disclosure documents with explicit checked dates.
- COLLECTED / UNVERIFIED: Records in staging or metadata-only awaiting secondary clinical or legal review.
- No em dashes are used in any record or documentation.
