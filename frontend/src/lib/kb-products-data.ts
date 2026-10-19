/**
 * Scraped Knowledge Base Products Data Module
 * Provides curated, verified product specifications from kb/CN and kb/ID for Policy Wallet reference.
 */

export interface ScrapedBenefit {
  benefit_id: string;
  category: string;
  name: string;
  original_name?: string;
  limit_text: string;
  reimbursement_rate?: string;
  network?: string;
  deductible_text?: string;
  covered_services?: string;
}

export interface ScrapedExclusion {
  title: string;
  original_text?: string;
  conditions?: string;
  waiting_period_days?: number;
}

export interface ScrapedProduct {
  product_id: string;
  insurer_id: string;
  insurer_name: string;
  original_name: string;
  english_name: string;
  category: string;
  country_code: "CN" | "ID";
  published_pricing?: string;
  published_pricing_conditions?: string;
  product_url?: string;
  product_version?: string;
  target_users: string[];
  eligibility_conditions: string[];
  benefits: ScrapedBenefit[];
  exclusions: ScrapedExclusion[];
  network_requirements: string;
  claims_instructions: string;
  provenance_note: string;
}

export const SCRAPED_KB_PRODUCTS: ScrapedProduct[] = [
  // 1. CN Comprehensive International Student Scheme (Ping An / LXBX)
  {
    product_id: "cn-prod-lxbx-student",
    insurer_id: "cn-insurer-pingan",
    insurer_name: "Ping An Annuity (Platform: lxbx.net)",
    original_name: "来华留学生综合医疗保险计划",
    english_name: "Comprehensive Insurance & Protection Scheme for Foreigners Staying in China",
    category: "International Student",
    country_code: "CN",
    published_pricing: "800.00 CNY / year",
    published_pricing_conditions: "RMB 800 per student per year, or RMB 400 per half-year semester",
    product_url: "https://www.lxbx.net/product_details.html",
    product_version: "2024.1",
    target_users: [
      "International students with X1 / X2 visas",
      "Visiting scholars & foreign researchers",
      "Language exchange students in China",
    ],
    eligibility_conditions: [
      "Valid foreign passport and study visa (X1 or X2) or residence permit",
      "Enrolled in a licensed Chinese university or educational institution",
      "Age between 6 and 69 years at policy inception date",
    ],
    benefits: [
      {
        benefit_id: "cn-ben-lxbx-inpatient",
        category: "Inpatient Medical",
        name: "Accidental Injury & Illness Inpatient Treatment",
        original_name: "意外伤害及疾病住院医疗",
        limit_text: "400,000.00 CNY / Policy Year",
        reimbursement_rate: "100% of reasonable medical expenses exceeding deductible",
        deductible_text: "RMB 650 deductible per hospitalization instance",
        network: "Public hospitals Class 2 or Class 3 in mainland China (公立二级及以上医院普通部)",
        covered_services: "Hospital bed fee (up to RMB 300/day), nursing, doctor visits, surgery, anesthesia, examinations, prescribed medicines within national basic insurance scope.",
      },
      {
        benefit_id: "cn-ben-lxbx-outpatient",
        category: "Outpatient Medical",
        name: "Accidental & Illness Outpatient Medical Treatment",
        original_name: "门诊急诊医疗费用",
        limit_text: "20,000.00 CNY / Policy Year",
        reimbursement_rate: "85% of eligible expenses exceeding deductible",
        deductible_text: "RMB 650 deductible per policy year; daily maximum RMB 600",
        network: "Public hospitals Class 2/3 or designated campus health center",
        covered_services: "Physician consultations, emergency treatments, diagnostic tests, and prescription pharmaceuticals.",
      },
      {
        benefit_id: "cn-ben-lxbx-accidental-death",
        category: "Accidental Death & Disability",
        name: "Accidental Death & Permanent Disability",
        original_name: "意外身故与伤残保障",
        limit_text: "100,000.00 CNY",
        reimbursement_rate: "100% lump sum according to disability scale (10% - 100%)",
        network: "Any authorized tertiary hospital or forensic appraisal body",
        covered_services: "Lump-sum compensation for accidental fatality or irreversible loss of bodily function.",
      },
      {
        benefit_id: "cn-ben-lxbx-repatriation",
        category: "Emergency Assistance",
        name: "Accidental Emergency Medical Evacuation & Repatriation",
        original_name: "意外身故遗体送返及医疗转运",
        limit_text: "100,000.00 CNY",
        reimbursement_rate: "100% actual arranged costs",
        network: "Arranged through Ping An 24/7 Global Assistance Hotline (400-810-5119)",
        covered_services: "Medically supervised emergency evacuation to home country or mortal remains repatriation.",
      },
    ],
    exclusions: [
      {
        title: "Pre-existing Medical Conditions & Chronic Illnesses",
        original_text: "被保险人在保险责任生效前已罹患的疾病、先天性畸形、遗传性疾病或此前已有的残疾",
        conditions: "Acute life-threatening exacerbation covered up to emergency stabilization only.",
        waiting_period_days: 30,
      },
      {
        title: "High-Risk Extreme Sports & Hazardous Activities",
        original_text: "被保险人参与潜水、跳伞、攀岩、蹦极、特技表演、赛车等高风险运动期间发生的意外伤害",
        conditions: "Professional athletics, motor vehicle racing, skydiving, and mountaineering above 3500m excluded.",
      },
      {
        title: "Private Clinics, VIP Departments & International Wings",
        original_text: "在公立医院特需部、国际医疗部、VIP病房，以及私立医疗机构、诊所接受的治疗",
        conditions: "Must use standard general public department (普通部) unless life-threatening emergency occurs.",
      },
      {
        title: "Elective Cosmetic Procedures & Refractive Surgery",
        original_text: "整形美容手术、视力矫正、非因意外伤害导致的牙科治疗",
        conditions: "Elective aesthetic treatments and vision surgeries are not covered.",
      },
    ],
    network_requirements: "Public Class 2 and Class 3 hospitals in mainland China (公立二级及以上医院普通部). Treatment in private clinics or VIP departments requires prior authorization.",
    claims_instructions: "For hospitalization, notify 400-810-5119 within 48 hours of admission. For outpatient claims, retain original hospital fapiao (发票), medical records, and itemized bill. Submit claim online via lxbx.net or mail paper originals to Ping An Beijing Claims Center.",
    provenance_note: "Source: Comprehensive Insurance & Protection Scheme for Foreigners (lxbx.net / Ping An Pension Insurance Co., Ltd.). Curated Knowledge Base catalog.",
  },

  // 2. ID BPJS Kesehatan (JKN)
  {
    product_id: "id-prod-bpjs-jkn",
    insurer_id: "id-public-bpjs-kesehatan",
    insurer_name: "BPJS Kesehatan (JKN)",
    original_name: "Program Jaminan Kesehatan Nasional (JKN)",
    english_name: "National Health Insurance Program (JKN BPJS Kesehatan)",
    category: "Public / Social Health",
    country_code: "ID",
    published_pricing: "IDR 35,000 - 150,000 / month",
    published_pricing_conditions: "PBPU Mandiri monthly rates: Kelas 1 IDR 150,000; Kelas 2 IDR 100,000; Kelas 3 IDR 35,000 (after subsidy)",
    product_url: "https://www.bpjs-kesehatan.go.id",
    product_version: "2024.1",
    target_users: [
      "All Indonesian citizens (WNI)",
      "Foreign residents holding valid KITAS/KITAP working >= 6 months",
      "Formal workers (PPU) and independent participants (PBPU)",
    ],
    eligibility_conditions: [
      "Active membership without unpaid premium arrears",
      "Registered with a specific primary healthcare facility (FKTP)",
    ],
    benefits: [
      {
        benefit_id: "id-ben-jkn-fktp-rawat-jalan",
        category: "Primary Care",
        name: "Pelayanan Rawat Jalan Tingkat Pertama (RJTP)",
        original_name: "Rawat Jalan di Puskesmas / Klinik Pratama",
        limit_text: "Comprehensive / 100% Cashless",
        reimbursement_rate: "100% cashless at registered FKTP clinic",
        network: "Registered FKTP (Puskesmas or contracted primary clinic)",
        covered_services: "General practitioner consultation, laboratory examinations, health counseling, and Formularium Nasional (Fornas) medicines.",
      },
      {
        benefit_id: "id-ben-jkn-fktr-rawat-inap",
        category: "Hospital Inpatient",
        name: "Pelayanan Rawat Inap Tingkat Lanjutan (RITL)",
        original_name: "Rawat Inap di Rumah Sakit Rujukan (FKRTL)",
        limit_text: "Comprehensive / 100% under INA-CBGs tariff",
        reimbursement_rate: "100% cashless when following standard room class",
        network: "Contracted public or private hospitals (FKRTL) with valid referral",
        covered_services: "Inpatient room & board, Intensive Care Units (ICU, ICCU, PICU), surgeries, specialist consultations, and medications.",
      },
      {
        benefit_id: "id-ben-jkn-igd-emergency",
        category: "Emergency Medical",
        name: "Pelayanan Kegawatdaruratan Medis (IGD)",
        original_name: "Instalasi Gawat Darurat di Semua Rumah Sakit",
        limit_text: "100% Statutory Coverage",
        reimbursement_rate: "100% covered across all hospitals without prior referral",
        network: "Any hospital emergency room across Indonesia (contracted or non-contracted)",
        covered_services: "Life-saving emergency resuscitation, stabilization, and immediate surgical intervention.",
      },
    ],
    exclusions: [
      {
        title: "Pelayanan Kesehatan Tanpa Rujukan Berjenjang",
        original_text: "Pelayanan yang tidak sesuai dengan prosedur rujukan berjenjang (kecuali gawat darurat)",
        conditions: "Direct visits to hospital specialists without FKTP referral are not covered.",
      },
      {
        title: "Tindakan Estetika & Kosmetik",
        original_text: "Pelayanan kesehatan untuk tujuan estetik, kosmetik, atau perataan gigi",
        conditions: "Purely aesthetic treatments and non-therapeutic procedures are excluded.",
      },
      {
        title: "Pengobatan di Luar Negeri",
        original_text: "Pelayanan kesehatan yang dilakukan di luar wilayah Negara Kesatuan Republik Indonesia",
        conditions: "Coverage is restricted to Indonesian territory.",
      },
    ],
    network_requirements: "Tiered healthcare referral system (rujukan berjenjang): participant must first visit registered FKTP clinic. Hospitals require electronic referral letter (Surat Rujukan) except for life-threatening medical emergencies.",
    claims_instructions: "Cashless service: present digital KIS card via Mobile JKN app or physical e-KTP at healthcare facility. No out-of-pocket payment required when adhering to standard procedure.",
    provenance_note: "Source: Perpres No. 59 Tahun 2024 & BPJS Kesehatan official operational guide. Curated Knowledge Base catalog.",
  },

  // 3. ID Allianz SmartHealth / Private Health
  {
    product_id: "id-prod-allianz-smarthealth",
    insurer_id: "id-insurer-allianz",
    insurer_name: "Allianz Indonesia",
    original_name: "Allianz SmartHealth Maxi Violet",
    english_name: "Allianz SmartHealth Maxi Violet Individual & Family",
    category: "Individual Health",
    country_code: "ID",
    published_pricing: "Plan tiered pricing (Silver to Diamond)",
    published_pricing_conditions: "Annual premiums determined by entry age, selected room plan, and outpatient rider options",
    product_url: "https://www.allianz.co.id/produk/asuransi-kesehatan/smarthealth-maxi-violet.html",
    product_version: "2024.1",
    target_users: [
      "Expatriates and executives in Indonesia",
      "Families seeking private hospital access",
      "Supplementary protection alongside BPJS",
    ],
    eligibility_conditions: [
      "Ages 15 days to 60 years at policy inception",
      "Indonesian citizen or foreign resident holding valid KITAS/KITAP",
    ],
    benefits: [
      {
        benefit_id: "id-ben-allianz-inpatient",
        category: "Inpatient Hospitalization",
        name: "Inpatient Surgical & Hospital Room Coverage",
        limit_text: "Up to IDR 500,000,000 / Policy Year",
        reimbursement_rate: "100% Cashless via AdMedika hospital network",
        network: "AdMedika TPA private hospital network in Indonesia & regional partners",
        covered_services: "Hospital room, ICU, surgical procedures, doctor visits, pre and post-hospitalization consultations within 30 days.",
      },
      {
        benefit_id: "id-ben-allianz-outpatient-rider",
        category: "Outpatient Medical",
        name: "Outpatient & Specialist Care Rider",
        limit_text: "Annual maximum based on plan option",
        reimbursement_rate: "100% cashless or reimbursement basis",
        network: "Designated clinic and hospital network",
        covered_services: "General practitioner, specialist consultations, laboratory diagnostic tests, and prescribed pharmaceuticals.",
      },
    ],
    exclusions: [
      {
        title: "Pre-existing Medical Conditions",
        conditions: "Pre-existing conditions excluded during first 12-24 months of policy in force.",
        waiting_period_days: 30,
      },
      {
        title: "Specific Specified Illnesses Waiting Period",
        conditions: "Specified chronic diseases (e.g. hypertension, tumors, stones) subject to 12-month waiting period.",
        waiting_period_days: 365,
      },
    ],
    network_requirements: "Cashless admission across AdMedika hospital network in Indonesia, Singapore, and Malaysia using Allianz Health Card. Reimbursement available for non-network hospitals.",
    claims_instructions: "Present physical or e-Health Card at hospital admission. For reimbursement claims, submit original itemized receipt, diagnostic test reports, and doctor claim form within 30 days.",
    provenance_note: "Source: PT Asuransi Allianz Life Indonesia product disclosure. Curated Knowledge Base catalog.",
  },

  // 4. PICC Expatriate Plan (China)
  {
    product_id: "cn-prod-picc-expatriate",
    insurer_id: "cn-insurer-picc",
    insurer_name: "PICC Health (中国人保)",
    original_name: "人保健康外籍在华雇员综合医疗保障",
    english_name: "PICC Health Foreign Employee Comprehensive Medical Protection",
    category: "Employer / Group",
    country_code: "CN",
    published_pricing: "Custom group underwriting rate",
    published_pricing_conditions: "Employer sponsored group policy based on census tier",
    product_url: "https://www.picchealth.com/group/expatriate.html",
    product_version: "2023.2",
    target_users: [
      "Foreign employees and expat managers in China",
      "Foreign university faculty & technical specialists",
    ],
    eligibility_conditions: [
      "Valid Foreigner Work Permit (Category A, B, or C)",
      "Valid Work-type Residence Permit in mainland China",
      "Employed by a registered enterprise or institution in China",
    ],
    benefits: [
      {
        benefit_id: "cn-ben-picc-inpatient",
        category: "Inpatient Medical",
        name: "Inpatient Hospitalization and Surgical Expenses",
        limit_text: "1,000,000.00 CNY / Policy Year",
        reimbursement_rate: "100% direct billing or reimbursement",
        network: "Class 2A/3 public hospitals and designated direct billing private clinic network",
        covered_services: "Private room, ICU, surgical procedures, specialist fees, diagnostic imaging (MRI, CT, PET scans).",
      },
    ],
    exclusions: [
      {
        title: "Elective Aesthetic Surgery & Cosmetic Care",
        conditions: "Elective cosmetic surgeries, vision correction, and non-traumatic dental procedures are excluded.",
      },
    ],
    network_requirements: "Class 2A and Class 3 public hospitals in mainland China, plus designated direct billing private clinics.",
    claims_instructions: "Direct billing available at contracted partner clinics. For public hospitals, submit itemized medical receipts and doctor records within 60 days.",
    provenance_note: "Source: PICC Health Insurance Company Limited group product disclosure. Curated Knowledge Base catalog.",
  },
];

/**
 * Matches a policy to its closest scraped KB product
 */
export function matchScrapedProduct(policy: {
  provider?: string | null;
  title?: string | null;
  category?: string | null;
  region?: string | null;
}): ScrapedProduct | null {
  const text = `${policy.provider || ""} ${policy.title || ""} ${policy.category || ""} ${policy.region || ""}`.toLowerCase();

  // Match CN Student Scheme (Ping An / LXBX)
  if (
    (text.includes("ping an") || text.includes("lxbx") || text.includes("foreign") || text.includes("student")) &&
    (text.includes("china") || text.includes("cn") || text.includes("shenzhen") || text.includes("student"))
  ) {
    return SCRAPED_KB_PRODUCTS[0];
  }

  // Match BPJS Kesehatan
  if (
    text.includes("bpjs") ||
    text.includes("jkn") ||
    text.includes("social health") ||
    text.includes("china social") ||
    text.includes("public / social")
  ) {
    return SCRAPED_KB_PRODUCTS[1];
  }

  // Match Allianz
  if (text.includes("allianz") || text.includes("smarthealth") || text.includes("violet")) {
    return SCRAPED_KB_PRODUCTS[2];
  }

  // Match PICC / Employer Expat
  if (text.includes("picc") || text.includes("employer") || text.includes("group")) {
    return SCRAPED_KB_PRODUCTS[3];
  }

  // If region contains China, fallback to CN Student
  if (text.includes("china") || text.includes("cn")) {
    return SCRAPED_KB_PRODUCTS[0];
  }

  // If region contains Indonesia, fallback to BPJS
  if (text.includes("indonesia") || text.includes("id")) {
    return SCRAPED_KB_PRODUCTS[1];
  }

  return SCRAPED_KB_PRODUCTS[0];
}
