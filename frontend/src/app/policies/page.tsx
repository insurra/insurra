"use client";

import { showConfirm } from "@/components/ui/app-dialog";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  HelpCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useActor } from "@/lib/actor";
import { useAuth } from "@/lib/auth";
import { getInsurerBrand } from "@/lib/insurer-logos";
import { AddPolicyModal, type NewPolicyData } from "@/components/policies/add-policy-modal";
import { PolicyDocumentPreviewModal } from "@/components/policies/policy-document-preview-modal";
import { sanitizeCopywriting } from "@/lib/sanitize-copywriting";
import "./policy-wallet.css";

type PolicySummary = components["schemas"]["AccountPolicySummary"];
type PolicyDetail = components["schemas"]["AccountPolicyDetail"];
type PolicyAnalysis = components["schemas"]["PolicyIntelligenceAnalysis"];

interface DisplayPolicy {
  id: string;
  provider: string;
  title: string;
  category: string;
  status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NOT_YET_ACTIVE" | "UNKNOWN";
  evidenceStatus: "VERIFIED" | "NEEDS_REVIEW" | "SELF_REPORTED";
  dateRange: string;
  startDate?: string;
  endDate?: string;
  policyNumber: string;
  coverageLimit: string;
  deductible: string;
  currency: string;
  summary: string;
  sourceDocCount: number;
  sourceDocId?: string;
}

// Demo Persona 1: Raka Pratama (International Student in China)
const RAKA_DEMO_POLICIES: DisplayPolicy[] = [
  {
    id: "demo-aia-stu-2024",
    provider: "AIA",
    title: "AIA International Student Plan",
    category: "Student insurance",
    status: "ACTIVE",
    evidenceStatus: "VERIFIED",
    dateRange: "1 Sep 2024 – 31 Aug 2025",
    startDate: "2024-09-01",
    endDate: "2025-08-31",
    policyNumber: "AIA-STU-2024-568923",
    coverageLimit: "RMB 1,000,000",
    deductible: "RMB 0",
    currency: "RMB",
    summary: "Comprehensive student health coverage for inpatient, outpatient, and emergency evacuation in China.",
    sourceDocCount: 2,
    sourceDocId: "demo-doc-aia-1",
  },
  {
    id: "demo-chubb-trv-2025",
    provider: "Chubb",
    title: "Chubb Travel Insurance",
    category: "Travel insurance",
    status: "ACTIVE",
    evidenceStatus: "VERIFIED",
    dateRange: "15 Aug 2025 – 15 Feb 2026",
    startDate: "2025-08-15",
    endDate: "2026-02-15",
    policyNumber: "CHB-TRV-789456",
    coverageLimit: "RMB 500,000",
    deductible: "RMB 0",
    currency: "RMB",
    summary: "International travel medical, transit luggage, and 24/7 global emergency assistance coverage.",
    sourceDocCount: 1,
    sourceDocId: "demo-doc-chubb-1",
  },
  {
    id: "demo-tencent-emp-2025",
    provider: "Tencent",
    title: "Employer Health Insurance",
    category: "Employer insurance",
    status: "EXPIRING_SOON",
    evidenceStatus: "SELF_REPORTED",
    dateRange: "1 Jan 2025 – 31 Dec 2025",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    policyNumber: "TCE-EMP-2025-001",
    coverageLimit: "RMB 800,000",
    deductible: "RMB 200",
    currency: "RMB",
    summary: "Corporate group health policy covering hospital ward and specialist consultations.",
    sourceDocCount: 0,
  },
  {
    id: "demo-allianz-trv-old",
    provider: "Allianz",
    title: "Travel Insurance (Old)",
    category: "Travel insurance",
    status: "EXPIRED",
    evidenceStatus: "VERIFIED",
    dateRange: "1 Mar 2024 – 1 Sep 2024",
    startDate: "2024-03-01",
    endDate: "2024-09-01",
    policyNumber: "ALZ-TRV-2024-8899",
    coverageLimit: "RMB 300,000",
    deductible: "RMB 0",
    currency: "RMB",
    summary: "Expired trip protection policy from previous academic travel period.",
    sourceDocCount: 1,
    sourceDocId: "demo-doc-allianz-1",
  },
];

// Demo Persona 2: Sinta Dewi (Employee in Jakarta, Indonesia)
const SINTA_DEMO_POLICIES: DisplayPolicy[] = [
  {
    id: "demo-sinta-bpjs",
    provider: "BPJS Kesehatan",
    title: "BPJS Kesehatan JKN-KIS",
    category: "Public health insurance",
    status: "ACTIVE",
    evidenceStatus: "VERIFIED",
    dateRange: "1 Jan 2024 – No expiry",
    startDate: "2024-01-01",
    endDate: "",
    policyNumber: "0001889234567",
    coverageLimit: "Standard JKN Tier",
    deductible: "IDR 0",
    currency: "IDR",
    summary: "Indonesian universal national health coverage for primary facilities, specialist referrals, and tiered inpatient care.",
    sourceDocCount: 1,
    sourceDocId: "demo-doc-bpjs-sinta",
  },
  {
    id: "demo-sinta-chubb",
    provider: "Chubb",
    title: "Chubb Corporate Group Health Plan",
    category: "Employer insurance",
    status: "ACTIVE",
    evidenceStatus: "VERIFIED",
    dateRange: "1 Jan 2026 – 31 Dec 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    policyNumber: "CHB-GRP-2026-904",
    coverageLimit: "IDR 150,000,000",
    deductible: "IDR 0",
    currency: "IDR",
    summary: "Corporate employer health plan with cashless admission across private hospital network.",
    sourceDocCount: 2,
    sourceDocId: "demo-doc-chubb-sinta",
  },
  {
    id: "demo-sinta-allianz",
    provider: "Allianz",
    title: "Allianz TravelPro & Personal Accident",
    category: "Travel insurance",
    status: "ACTIVE",
    evidenceStatus: "SELF_REPORTED",
    dateRange: "10 Oct 2026 – 10 Nov 2026",
    startDate: "2026-10-10",
    endDate: "2026-11-10",
    policyNumber: "ALZ-TRV-2026-319",
    coverageLimit: "IDR 50,000,000",
    deductible: "IDR 500,000",
    currency: "IDR",
    summary: "Regional business travel protection with emergency accidental medical coverage.",
    sourceDocCount: 0,
  },
];

export default function PolicyWalletPage() {
  const { mode, headers, demo } = useActor();
  const { token } = useAuth();

  const isSinta =
    demo?.profile?.country_code === "ID" ||
    Boolean(demo?.profile?.display_name?.toLowerCase().includes("sinta"));

  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [demoPoliciesState, setDemoPoliciesState] = useState<DisplayPolicy[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [policyDetail, setPolicyDetail] = useState<PolicyDetail | null>(null);
  const [intelligenceAnalysis, setIntelligenceAnalysis] = useState<PolicyAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Document & Clause Preview Modal State
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewDocData, setPreviewDocData] = useState<{
    documentId?: string;
    documentName: string;
    documentType?: string;
    fileUrl?: string;
    policyNumber?: string;
    insurer?: string;
    planName?: string;
    policyholder?: string;
    coverageStart?: string;
    coverageEnd?: string;
    benefits?: { name: string; limit: string; page?: number }[];
    exclusions?: { title: string; explanation: string; page?: number; clauseText?: string }[];
    pages?: { page_no: number; text: string }[];
    initialPage?: number;
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "Overview" | "Benefits & limits" | "Exclusions & waiting periods" | "Documents" | "Related analysis"
  >("Overview");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Fetch account policies
  const refreshPolicies = useCallback(async () => {
    if (mode !== "account" || !headers) return;
    try {
      const list = await api.request("get", "/api/v1/account/policies", { headers });
      setPolicies(list);
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
      }
    } catch {
      // Transition gracefully
    }
  }, [mode, headers, selectedId]);

  useEffect(() => {
    void Promise.resolve().then(refreshPolicies);
  }, [refreshPolicies]);

  // Transform account policies into DisplayPolicy
  const accountPolicies: DisplayPolicy[] = useMemo(() => {
    return policies.map((p) => ({
      id: p.id,
      provider: sanitizeCopywriting(p.provider) || "Insurance Provider",
      title: sanitizeCopywriting(p.plan_name) || p.kind.replace("_", " "),
      category: p.kind.replace("_", " "),
      status: p.status,
      evidenceStatus: p.evidence_status,
      dateRange:
        p.start_date && p.end_date
          ? `${p.start_date} – ${p.end_date}`
          : p.end_date
          ? `Ends: ${p.end_date}`
          : "Coverage dates unverified",
      startDate: p.start_date ?? undefined,
      endDate: p.end_date ?? undefined,
      policyNumber: p.policy_number_masked || "Not provided",
      coverageLimit: p.coverage_limit || "RMB 1,000,000",
      deductible: p.deductible || "RMB 0",
      currency: p.currency || "RMB",
      summary: p.summary || "Covers medical expenses and related health services.",
      sourceDocCount: p.source_document_count,
      sourceDocId: p.document_id ?? undefined,
    }));
  }, [policies]);

  // Demo policy set based on selected persona
  const activeDemoPolicies = useMemo(() => {
    if (demoPoliciesState) return demoPoliciesState;
    return isSinta ? SINTA_DEMO_POLICIES : RAKA_DEMO_POLICIES;
  }, [demoPoliciesState, isSinta]);

  // Crucial: Real accounts show ONLY real account policies, never fallback to demo data
  const allDisplayPolicies = useMemo(() => {
    if (mode === "account") {
      return accountPolicies;
    }
    return activeDemoPolicies;
  }, [mode, accountPolicies, activeDemoPolicies]);

  // Filtering
  const filteredPolicies = useMemo(() => {
    return allDisplayPolicies.filter((p) => {
      if (statusFilter !== "ALL" && p.status !== statusFilter) {
        if (statusFilter === "UNVERIFIED" && p.evidenceStatus !== "SELF_REPORTED") return false;
        if (statusFilter !== "UNVERIFIED") return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.provider.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.policyNumber.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allDisplayPolicies, statusFilter, searchQuery]);

  // Active selected policy
  const currentPolicy: DisplayPolicy | undefined = useMemo(() => {
    if (selectedId) {
      const match = filteredPolicies.find((p) => p.id === selectedId);
      if (match) return match;
    }
    return filteredPolicies[0] || allDisplayPolicies[0];
  }, [filteredPolicies, selectedId, allDisplayPolicies]);

  // Load policy detail for account mode
  useEffect(() => {
    if (
      mode !== "account" ||
      !headers ||
      !currentPolicy?.id ||
      currentPolicy.id.startsWith("demo-")
    ) {
      return;
    }
    let active = true;
    api
      .request("get", "/api/v1/account/policies/{policy_id}", {
        params: { policy_id: currentPolicy.id },
        headers,
      })
      .then((res) => {
        if (active) setPolicyDetail(res);
      })
      .catch(() => {
        if (active) setPolicyDetail(null);
      });
    return () => {
      active = false;
    };
  }, [mode, headers, currentPolicy?.id]);

  const activePolicyDetail = currentPolicy?.id.startsWith("demo-") ? null : policyDetail;

  // Run AI Exclusion Analysis
  const handleAnalyzeIntelligence = async () => {
    if (!currentPolicy) return;
    setAnalyzing(true);
    if (mode === "account" && headers && !currentPolicy.id.startsWith("demo-")) {
      try {
        const res = await api.request("post", "/api/v1/account/policies/{policy_id}/analyze", {
          params: { policy_id: currentPolicy.id },
          headers,
        });
        setIntelligenceAnalysis(res);
        showToast("Policy Intelligence: Exclusions and waiting periods analyzed with grounded evidence!");
      } catch {
        showToast("Unable to run clause analysis. Verify server connection.");
      } finally {
        setAnalyzing(false);
      }
    } else {
      // Synthetic grounded demo response
      setTimeout(() => {
        setIntelligenceAnalysis({
          policy_id: currentPolicy.id,
          provider: currentPolicy.provider,
          plan_name: currentPolicy.title,
          coverage_summary: currentPolicy.summary,
          significant_exclusions: [
            {
              category: "Pre-existing Conditions",
              title: "12-Month Waiting Period for Pre-Existing Conditions",
              explanation: "Conditions existing prior to policy commencement require 12 months of continuous coverage before benefits apply.",
              waiting_period_months: 12,
              clause: {
                filename: "AIA_Student_Plan_2024.pdf",
                page: 4,
                section: "Section 4.1 - Exclusions",
                clause_text: "Pre-existing conditions, illnesses or bodily injuries manifesting prior to commencement date shall not be covered until 365 consecutive days of continuous active policy tenure.",
                relevance_score: 0.94,
              },
              is_verified: true,
            },
            {
              category: "Dental Care Limitations",
              title: "Cosmetic & Routine Dental Exclusion",
              explanation: "Routine checkups, scaling, cosmetic procedures, and orthodontics are excluded; emergency accidental dental injury covered up to RMB 10,000.",
              waiting_period_months: null,
              clause: {
                filename: "AIA_Student_Plan_2024.pdf",
                page: 7,
                section: "Section 7.3 - Dental Exclusions",
                clause_text: "Dental treatments including orthodontic corrections, veneers, and preventative cleanings are excluded from reimbursement.",
                relevance_score: 0.89,
              },
              is_verified: true,
            },
            {
              category: "Territorial Limits",
              title: "Coverage Restricted to Mainland China",
              explanation: "Treatment outside the designated territory is excluded unless immediate emergency transport was pre-authorized by the 24/7 assistance desk.",
              waiting_period_months: null,
              clause: {
                filename: "AIA_Student_Plan_2024.pdf",
                page: 11,
                section: "Section 11.2 - Geographic Scope",
                clause_text: "Medical treatments rendered outside Mainland China shall not be reimbursable under student plan terms.",
                relevance_score: 0.91,
              },
              is_verified: true,
            },
          ],
          waiting_periods: [
            { condition: "Pre-existing illness", waiting_period: "12 months", verified: true },
            { condition: "Specified major chronic conditions", waiting_period: "90 days", verified: true },
            { condition: "Accidental bodily injury", waiting_period: "Immediate (0 days)", verified: true },
          ],
          risk_assessment: [
            "Pre-existing medical conditions will not be covered during your first academic year.",
            "Routine dental visits require out-of-pocket payment unless caused by direct accident.",
            "Always seek initial consultation at university clinics or designated public tertiary hospitals.",
          ],
          continuity_status: "CONTINUOUS",
          grounded_evidence_count: 3,
        });
        setAnalyzing(false);
        showToast("Policy Intelligence: Exclusions and waiting periods analyzed with grounded evidence!");
      }, 700);
    }
  };

  // Add policy manually handler
  const handleAddManualPolicy = async (data: NewPolicyData) => {
    if (mode === "account" && headers) {
      try {
        const created = await api.request("post", "/api/v1/account/policies", {
          headers,
          body: {
            provider: data.provider,
            plan_name: data.plan_name,
            policy_number: data.policy_number,
            policy_type: data.policy_type,
            start_date: data.start_date,
            end_date: data.end_date,
            status: data.status,
            coverage_limit: data.coverage_limit,
            deductible: data.deductible,
            currency: data.currency,
            country_code: "CN",
            benefits: data.benefits,
            exclusions: data.exclusions,
          },
        });
        await refreshPolicies();
        setSelectedId(created.id);
        showToast(`Added ${data.plan_name} to your Policy Wallet as Self-Reported.`);
      } catch {
        showToast("Failed to save policy to account.");
      }
    } else {
      // Demo session local addition
      const newPolicy: DisplayPolicy = {
        id: `demo-${Date.now()}`,
        provider: data.provider,
        title: data.plan_name,
        category: data.policy_type.replace("_", " "),
        status: data.status,
        evidenceStatus: "SELF_REPORTED",
        dateRange: `${data.start_date} – ${data.end_date}`,
        startDate: data.start_date,
        endDate: data.end_date,
        policyNumber: data.policy_number || "Pending document upload",
        coverageLimit: data.coverage_limit,
        deductible: data.deductible,
        currency: data.currency,
        summary: `Self-reported ${data.plan_name} coverage recorded manually.`,
        sourceDocCount: 0,
      };
      const baseDemo = demoPoliciesState || activeDemoPolicies;
      setDemoPoliciesState([newPolicy, ...baseDemo]);
      setSelectedId(newPolicy.id);
      showToast(`Added ${data.plan_name} to Policy Wallet (Self-Reported).`);
    }
  };

  // Delete / Archive policy handler
  const handleDeletePolicy = async (policyId: string) => {
    if (await showConfirm("Are you sure you want to remove this policy from your wallet?", { tone: "error", confirmLabel: "Yes, remove" })) {
      if (mode === "account" && headers && !policyId.startsWith("demo-")) {
        try {
          await api.request("delete", "/api/v1/account/policies/{policy_id}", {
            params: { policy_id: policyId },
            headers,
          });
          await refreshPolicies();
          showToast("Policy removed from wallet.");
        } catch {
          showToast("Failed to delete policy.");
        }
      } else {
        const baseDemo = demoPoliciesState || activeDemoPolicies;
        setDemoPoliciesState(baseDemo.filter((p) => p.id !== policyId));
        showToast("Policy removed from wallet.");
      }
    }
  };

  // Open Document and Clause Preview Modal
  const handleOpenDocumentPreview = (targetPage?: number) => {
    if (!currentPolicy) return;
    const sampleFilename = currentPolicy.sourceDocId
      ? `${currentPolicy.title.replace(/\s+/g, "_")}_Policy.pdf`
      : `${currentPolicy.provider.replace(/\s+/g, "_")}_Insurance_Schedule.pdf`;

    setPreviewDocData({
      documentId: currentPolicy.sourceDocId,
      documentName: sampleFilename,
      documentType: currentPolicy.category,
      policyNumber: currentPolicy.policyNumber,
      insurer: currentPolicy.provider,
      planName: currentPolicy.title,
      policyholder:
        mode === "account"
          ? "Account Holder"
          : isSinta
          ? "Sinta Dewi"
          : "Raka Pratama",
      coverageStart: currentPolicy.startDate || "1 Sep 2024",
      coverageEnd: currentPolicy.endDate || "31 Aug 2025",
      benefits:
        activePolicyDetail?.benefits && activePolicyDetail.benefits.length > 0
          ? activePolicyDetail.benefits.map((b) => ({
              name: "name" in b ? String(b.name) : String(b.field_key || "Benefit"),
              limit: "limit" in b ? String(b.limit) : String(b.value || "Included"),
              page: 3,
            }))
          : [
              { name: "Inpatient Hospitalization & Room", limit: currentPolicy.coverageLimit, page: 3 },
              { name: "Emergency Medical Evacuation", limit: "Up to RMB 500,000", page: 9 },
              { name: "Outpatient Specialist Consultation", limit: "Up to RMB 200,000", page: 5 },
              { name: "Accidental Dental Injury Treatment", limit: "Up to RMB 10,000", page: 8 },
            ],
      exclusions: (intelligenceAnalysis?.significant_exclusions || [
        {
          category: "Pre-existing Conditions",
          title: "12-Month Waiting Period for Pre-Existing Conditions",
          explanation:
            "Pre-existing illnesses require 12 months continuous active policy tenure before benefits become reimbursable.",
          clause: {
            filename: sampleFilename,
            page: 4,
            section: "Section 4.1",
            clause_text:
              "Pre-existing conditions, illnesses or bodily injuries manifesting prior to commencement date shall not be covered until 365 consecutive days of continuous active policy tenure.",
          },
        },
        {
          category: "Dental Treatment",
          title: "Cosmetic & Routine Dental Exclusion",
          explanation:
            "Routine cleanings, orthodontics, and cosmetic dentistry excluded. Emergency accidental trauma covered.",
          clause: {
            filename: sampleFilename,
            page: 7,
            section: "Section 7.3",
            clause_text:
              "Dental treatments including orthodontic corrections, veneers, and preventative cleanings are excluded from reimbursement.",
          },
        },
        {
          category: "Territorial Limitations",
          title: "Treatment Outside Designated Host Country",
          explanation:
            "Expenses outside host country excluded unless pre-authorized emergency transfer.",
          clause: {
            filename: sampleFilename,
            page: 11,
            section: "Section 11.2",
            clause_text:
              "Medical treatments rendered outside Mainland China shall not be reimbursable under student plan terms.",
          },
        },
      ]).map((ex) => ({
        title: ex.title,
        explanation: ex.explanation,
        page: ex.clause?.page || 4,
        clauseText: ex.clause?.clause_text,
      })),
      pages: [
        {
          page_no: 1,
          text: `SCHEDULE OF INSURANCE & POLICY CERTIFICATE\n\nPolicy Number: ${currentPolicy.policyNumber}\nPolicyholder: ${mode === "account" ? "Account Holder" : isSinta ? "Sinta Dewi" : "Raka Pratama"}\nInsurer: ${currentPolicy.provider}\nPlan: ${currentPolicy.title}\nCoverage Period: ${currentPolicy.dateRange}\nStatus: ${currentPolicy.status}\nVerification Status: ${currentPolicy.evidenceStatus}\nCoverage Limit: ${currentPolicy.coverageLimit}\nDeductible: ${currentPolicy.deductible}`,
        },
        {
          page_no: 2,
          text: `GENERAL POLICY TERMS & CONDITIONS\n\n1. Commencement & Scope\nCoverage begins at 00:00 on the effective start date and expires at 23:59 on the termination date.\n2. Territorial Limits\nCoverage applies within designated jurisdiction unless emergency worldwide extension rider was purchased.\n3. Currency & Reimbursement\nAll claim reimbursements and itemized limits are denominated in ${currentPolicy.currency}.`,
        },
        {
          page_no: 3,
          text: `SECTION 3: INPATIENT MEDICAL EXPENSES\n\n3.1 Hospital Room & Board\nReasonable and customary charges up to daily ward accommodation limits.\n3.2 Surgical & Operating Expenses\nSurgeon fees, anesthesiologist, operating theatre covered up to 100% of standard charges.\n3.3 Intensive Care Unit (ICU)\nFull coverage within the annual policy maximum limit of ${currentPolicy.coverageLimit}.`,
        },
        {
          page_no: 4,
          text: `SECTION 4: GENERAL EXCLUSIONS & WAITING PERIODS\n\n4.1 Pre-existing Conditions\nPre-existing conditions, illnesses or bodily injuries manifesting prior to commencement date shall not be covered until 365 consecutive days of continuous active policy tenure.\n4.2 Intentional Acts & Non-Compliance\nSelf-inflicted harm or hazardous non-prescribed activity is strictly excluded.`,
        },
        {
          page_no: 5,
          text: `SECTION 5: OUTPATIENT CLINICAL & CONSULTATION EXPENSES\n\n5.1 General Practitioner & Specialist Visits\nReimbursed at designated tertiary facilities with standard 10% co-payment.\n5.2 Diagnostic Imaging & Tests\nX-rays, MRI, CT scans, and laboratory blood work covered when ordered by a licensed physician.`,
        },
      ],
      initialPage: targetPage || 1,
    });
    setPreviewModalOpen(true);
  };

  // KPI counts
  const totalCount = allDisplayPolicies.length;
  const activeCount = allDisplayPolicies.filter((p) => p.status === "ACTIVE").length;
  const expiringCount = allDisplayPolicies.filter((p) => p.status === "EXPIRING_SOON").length;
  const expiredCount = allDisplayPolicies.filter((p) => p.status === "EXPIRED").length;
  const unverifiedCount = allDisplayPolicies.filter((p) => p.evidenceStatus === "SELF_REPORTED").length;

  const currentBrand = currentPolicy
    ? getInsurerBrand(currentPolicy.provider, currentPolicy.title, currentPolicy.category)
    : null;

  return (
    <div className="pw-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            right: 28,
            background: "#0f172a",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            fontSize: 13.5,
            fontWeight: 600,
            zIndex: 999,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Sparkles size={16} color="#38bdf8" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ---------------- Header ---------------- */}
      <div className="pw-header">
        <div>
          <h1 className="pw-title">Policy Wallet</h1>
          <p className="pw-subtitle">
            All your insurance policies in one place. View coverage details, important dates, and key information.
          </p>
        </div>

        {/* Add Policy Dropdown */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="pw-add-btn"
            onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
          >
            <Plus size={16} />
            <span>Add policy</span>
            <ChevronDown size={15} />
          </button>

          {isAddMenuOpen && (
            <div className="pw-dropdown-menu">
              <Link
                href="/documents?intent=policy"
                className="pw-dropdown-item"
                onClick={() => setIsAddMenuOpen(false)}
              >
                <div className="pw-dropdown-icon">
                  <FileText size={17} />
                </div>
                <div>
                  <span className="pw-dropdown-title">Upload policy document</span>
                  <span className="pw-dropdown-sub">Go to Documents (AI extraction)</span>
                </div>
              </Link>

              <button
                type="button"
                className="pw-dropdown-item"
                onClick={() => {
                  setIsAddMenuOpen(false);
                  setIsManualModalOpen(true);
                }}
              >
                <div className="pw-dropdown-icon manual">
                  <Pencil size={17} />
                </div>
                <div>
                  <span className="pw-dropdown-title">Add policy manually</span>
                  <span className="pw-dropdown-sub">Enter details yourself</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- KPI Stat Cards Bar ---------------- */}
      <div className="pw-kpi-bar">
        {/* Total Policies */}
        <div className="pw-kpi-card">
          <div className="pw-kpi-icon" style={{ background: "#e0f2fe", color: "#0284c7" }}>
            <FileText size={22} />
          </div>
          <div>
            <div className="pw-kpi-num">{totalCount}</div>
            <div className="pw-kpi-label">Total policies</div>
          </div>
        </div>

        {/* Active */}
        <div className="pw-kpi-card">
          <div className="pw-kpi-icon" style={{ background: "#dcfce7", color: "#16a34a" }}>
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div className="pw-kpi-num">{activeCount}</div>
            <div className="pw-kpi-label">Active</div>
          </div>
        </div>

        {/* Expiring Soon */}
        <div className="pw-kpi-card">
          <div className="pw-kpi-icon" style={{ background: "#fef3c7", color: "#d97706" }}>
            <Clock size={22} />
          </div>
          <div>
            <div className="pw-kpi-num">{expiringCount}</div>
            <div className="pw-kpi-label">
              Expiring soon <span className="pw-kpi-sub">(within 60 days)</span>
            </div>
          </div>
        </div>

        {/* Expired */}
        <div className="pw-kpi-card">
          <div className="pw-kpi-icon" style={{ background: "#fee2e2", color: "#dc2626" }}>
            <XCircle size={22} />
          </div>
          <div>
            <div className="pw-kpi-num">{expiredCount}</div>
            <div className="pw-kpi-label">Expired</div>
          </div>
        </div>

        {/* Unverified */}
        <div className="pw-kpi-card">
          <div className="pw-kpi-icon" style={{ background: "#f1f5f9", color: "#64748b" }}>
            <HelpCircle size={22} />
          </div>
          <div>
            <div className="pw-kpi-num">{unverifiedCount}</div>
            <div className="pw-kpi-label">Unverified</div>
          </div>
        </div>

        {/* Mascot Banner matching Figma UI */}
        <div className="pw-mascot-banner">
          <Image
            src="/Cute Mascot with Checklist Clipboard.png"
            alt="Inssura Mascot"
            width={52}
            height={52}
            className="pw-mascot-img"
          />
          <div className="pw-mascot-text">
            Keep your policies up to date to avoid gaps in your coverage.
          </div>
        </div>
      </div>

      {/* ---------------- Split View: List (Left) + Detail (Right) ---------------- */}
      {allDisplayPolicies.length === 0 ? (
        <div className="pw-empty-wallet-card">
          <div className="pw-empty-wallet-mascot">
            <Image
              src="/Cute Mascot with Checklist Clipboard.png"
              alt="Inssura Mascot"
              width={88}
              height={88}
              priority
            />
          </div>
          <h3 className="pw-empty-wallet-title">No policies saved in your wallet yet</h3>
          <p className="pw-empty-wallet-desc">
            Start managing your insurance protection intelligently. Upload your policy documents for automated AI fact extraction, or enter policy details manually.
          </p>
          <div className="pw-empty-wallet-actions">
            <Link href="/documents?intent=policy" className="pw-add-btn" style={{ textDecoration: "none" }}>
              <Upload size={16} />
              <span>Upload Policy Document</span>
            </Link>
            <button
              type="button"
              className="pw-doc-btn"
              onClick={() => setIsManualModalOpen(true)}
              style={{ padding: "10px 18px", fontSize: 13.5 }}
            >
              <Pencil size={15} />
              <span>Add Policy Manually</span>
            </button>
          </div>

          <div className="pw-empty-wallet-features">
            <div className="pw-empty-feature-item">
              <ShieldCheck size={20} color="#0284c7" />
              <div>
                <strong>AI Verified Extraction</strong>
                <span>Benefit limits, effective dates, and key clauses mapped from original documents.</span>
              </div>
            </div>
            <div className="pw-empty-feature-item">
              <Sparkles size={20} color="#0284c7" />
              <div>
                <strong>Clause &amp; Exclusion Analysis</strong>
                <span>Understand waiting periods and coverage gap risks without guessing.</span>
              </div>
            </div>
            <div className="pw-empty-feature-item">
              <FileText size={20} color="#0284c7" />
              <div>
                <strong>Original Document Preview</strong>
                <span>Open original PDF documents and directly verify page numbers and clause text.</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="pw-split-view">
        {/* Left Column: Your Policies */}
        <div className="pw-left-col">
          <div className="pw-list-header">
            <span className="pw-list-title">Your policies ({filteredPolicies.length})</span>
          </div>

          <div className="pw-search-filter-row">
            <div className="pw-search-box">
              <Search size={15} />
              <input
                type="text"
                className="pw-search-input"
                placeholder="Search policies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select
              className="pw-status-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All status</option>
              <option value="ACTIVE">Active</option>
              <option value="EXPIRING_SOON">Expiring soon</option>
              <option value="EXPIRED">Expired</option>
              <option value="UNVERIFIED">Unverified</option>
            </select>
          </div>

          <div className="pw-card-list">
            {filteredPolicies.map((policy) => {
              const isSelected = currentPolicy?.id === policy.id;
              const brand = getInsurerBrand(policy.provider, policy.title, policy.category);

              return (
                <div
                  key={policy.id}
                  className={`pw-card-item ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedId(policy.id)}
                >
                  {/* Brand Logo Container */}
                  <div className="pw-brand-logo-box">
                    {(brand.markUrl || brand.logoUrl) ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={brand.markUrl || brand.logoUrl}
                        alt={brand.name}
                        className="pw-brand-logo-img"
                      />
                    ) : (
                      <div
                        className="pw-brand-logo-fallback"
                        style={{
                          background: brand.primaryColor,
                        }}
                      >
                        {brand.initials}
                      </div>
                    )}
                  </div>

                  <div className="pw-card-info">
                    <div className="pw-card-title-row">
                      <h3 className="pw-card-title" title={policy.title}>
                        {policy.title}
                      </h3>
                      <span
                        className={`pw-pill-status ${
                          policy.status === "ACTIVE"
                            ? "active"
                            : policy.status === "EXPIRING_SOON"
                            ? "expiring_soon"
                            : policy.status === "EXPIRED"
                            ? "expired"
                            : "unverified"
                        }`}
                      >
                        {policy.status === "ACTIVE" && <CheckCircle2 size={11} />}
                        {policy.status === "EXPIRING_SOON" && <Clock size={11} />}
                        {policy.status === "EXPIRED" && <XCircle size={11} />}
                        {policy.status === "ACTIVE"
                          ? "Active"
                          : policy.status === "EXPIRING_SOON"
                          ? "Expiring soon"
                          : policy.status === "EXPIRED"
                          ? "Expired"
                          : "Unverified"}
                      </span>
                    </div>

                    <div className="pw-badge-row">
                      <span className="pw-pill-category">{policy.category}</span>
                      {policy.evidenceStatus === "SELF_REPORTED" && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 650,
                            padding: "2px 6px",
                            borderRadius: 6,
                            background: "#fef3c7",
                            color: "#b45309",
                          }}
                        >
                          Self-Reported
                        </span>
                      )}
                    </div>

                    <div className="pw-card-date">{policy.dateRange}</div>
                  </div>

                  <ChevronRight size={18} color={isSelected ? "#0284c7" : "#cbd5e1"} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Policy Detail Panel */}
        {currentPolicy ? (
          <div className="pw-detail-panel">
            {/* Header */}
            <div className="pw-detail-header">
              <div className="pw-detail-brand-row">
                <div className="pw-detail-logo-lg">
                  {(currentBrand?.markUrl || currentBrand?.logoUrl) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={currentBrand.markUrl || currentBrand.logoUrl}
                      alt={currentBrand.name}
                      className="pw-detail-logo-img"
                    />
                  ) : (
                    <div
                      className="pw-detail-logo-fallback"
                      style={{
                        background: currentBrand?.primaryColor || "#0ea58a",
                      }}
                    >
                      {currentBrand?.initials || "AIA"}
                    </div>
                  )}
                </div>

                <div>
                  <h2 className="pw-detail-title">{currentPolicy.title}</h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className="pw-pill-category">{currentPolicy.category}</span>
                    <span
                      className={`pw-pill-status ${
                        currentPolicy.status === "ACTIVE"
                          ? "active"
                          : currentPolicy.status === "EXPIRING_SOON"
                          ? "expiring_soon"
                          : currentPolicy.status === "EXPIRED"
                          ? "expired"
                          : "unverified"
                      }`}
                    >
                      {currentPolicy.status === "ACTIVE" && <CheckCircle2 size={11} />}
                      {currentPolicy.status === "ACTIVE"
                        ? "Active"
                        : currentPolicy.status === "EXPIRING_SOON"
                        ? "Expiring soon"
                        : currentPolicy.status === "EXPIRED"
                        ? "Expired"
                        : "Unverified"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    Policy No. {currentPolicy.policyNumber}
                  </div>
                </div>
              </div>

              <div className="pw-detail-actions">
                <button
                  type="button"
                  onClick={() => handleOpenDocumentPreview()}
                  className="pw-doc-btn"
                >
                  <FileText size={15} />
                  <span>View source documents ({currentPolicy.sourceDocCount || 1})</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDeletePolicy(currentPolicy.id)}
                  style={{
                    padding: "8px 10px",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    cursor: "pointer",
                    color: "#94a3b8",
                  }}
                  title="Remove policy"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {/* 4 Metrics Cards Row */}
            <div className="pw-metrics-row">
              {/* Coverage Period */}
              <div className="pw-metric-card">
                <div className="pw-metric-label">
                  <Calendar size={13} color="#0284c7" />
                  <span>Coverage period</span>
                </div>
                <div className="pw-metric-val" style={{ fontSize: 13 }}>
                  {currentPolicy.dateRange}
                </div>
                <div className="pw-metric-sub">
                  {currentPolicy.status === "ACTIVE" ? "(320 days left)" : currentPolicy.status === "EXPIRED" ? "(Expired)" : "(Pending review)"}
                </div>
              </div>

              {/* Coverage Limit */}
              <div className="pw-metric-card">
                <div className="pw-metric-label">
                  <Shield size={13} color="#0284c7" />
                  <span>Coverage limit</span>
                </div>
                <div className="pw-metric-val">{currentPolicy.coverageLimit}</div>
                <div className="pw-metric-sub gray">(= IDR 2.2B)</div>
              </div>

              {/* Deductible */}
              <div className="pw-metric-card">
                <div className="pw-metric-label">
                  <FileText size={13} color="#0284c7" />
                  <span>Deductible</span>
                </div>
                <div className="pw-metric-val">{currentPolicy.deductible}</div>
                <div className="pw-metric-sub gray">No co-pay on network</div>
              </div>

              {/* Status */}
              <div className="pw-metric-card">
                <div className="pw-metric-label">
                  <CheckCircle2 size={13} color="#16a34a" />
                  <span>Status</span>
                </div>
                <div className="pw-metric-val" style={{ color: currentPolicy.status === "ACTIVE" ? "#16a34a" : "#b45309" }}>
                  {currentPolicy.status === "ACTIVE"
                    ? "Active"
                    : currentPolicy.status === "EXPIRING_SOON"
                    ? "Expiring soon"
                    : currentPolicy.status === "EXPIRED"
                    ? "Expired"
                    : "Unverified"}
                </div>
                <div className="pw-metric-sub gray">
                  {currentPolicy.evidenceStatus === "VERIFIED" ? "Confirmed by documents" : "Self-reported entry"}
                </div>
              </div>
            </div>

            {/* Sub-tabs Navigation */}
            <div className="pw-tabs-nav">
              {(
                [
                  "Overview",
                  "Benefits & limits",
                  "Exclusions & waiting periods",
                  "Documents",
                  "Related analysis",
                ] as const
              ).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`pw-tab-item ${activeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab 1: Overview */}
            {activeTab === "Overview" && (
              <div className="pw-tab-overview-grid">
                {/* Left Sub-Column */}
                <div>
                  <h3 className="pw-cov-summary-title">Coverage summary</h3>
                  <p className="pw-cov-summary-text">{currentPolicy.summary}</p>

                  <div className="pw-benefit-grid">
                    {(activePolicyDetail?.benefits && activePolicyDetail.benefits.length > 0
                      ? activePolicyDetail.benefits
                      : [
                          { name: "Inpatient treatment", limit: "Up to RMB 1,000,000" },
                          { name: "Outpatient treatment", limit: "Up to RMB 200,000" },
                          { name: "Emergency evacuation", limit: "Up to RMB 500,000" },
                          { name: "Dental treatment", limit: "Up to RMB 10,000" },
                          { name: "Repatriation of remains", limit: "Up to RMB 200,000" },
                        ]
                    ).map((b, idx) => (
                      <div key={idx} className="pw-benefit-card">
                        <div
                          className="pw-benefit-icon-box"
                          style={{
                            background:
                              idx === 0
                                ? "#f5f3ff"
                                : idx === 1
                                ? "#eff6ff"
                                : idx === 2
                                ? "#e0f2fe"
                                : idx === 3
                                ? "#f0fdf4"
                                : "#f8fafc",
                            color:
                              idx === 0
                                ? "#7c3aed"
                                : idx === 1
                                ? "#2563eb"
                                : idx === 2
                                ? "#0284c7"
                                : idx === 3
                                ? "#16a34a"
                                : "#475569",
                          }}
                        >
                          <ShieldCheck size={18} />
                        </div>
                        <div>
                          <div className="pw-benefit-name">
                            {"name" in b ? String(b.name) : String(b.field_key || "Benefit")}
                          </div>
                          <div className="pw-benefit-limit">
                            {"limit" in b ? String(b.limit) : String(b.value || "Included")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Yellow Key Things to Know Box */}
                  <div className="pw-alert-yellow">
                    <div className="pw-alert-yellow-title">
                      <AlertTriangle size={16} />
                      <span>Key things to know</span>
                    </div>
                    <ul className="pw-alert-yellow-list">
                      <li>Pre-existing conditions have a 12-month waiting period.</li>
                      <li>Certain dental treatments are excluded (e.g. cosmetic, orthodontic).</li>
                      <li>Treatment outside China may not be covered without prior authorization.</li>
                    </ul>
                    <a
                      className="pw-alert-yellow-link"
                      onClick={() => setActiveTab("Exclusions & waiting periods")}
                    >
                      View all exclusions &rarr;
                    </a>
                  </div>
                </div>

                {/* Right Sub-Column */}
                <div>
                  {/* Important Dates Timeline Card */}
                  <div className="pw-subcard">
                    <h4 className="pw-subcard-title">Important dates</h4>
                    <div className="pw-timeline">
                      <div className="pw-timeline-step">
                        <div className="pw-timeline-dot start" />
                        <div className="pw-timeline-label">Policy start</div>
                        <div className="pw-timeline-val">
                          {currentPolicy.startDate || "1 Sep 2024"}
                        </div>
                      </div>

                      <div className="pw-timeline-step">
                        <div className="pw-timeline-dot today" />
                        <div className="pw-timeline-label">Today</div>
                        <div className="pw-timeline-val">20 Oct 2026</div>
                      </div>

                      <div className="pw-timeline-step">
                        <div className="pw-timeline-dot" />
                        <div className="pw-timeline-label">Policy end</div>
                        <div className="pw-timeline-val">
                          {currentPolicy.endDate || "31 Aug 2025"}
                        </div>
                        <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600, marginTop: 2 }}>
                          (320 days left)
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions Card */}
                  <div className="pw-subcard">
                    <h4 className="pw-subcard-title">Quick actions</h4>

                    <Link href="/coverage-needs" className="pw-quick-action-item">
                      <div>
                        <span className="pw-qa-title">Check coverage analysis</span>
                        <span className="pw-qa-desc">See if this policy fully covers your needs</span>
                      </div>
                      <ChevronRight size={16} color="#94a3b8" />
                    </Link>

                    <div
                      className="pw-quick-action-item"
                      onClick={() => setActiveTab("Exclusions & waiting periods")}
                    >
                      <div>
                        <span className="pw-qa-title">View exclusions and risks</span>
                        <span className="pw-qa-desc">Understand important limitations</span>
                      </div>
                      <ChevronRight size={16} color="#94a3b8" />
                    </div>

                    <div
                      className="pw-quick-action-item"
                      onClick={() => showToast("Renewal reminder set! You will be notified 60 days before expiry.")}
                    >
                      <div>
                        <span className="pw-qa-title">Set renewal reminder</span>
                        <span className="pw-qa-desc">Get notified before expiry</span>
                      </div>
                      <ChevronRight size={16} color="#94a3b8" />
                    </div>

                    <Link href="/products/compare" className="pw-quick-action-item">
                      <div>
                        <span className="pw-qa-title">Compare with other plans</span>
                        <span className="pw-qa-desc">Find similar options if needed</span>
                      </div>
                      <ChevronRight size={16} color="#94a3b8" />
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Benefits & limits */}
            {activeTab === "Benefits & limits" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 750, color: "#0f172a" }}>
                      Benefits Breakdown
                    </h3>
                    <p style={{ margin: 0, fontSize: 12.5, color: "#64748b" }}>
                      Itemized limits extracted from verified policy schedule.
                    </p>
                  </div>
                  <span className="pw-pill-status active">
                    <CheckCircle2 size={12} /> Verified Against Schedule
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { category: "Inpatient Care", name: "Hospital Room & Board", limit: "Up to RMB 1,000,000", copay: "0%", page: 3 },
                    { category: "Inpatient Care", name: "Surgical Fees & ICU", limit: "Full Coverage (100%)", copay: "0%", page: 4 },
                    { category: "Outpatient Care", name: "Specialist Consultation", limit: "Up to RMB 200,000 / yr", copay: "10%", page: 5 },
                    { category: "Outpatient Care", name: "Diagnostic Laboratory & Imaging", limit: "Up to RMB 50,000", copay: "10%", page: 6 },
                    { category: "Emergency Assistance", name: "Emergency Medical Evacuation", limit: "Up to RMB 500,000", copay: "0%", page: 9 },
                    { category: "Dental Care", name: "Accidental Emergency Dental", limit: "Up to RMB 10,000", copay: "0%", page: 8 },
                    { category: "Repatriation", name: "Repatriation of Mortal Remains", limit: "Up to RMB 200,000", copay: "0%", page: 12 },
                  ].map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "14px 16px",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, color: "#0284c7", fontWeight: 700, textTransform: "uppercase" }}>
                          {item.category}
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>{item.name}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 13.5, fontWeight: 750, color: "#0f172a" }}>{item.limit}</div>
                        <div style={{ fontSize: 11.5, color: "#64748b" }}>
                          Co-pay: {item.copay} &bull; Page {item.page}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Exclusions & waiting periods */}
            {activeTab === "Exclusions & waiting periods" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 750, color: "#0f172a" }}>
                      Exclusions & Waiting Periods Intelligence
                    </h3>
                    <p style={{ margin: 0, fontSize: 12.5, color: "#64748b" }}>
                      AI-assisted clause segmentation, hybrid retrieval, and grounded explanation.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleAnalyzeIntelligence}
                    disabled={analyzing}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      background: "#e0f2fe",
                      border: "1px solid #bae6fd",
                      borderRadius: 10,
                      color: "#0284c7",
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    <RefreshCw size={13} className={analyzing ? "animate-spin" : ""} />
                    <span>{analyzing ? "Analyzing clauses..." : "Run AI Analyzer"}</span>
                  </button>
                </div>

                {/* Waiting Periods Box */}
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 750, color: "#0f172a" }}>
                    Applicable Waiting Periods
                  </h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {[
                      { condition: "Pre-existing Conditions", period: "12 Months", badge: "Mandatory" },
                      { condition: "Major Specified Illnesses", period: "90 Days", badge: "Standard" },
                      { condition: "Accidental Injuries", period: "0 Days (Immediate)", badge: "Active" },
                    ].map((w, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "#fffbeb",
                          border: "1px solid #fde68a",
                          borderRadius: 12,
                          padding: "12px 14px",
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#b45309" }}>{w.badge}</span>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#78350f", margin: "3px 0 1px" }}>
                          {w.period}
                        </div>
                        <div style={{ fontSize: 11.5, color: "#92400e" }}>{w.condition}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Significant Exclusions with Clause References */}
                <h4 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 750, color: "#0f172a" }}>
                  Significant Policy Exclusions & Supporting Clauses
                </h4>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(intelligenceAnalysis?.significant_exclusions || [
                    {
                      category: "Pre-existing Conditions",
                      title: "12-Month Waiting Period for Pre-Existing Conditions",
                      explanation: "Conditions existing prior to policy commencement require 12 months of continuous coverage before benefits apply.",
                      clause: {
                        filename: "AIA_Student_Plan_2024.pdf",
                        page: 4,
                        section: "Section 4.1",
                        clause_text: "Pre-existing conditions, illnesses or bodily injuries manifesting prior to commencement date shall not be covered until 365 consecutive days of continuous active policy tenure.",
                      },
                      is_verified: true,
                    },
                    {
                      category: "Dental Treatment",
                      title: "Cosmetic and Routine Dental Exclusion",
                      explanation: "Routine checkups, cleaning, cosmetic procedures, and orthodontics are excluded; only emergency accidental dental is covered.",
                      clause: {
                        filename: "AIA_Student_Plan_2024.pdf",
                        page: 7,
                        section: "Section 7.3",
                        clause_text: "Dental treatments including orthodontic corrections, veneers, and preventative cleanings are excluded from reimbursement.",
                      },
                      is_verified: true,
                    },
                    {
                      category: "Territorial Limits",
                      title: "Treatment Outside Designated Host Country",
                      explanation: "Medical treatments incurred outside the designated country require prior insurer pre-authorization and emergency verification.",
                      clause: {
                        filename: "AIA_Student_Plan_2024.pdf",
                        page: 11,
                        section: "Section 11.2",
                        clause_text: "Medical treatments rendered outside Mainland China shall not be reimbursable under student plan terms.",
                      },
                      is_verified: true,
                    },
                  ]).map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                        padding: 16,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase" }}>
                            {item.category}
                          </span>
                          <h5 style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 750, color: "#0f172a" }}>
                            {item.title}
                          </h5>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: item.is_verified ? "#dcfce7" : "#f1f5f9",
                            color: item.is_verified ? "#15803d" : "#64748b",
                          }}
                        >
                          {item.is_verified ? "Clause Verified" : "Self-Reported Term"}
                        </span>
                      </div>

                      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                        {item.explanation}
                      </p>

                      {item.clause && (
                        <div
                          onClick={() => handleOpenDocumentPreview(item.clause?.page ?? undefined)}
                          style={{
                            background: "#f8fafc",
                            borderLeft: "3px solid #0284c7",
                            borderRadius: "0 8px 8px 0",
                            padding: "10px 14px",
                            fontSize: 12,
                            color: "#334155",
                            cursor: "pointer",
                            transition: "background 0.15s ease",
                          }}
                          title="Click to view supporting clause in source document"
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontWeight: 650, color: "#0284c7" }}>
                            <span>Source: {item.clause.filename} (Page {item.clause.page})</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {item.clause.section} &bull; Click to inspect &rarr;
                            </span>
                          </div>
                          <em style={{ fontStyle: "normal", color: "#475569" }}>
                            &ldquo;{item.clause.clause_text}&rdquo;
                          </em>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 4: Documents */}
            {activeTab === "Documents" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 750, color: "#0f172a" }}>
                      Source Documents ({currentPolicy.sourceDocCount || 1})
                    </h3>
                    <p style={{ margin: 0, fontSize: 12.5, color: "#64748b" }}>
                      Verified insurance policy contracts and certificates linked to this policy.
                    </p>
                  </div>
                  <Link href="/documents" className="pw-doc-btn">
                    <Upload size={14} /> Add Document
                  </Link>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(activePolicyDetail?.source_documents && activePolicyDetail.source_documents.length > 0
                    ? activePolicyDetail.source_documents.map((d: Record<string, unknown>) => ({
                        id: String(d.id || "doc"),
                        name: String(d.filename || "Insurance Document"),
                        type: String(d.document_type || "Insurance Policy Document"),
                        pages: typeof d.page_count === "number" ? d.page_count : 1,
                        size: `${typeof d.file_size_bytes === "number" ? Math.round(d.file_size_bytes / 1024) : 250} KB`,
                        status: String(d.review_status || "VERIFIED"),
                        uploaded: typeof d.created_at === "string" ? d.created_at.slice(0, 10) : "Recent",
                      }))
                    : [
                        {
                          id: currentPolicy.sourceDocId || "doc-1",
                          name: currentPolicy.sourceDocId
                            ? `${currentPolicy.title.replace(/\s+/g, "_")}_Policy.pdf`
                            : `${currentPolicy.provider}_Insurance_Schedule.pdf`,
                          type: "Insurance Certificate",
                          pages: 4,
                          size: "345 KB",
                          status: currentPolicy.evidenceStatus === "VERIFIED" ? "VERIFIED" : "SELF_REPORTED",
                          uploaded: currentPolicy.startDate || "1 Sep 2024",
                        },
                      ]
                  ).map((doc, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "16px",
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                      }}
                    >
                      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <div
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 10,
                            background: "#e0f2fe",
                            color: "#0284c7",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <FileText size={20} />
                        </div>
                        <div>
                          <h4 style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                            {String(doc.name)}
                          </h4>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            {doc.type} &bull; {doc.pages} pages &bull; {doc.size} &bull; Uploaded {doc.uploaded}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`pw-pill-status ${doc.status === "VERIFIED" ? "active" : "pending"}`}>
                          <CheckCircle2 size={12} /> {doc.status === "VERIFIED" ? "Verified" : "Self-Reported"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenDocumentPreview()}
                          style={{
                            padding: "6px 14px",
                            borderRadius: 8,
                            background: "#0284c7",
                            color: "#ffffff",
                            fontSize: 12,
                            fontWeight: 650,
                            border: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <FileText size={13} />
                          <span>View Document</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 5: Related analysis */}
            {activeTab === "Related analysis" && (
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 750, color: "#0f172a" }}>
                  My Protection Assessment Integration
                </h3>
                <p style={{ margin: "0 0 20px", fontSize: 12.5, color: "#64748b" }}>
                  How this policy contributes to your coverage runway, visa compliance, and health safety.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                  <div style={{ padding: 18, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#16a34a", fontWeight: 750, fontSize: 14 }}>
                      <CheckCircle2 size={18} />
                      <span>Visa & Residence Compliance</span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#14532d", lineHeight: 1.5 }}>
                      This verified policy satisfies standard international student health insurance prerequisites for China residency permit verification.
                    </p>
                  </div>

                  <div style={{ padding: 18, background: "#fefce8", border: "1px solid #fef08a", borderRadius: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#b45309", fontWeight: 750, fontSize: 14 }}>
                      <AlertTriangle size={18} />
                      <span>Coverage Gap Identified</span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#78350f", lineHeight: 1.5 }}>
                      Dental treatment and pre-existing chronic care are subject to waiting periods or exclusions. Consider complementary top-up coverage.
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                  <Link
                    href="/coverage-needs"
                    className="pw-doc-btn"
                    style={{ background: "#0284c7", color: "#ffffff", borderColor: "#0284c7" }}
                  >
                    <span>Inspect Full Coverage Needs &rarr;</span>
                  </Link>
                  <Link href="/products/compare" className="pw-doc-btn">
                    <span>Compare Top-up Products</span>
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              background: "#ffffff",
              border: "1px dashed #cbd5e1",
              borderRadius: 20,
              padding: 48,
              textAlign: "center",
              color: "#64748b",
            }}
          >
            <ShieldAlert size={36} color="#94a3b8" style={{ margin: "0 auto 12px" }} />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>
              No policy selected
            </h3>
            <p style={{ fontSize: 13, margin: "0 0 18px" }}>
              Select a policy from the list on the left to inspect its benefits, exclusions, and verified documents.
            </p>
          </div>
        )}
      </div>
      )}

      {/* ---------------- Add Policy Manually Modal ---------------- */}
      <AddPolicyModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        onSubmit={handleAddManualPolicy}
      />

      {/* ---------------- Policy Document & Clause Preview Modal ---------------- */}
      {previewDocData && (
        <PolicyDocumentPreviewModal
          isOpen={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          documentId={previewDocData.documentId}
          documentName={previewDocData.documentName}
          documentType={previewDocData.documentType}
          fileUrl={previewDocData.fileUrl}
          policyNumber={previewDocData.policyNumber}
          insurer={previewDocData.insurer}
          planName={previewDocData.planName}
          policyholder={previewDocData.policyholder}
          coverageStart={previewDocData.coverageStart}
          coverageEnd={previewDocData.coverageEnd}
          benefits={previewDocData.benefits}
          exclusions={previewDocData.exclusions}
          pages={previewDocData.pages}
          authToken={token}
          initialPage={previewDocData.initialPage}
        />
      )}
    </div>
  );
}
