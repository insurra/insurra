/**
 * Utility to sanitize copywriting across features (Raka, Sinta, and common components).
 * Strips or replaces terms such as 'data synthetic', 'data demo', 'data kb',
 * '(synthetic)', '(demo)', etc. from being rendered to users.
 */

export function sanitizeCopywriting(text?: string | null): string {
  if (!text) return "";
  let clean = String(text);

  // Specific known backend fixtures & names
  clean = clean.replace(/Synthetic Student Health Plan\s*(?:\([^)]*\))?/gi, "Comprehensive Student Health Plan");
  clean = clean.replace(/Shenzhen Demo International University\s*(?:\([^)]*\))?/gi, "Shenzhen International University");
  clean = clean.replace(/Shenzhen Demo Community Clinic\s*(?:\([^)]*\))?/gi, "Shenzhen Community Health Service Center");
  clean = clean.replace(/BPJS\s*\([^)]*(?:synthetic|demo)[^)]*\)/gi, "BPJS Kesehatan (JKN-KIS)");
  clean = clean.replace(/EMPLOYER\s*\([^)]*(?:synthetic|demo)[^)]*\)/gi, "Allianz Corporate Group Plan");
  clean = clean.replace(/Synthetic provider\s*(?:\([^)]*\))?/gi, "Health Insurance Provider");
  clean = clean.replace(/Fictional Test Provider/gi, "Insurance Provider");

  // Parenthetical tags like (synthetic), (demo), (sintetis), (fictional)
  clean = clean.replace(/\s*\([^)]*(?:synthetic|sintetis|demo|fictional)[^)]*\)/gi, "");

  // Compound phrases
  clean = clean.replace(/\b(?:data\s+)?synthe(?:tic|tik|tis)(?:\s+data)?\b/gi, "");
  clean = clean.replace(/\bdata\s+demo\b/gi, "");
  clean = clean.replace(/\bdemo\s+data\b/gi, "");
  clean = clean.replace(/\bdata\s+kb\b/gi, "data regulasi");
  clean = clean.replace(/\bkb\s+data\b/gi, "data regulasi");

  // Clean extra whitespace and lingering separators
  clean = clean.replace(/\s{2,}/g, " ").trim();
  clean = clean.replace(/^[–—·•\s]+|[–—·•\s]+$/g, "").trim();

  return clean;
}
