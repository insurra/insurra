"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  Check,
  ChevronRight,
  CircleHelp,
  FileCheck,
  FileText,
  Info,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { useUserContext } from "@/lib/user-context";

type Setup = components["schemas"]["AccountSetup"];
type Result = components["schemas"]["AccountCompleteness"];

interface MockChecklistItem {
  id: string;
  name: string;
  description: string;
  status: "uploaded" | "required" | "optional";
  tagColor: "green" | "orange" | "gray";
}

export default function AccountCompleteness() {
  const { token } = useAuth();
  const userCtx = useUserContext();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [task, setTask] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [activeTab, setActiveTab] = useState<"visa" | "dates">("visa");

  const countryName = userCtx.residenceCountry || "China";
  const countryFlag = userCtx.countryFlag || "🇨🇳";
  const userSegment = userCtx.userSegment || "student";

  // Dynamic context checklist
  const dynamicChecklist: MockChecklistItem[] = userCtx.countryCode === "CN"
    ? [
        {
          id: "student-cert",
          name: "Student Insurance Certificate",
          description: "Ping An Annuity or campus certificate confirming scheme enrollment.",
          status: "required",
          tagColor: "orange",
        },
        {
          id: "policy-terms",
          name: "Policy Terms & Benefit Booklet",
          description: "Terms showing public secondary & tertiary hospital network and deductibles.",
          status: "required",
          tagColor: "orange",
        },
        {
          id: "admission-notice",
          name: "University Admission / Study Verification",
          description: "JW202 / JW201 form or enrollment letter from university in Shenzhen.",
          status: "optional",
          tagColor: "gray",
        },
        {
          id: "residence-permit",
          name: "Passport & Foreigner Residence Permit",
          description: "Identity and legal study stay duration issued by Exit-Entry Administration.",
          status: "optional",
          tagColor: "gray",
        },
      ]
    : userCtx.countryCode === "ID"
    ? [
        {
          id: "bpjs-card",
          name: "BPJS Kesehatan Digital Card",
          description: "Mobile JKN card screenshot or physical membership certificate.",
          status: "required",
          tagColor: "orange",
        },
        {
          id: "private-policy",
          name: "Private Health Policy Booklet",
          description: "Table of benefits for hospitalization and coordination of benefit (CoB).",
          status: "optional",
          tagColor: "gray",
        },
        {
          id: "employer-schedule",
          name: "Corporate Benefit Handbook",
          description: "Employee health benefits schedule and network clinic list.",
          status: "optional",
          tagColor: "gray",
        },
      ]
    : [
        {
          id: "oshc-cert",
          name: "OSHC Policy Certificate",
          description: "Policy document showing Condition 8501 student visa health coverage.",
          status: "required",
          tagColor: "orange",
        },
        {
          id: "visa-grant",
          name: "Visa Grant Notice",
          description: "Official letter from Australian Department of Home Affairs.",
          status: "required",
          tagColor: "orange",
        },
        {
          id: "enrollment",
          name: "Confirmation of Enrolment (CoE)",
          description: "Official CoE from your registered educational provider.",
          status: "optional",
          tagColor: "gray",
        },
      ];

  useEffect(() => {
    if (!token) return;
    let active = true;
    const headers = { Authorization: `Bearer ${token}` };
    api
      .request("get", "/api/v1/account/profile", { headers })
      .then((profile) => {
        if (!profile.profile) return null;
        return api.request("get", "/api/v1/account/setup/{country_code}", {
          params: { country_code: profile.profile.country_code },
          headers,
        });
      })
      .then((value) => {
        if (active && value) {
          setSetup(value);
          setTask(String(value.tasks[0]?.task_code ?? ""));
        }
      })
      .catch(() => {
        // Fall back gracefully to pristine Figma visual state
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !task) return;
    let active = true;
    api
      .request("get", "/api/v1/account/completeness", {
        query: { task },
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        // Keep mock/default view
      });
    return () => {
      active = false;
    };
  }, [token, task]);

  const pct = result?.ready_pct ?? 75;
  const readyCount = result?.ready_count ?? 3;
  const totalCount = result?.total_count ?? 4;

  // Circular gauge SVG parameters
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div style={{ padding: "8px 4px 60px 4px", maxWidth: "1240px", margin: "0 auto" }}>
      {/* Screen Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: "24px",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#0f1d38",
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Data Completeness
          </h1>
          <p style={{ fontSize: "14px", color: "#64748b", margin: "6px 0 0 0" }}>
            Here&apos;s what you need for a complete and up to date protection.
          </p>
        </div>

        <button
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 16px",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "9999px",
            fontSize: "13px",
            fontWeight: 500,
            color: "#0f1d38",
            cursor: "pointer",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
          onClick={() => alert("INSURRA Data Completeness tracks required policy documents and dates for your destination.")}
        >
          <CircleHelp size={16} color="#64748b" />
          Need help?
        </button>
      </div>

      {/* Task Context Picker if available */}
      {setup && setup.tasks.length > 1 && (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "10px 16px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f1d38" }}>
            Evaluation Context:
          </span>
          <select
            value={task}
            onChange={(e) => setTask(e.target.value)}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              fontSize: "13px",
              color: "#0f1d38",
            }}
          >
            {setup.tasks.map((t) => (
              <option key={String(t.task_code)} value={String(t.task_code)}>
                {String(t.label)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Top Grid: Circular Gauge + Timeline */}
      <div className="figma-completeness-top-grid">
        {/* Left: 75% Complete Circular Gauge */}
        <div className="figma-circular-gauge-card">
          <div className="figma-ring-container">
            <svg width="110" height="110" viewBox="0 0 110 110">
              <circle
                cx="55"
                cy="55"
                r={radius}
                fill="transparent"
                stroke="#e2e8f0"
                strokeWidth="8"
              />
              <circle
                cx="55"
                cy="55"
                r={radius}
                fill="transparent"
                stroke="#00b074"
                strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 55 55)"
              />
            </svg>
            <div className="figma-ring-center">
              <span className="figma-ring-pct">{pct}%</span>
              <span className="figma-ring-label">Complete</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#0f1d38", margin: 0 }}>
              Almost complete!
            </h2>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              You&apos;ve uploaded {readyCount} of {totalCount} required documents.
            </p>
            <div style={{ marginTop: "8px" }}>
              <Link
                href="/documents"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "9px 18px",
                  background: "#00875a",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  borderRadius: "9999px",
                  textDecoration: "none",
                  transition: "background 0.15s ease",
                }}
              >
                Upload missing documents
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>

        {/* Right: Visa validity & Insurance coverage timeline */}
        <div className="figma-timeline-card">
          <div className="figma-timeline-tabs">
            <button
              type="button"
              className={`figma-timeline-tab ${activeTab === "visa" ? "active" : ""}`}
              onClick={() => setActiveTab("visa")}
            >
              Visa &amp; Coverage
            </button>
            <button
              type="button"
              className={`figma-timeline-tab ${activeTab === "dates" ? "active" : ""}`}
              onClick={() => setActiveTab("dates")}
            >
              Key Dates
            </button>
          </div>

          {/* Visa validity item */}
          <div className="figma-timeline-item">
            <div className="figma-timeline-item-header">
              <div className="figma-timeline-item-title">
                <div className="figma-timeline-icon-wrap">
                  <ShieldCheck size={14} />
                </div>
                <span>Visa validity</span>
              </div>
              <div className="figma-timeline-meta">
                <span>1 Aug 2024 &ndash; 31 Jul 2027</span>
                <Calendar size={13} color="#94a3b8" />
              </div>
            </div>
            <div className="figma-progress-track">
              <div className="figma-progress-fill-teal" style={{ width: "100%" }} />
            </div>
          </div>

          {/* Insurance coverage item */}
          <div className="figma-timeline-item">
            <div className="figma-timeline-item-header">
              <div className="figma-timeline-item-title">
                <div className="figma-timeline-icon-wrap">
                  <ShieldCheck size={14} />
                </div>
                <span>Insurance coverage</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#dc2626",
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "6px",
                  }}
                >
                  <AlertTriangle size={11} />
                  31 days gap
                </span>
              </div>
            </div>
            <div className="figma-progress-track">
              <div className="figma-progress-fill-amber" style={{ width: "82%" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <span style={{ fontSize: "11px", color: "#64748b" }}>
                1 Aug 2024 &ndash; 30 Jun 2027
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Required Documents + Side Guidance */}
      <div className="figma-completeness-main-grid">
        {/* Left Column: Required Documents */}
        <div className="figma-checklist-card">
          <div className="figma-checklist-header">
            <div className="figma-checklist-header-title">
              <span>Required Documents for {countryName} ({userSegment})</span>
              <Info size={15} color="#94a3b8" />
            </div>
            <Link
              href="/documents"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#00875a",
                textDecoration: "none",
              }}
            >
              View guidelines
            </Link>
          </div>

          {/* Checklist Items */}
          <div>
            {dynamicChecklist.map((doc) => {
              const isUploaded = doc.status === "uploaded";
              const isRequired = doc.status === "required";

              return (
                <div key={doc.id} className="figma-checklist-item">
                  <div className="figma-checklist-item-left">
                    <div
                      className={`figma-checklist-doc-icon ${
                        isUploaded ? "green" : isRequired ? "orange" : "gray"
                      }`}
                    >
                      <FileText size={16} />
                    </div>

                    <div className="figma-checklist-status-icon">
                      {isUploaded && (
                        <div
                          style={{
                            width: "18px",
                            height: "18px",
                            borderRadius: "9999px",
                            background: "#00b074",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Check size={11} strokeWidth={3} />
                        </div>
                      )}
                      {isRequired && (
                        <div
                          style={{
                            width: "18px",
                            height: "18px",
                            borderRadius: "9999px",
                            background: "#f59e0b",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "11px",
                            fontWeight: 800,
                          }}
                        >
                          !
                        </div>
                      )}
                      {!isUploaded && !isRequired && (
                        <div
                          style={{
                            width: "16px",
                            height: "16px",
                            borderRadius: "9999px",
                            border: "1.5px dashed #94a3b8",
                          }}
                        />
                      )}
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "#0f1d38",
                          marginBottom: "2px",
                        }}
                      >
                        {doc.name}
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>
                        {doc.description}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: "9999px",
                        fontSize: "11px",
                        fontWeight: 600,
                        background: isUploaded
                          ? "#ecfdf5"
                          : isRequired
                          ? "#fef3c7"
                          : "#f1f5f9",
                        color: isUploaded
                          ? "#00875a"
                          : isRequired
                          ? "#d97706"
                          : "#64748b",
                        border: isUploaded
                          ? "1px solid #a7f3d0"
                          : isRequired
                          ? "1px solid #fde68a"
                          : "1px solid #e2e8f0",
                        textTransform: "capitalize",
                      }}
                    >
                      {doc.status}
                    </span>
                    <ChevronRight size={15} color="#94a3b8" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Country Guidance, Missing Information, Ask INSURRA */}
        <div className="figma-completeness-side">
          {/* Card 1: Country Guidance */}
          <div className="figma-guidance-card">
            <div className="figma-guidance-head">
              <div className="figma-guidance-title">
                <BookOpen size={17} color="#00875a" />
                <span>Country Guidance</span>
              </div>
              <ChevronRight size={16} color="#94a3b8" />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "24px", lineHeight: 1 }}>{countryFlag}</span>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f1d38" }}>
                    {countryName}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", textTransform: "capitalize" }}>
                    {userSegment}
                  </div>
                </div>
              </div>
              <Link
                href="/guidelines"
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#00875a",
                  textDecoration: "none",
                }}
              >
                View all
              </Link>
            </div>

            <ul
              style={{
                margin: 0,
                paddingLeft: "18px",
                fontSize: "12px",
                color: "#475569",
                lineHeight: "1.7",
              }}
            >
              {userCtx.countryCode === "CN" ? (
                <>
                  <li>Comprehensive Medical Insurance Scheme for Foreigners required for study stays &gt; 6 months</li>
                  <li>Inpatient hospitalization, accidental medical, and emergency treatment covered</li>
                  <li>Designated public secondary &amp; tertiary hospitals (二级及以上公立医院) standard wards</li>
                  <li>Official medical receipt (Fapiao) and clinical record required for claims</li>
                </>
              ) : userCtx.countryCode === "ID" ? (
                <>
                  <li>BPJS Kesehatan (JKN) covers primary (FKTP) and referral (FKRTL) medical care</li>
                  <li>Private health policies coordinate benefits (CoB) for private hospital admission</li>
                  <li>Surat rujukan berjenjang required for non-emergency specialist consultations</li>
                </>
              ) : (
                <>
                  <li>Overseas Student Health Cover (OSHC) required under Visa Condition 8501</li>
                  <li>Medicare Benefits Schedule (MBS) coverage and emergency ambulance support</li>
                  <li>Continuous coverage required from departure until visa expiry</li>
                </>
              )}
            </ul>
          </div>

          {/* Card 2: Missing Information */}
          <div className="figma-missing-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "9999px",
                    background: "#ef4444",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <AlertCircle size={13} />
                </div>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#0f1d38" }}>
                  Missing Information
                </span>
              </div>
              <span
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "9999px",
                  background: "#fef2f2",
                  color: "#dc2626",
                  fontSize: "11px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #fee2e2",
                }}
              >
                1
              </span>
            </div>

            <div className="figma-missing-inner">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    background: "#ffffff",
                    color: "#dc2626",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid #fee2e2",
                  }}
                >
                  <FileCheck size={16} />
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f1d38" }}>
                    Passport (Identity Page)
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    Please upload a valid passport to complete your profile.
                  </div>
                </div>
              </div>

              <Link
                href="/documents"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 14px",
                  background: "#ffffff",
                  border: "1px solid #fca5a5",
                  borderRadius: "9999px",
                  color: "#dc2626",
                  fontSize: "12px",
                  fontWeight: 700,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                Upload now
              </Link>
            </div>
          </div>

          {/* Card 3: Ask INSURRA guidance card */}
          <Link
            href="/ask"
            className="figma-ask-card"
            style={{ textDecoration: "none" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  background: "#ecfdf5",
                  color: "#00875a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Sparkles size={18} />
              </div>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f1d38" }}>
                  Not sure what to upload?
                </div>
                <div style={{ fontSize: "11px", color: "#64748b" }}>
                  Ask INSURRA and get country specific guidance.
                </div>
              </div>
            </div>
            <ChevronRight size={17} color="#00875a" />
          </Link>
        </div>
      </div>
    </div>
  );
}
