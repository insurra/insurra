/**
 * Official Insurer Logos and Brand Identity Helper
 * Resolves insurer names/IDs/categories to verified SVG logo assets from /assets/insurers/
 */

export interface InsurerBrand {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string;
  primaryColor: string;
  initials: string;
}

export const KNOWN_INSURERS: InsurerBrand[] = [
  {
    id: "cn-insurer-pingan",
    name: "Ping An Insurance (中国平安)",
    shortName: "Ping An",
    logoUrl: "/assets/insurers/cn-insurer-pingan/pingan_logo_official.svg",
    primaryColor: "#EA5414",
    initials: "PA",
  },
  {
    id: "cn-platform-lxbx",
    name: "Comprehensive Student Insurance Scheme (来华留学生保险)",
    shortName: "LXBX Scheme",
    logoUrl: "/assets/insurers/cn-platform-lxbx/lxbx_scheme_logo.svg",
    primaryColor: "#1890FF",
    initials: "LX",
  },
  {
    id: "id-public-bpjs-kesehatan",
    name: "BPJS Kesehatan (JKN)",
    shortName: "BPJS Kesehatan",
    logoUrl: "/assets/insurers/id-public-bpjs-kesehatan/bpjs_kesehatan_logo.svg",
    primaryColor: "#008C44",
    initials: "BPJS",
  },
  {
    id: "id-insurer-allianz",
    name: "Allianz Indonesia",
    shortName: "Allianz",
    logoUrl: "/assets/insurers/id-insurer-allianz/allianz_indonesia_logo.svg",
    primaryColor: "#003781",
    initials: "ALZ",
  },
  {
    id: "id-insurer-prudential",
    name: "Prudential Indonesia",
    shortName: "Prudential",
    logoUrl: "/assets/insurers/id-insurer-prudential/prudential_indonesia_logo.svg",
    primaryColor: "#ED1B2D",
    initials: "PRU",
  },
  {
    id: "id-insurer-aia",
    name: "AIA Indonesia",
    shortName: "AIA",
    logoUrl: "/assets/insurers/id-insurer-aia/aia_indonesia_logo.svg",
    primaryColor: "#D31145",
    initials: "AIA",
  },
  {
    id: "id-insurer-manulife",
    name: "Manulife Indonesia",
    shortName: "Manulife",
    logoUrl: "/assets/insurers/id-insurer-manulife/manulife_indonesia_logo.svg",
    primaryColor: "#00A758",
    initials: "MFC",
  },
  {
    id: "id-insurer-axa-mandiri",
    name: "AXA Mandiri",
    shortName: "AXA Mandiri",
    logoUrl: "/assets/insurers/id-insurer-axa-mandiri/axa_mandiri_logo.svg",
    primaryColor: "#00008F",
    initials: "AXA",
  },
  {
    id: "id-insurer-bri-life",
    name: "BRI Life",
    shortName: "BRI Life",
    logoUrl: "/assets/insurers/id-insurer-bri-life/bri_life_logo.svg",
    primaryColor: "#00529C",
    initials: "BRI",
  },
  {
    id: "cn-insurer-picc",
    name: "PICC (中国人保)",
    shortName: "PICC",
    logoUrl: "/assets/insurers/cn-insurer-picc/picc_logo_official.svg",
    primaryColor: "#D81E06",
    initials: "PICC",
  },
  {
    id: "cn-insurer-chinalife",
    name: "China Life (中国人寿)",
    shortName: "China Life",
    logoUrl: "/assets/insurers/cn-insurer-chinalife/chinalife_logo_official.svg",
    primaryColor: "#008837",
    initials: "CL",
  },
  {
    id: "cn-insurer-cpic",
    name: "CPIC (中国太保)",
    shortName: "CPIC",
    logoUrl: "/assets/insurers/cn-insurer-cpic/cpic_logo_official.svg",
    primaryColor: "#005BAC",
    initials: "CPIC",
  },
];

/**
 * Matches an insurer from provider name, policy title, or identifier
 */
export function getInsurerBrand(
  provider?: string | null,
  title?: string | null,
  category?: string | null
): InsurerBrand {
  const text = `${provider || ""} ${title || ""} ${category || ""}`.toLowerCase();

  // 1. Ping An & Ping An Annuity
  if (text.includes("ping an") || text.includes("pingan") || text.includes("中国平安") || text.includes("平安")) {
    return KNOWN_INSURERS[0];
  }

  // 2. LXBX / Comprehensive Scheme for Foreigners / International Student Scheme
  if (text.includes("lxbx") || text.includes("来华留学生") || text.includes("foreign student") || (text.includes("student") && text.includes("china"))) {
    return KNOWN_INSURERS[1];
  }

  // 3. BPJS Kesehatan / Social Health
  if (
    text.includes("bpjs") ||
    text.includes("jkn") ||
    text.includes("social health") ||
    text.includes("china social medical") ||
    text.includes("public / social")
  ) {
    return KNOWN_INSURERS[2];
  }

  // 4. Allianz
  if (text.includes("allianz") || text.includes("smarthealth")) {
    return KNOWN_INSURERS[3];
  }

  // 5. Prudential
  if (text.includes("prudential") || text.includes("pruwell") || text.includes("prucritical") || text.includes("pru")) {
    return KNOWN_INSURERS[4];
  }

  // 6. AIA
  if (text.includes("aia")) {
    return KNOWN_INSURERS[5];
  }

  // 7. Manulife
  if (text.includes("manulife")) {
    return KNOWN_INSURERS[6];
  }

  // 8. AXA
  if (text.includes("axa")) {
    return KNOWN_INSURERS[7];
  }

  // 9. BRI Life
  if (text.includes("bri")) {
    return KNOWN_INSURERS[8];
  }

  // 10. PICC
  if (text.includes("picc") || text.includes("中国人保") || text.includes("人保")) {
    return KNOWN_INSURERS[9];
  }

  // 11. China Life
  if (text.includes("china life") || text.includes("chinalife") || text.includes("中国人寿")) {
    return KNOWN_INSURERS[10];
  }

  // 12. CPIC
  if (text.includes("cpic") || text.includes("中国太保") || text.includes("太保")) {
    return KNOWN_INSURERS[11];
  }

  // Fallback brand for unlisted or custom providers
  const cleanName = provider || title || "Insurance Provider";
  const initials = cleanName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("") || "INS";

  return {
    id: "generic",
    name: cleanName,
    shortName: cleanName,
    logoUrl: "",
    primaryColor: "#0ea58a",
    initials,
  };
}
