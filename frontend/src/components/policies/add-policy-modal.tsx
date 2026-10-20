"use client";

import React, { useState } from "react";
import {
  Check,
  Info,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { getInsurerBrand } from "@/lib/insurer-logos";

export interface NewPolicyData {
  provider: string;
  plan_name: string;
  policy_number?: string;
  policy_type: string;
  start_date: string;
  end_date: string;
  status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NOT_YET_ACTIVE" | "UNKNOWN";
  coverage_limit: string;
  deductible: string;
  currency: string;
  benefits: { name: string; limit: string }[];
  exclusions: string[];
}

interface AddPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: NewPolicyData) => Promise<void> | void;
}

const INSURER_OPTIONS = [
  "AIA",
  "Chubb",
  "BPJS Kesehatan",
  "Tencent",
  "Allianz",
  "Ping An",
  "Prudential",
  "Manulife",
  "China Life",
  "PICC",
  "Other",
];

const POLICY_TYPES = [
  { value: "student_insurance", label: "Student insurance" },
  { value: "travel_insurance", label: "Travel insurance" },
  { value: "public_health_insurance", label: "Public health insurance" },
  { value: "employer_insurance", label: "Employer insurance" },
  { value: "health_insurance", label: "Medical / Health insurance" },
  { value: "other", label: "Other plan" },
];

export function AddPolicyModal({ isOpen, onClose, onSubmit }: AddPolicyModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [provider, setProvider] = useState("AIA");
  const [customProvider, setCustomProvider] = useState("");
  const [planName, setPlanName] = useState("AIA International Student Plan");
  const [policyNumber, setPolicyNumber] = useState("AIA-STU-2024-568923");
  const [policyType, setPolicyType] = useState("student_insurance");

  const [benefits, setBenefits] = useState<{ name: string; limit: string }[]>([
    { name: "Inpatient treatment", limit: "RMB 1,000,000" },
    { name: "Outpatient treatment", limit: "RMB 200,000" },
    { name: "Emergency evacuation", limit: "RMB 500,000" },
    { name: "Dental treatment", limit: "RMB 10,000" },
  ]);

  const [exclusions, setExclusions] = useState<string[]>([
    "Pre-existing conditions (12 months)",
    "Cosmetic or aesthetic treatment",
    "Dental treatment except emergency",
  ]);
  const [newExclusion, setNewExclusion] = useState("");

  const [startDate, setStartDate] = useState("2024-09-01");
  const [endDate, setEndDate] = useState("2025-08-31");
  const [status, setStatus] = useState<"ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NOT_YET_ACTIVE" | "UNKNOWN">("ACTIVE");

  if (!isOpen) return null;

  const actualProvider = provider === "Other" ? customProvider || "Other" : provider;
  const brand = getInsurerBrand(actualProvider, planName, policyType);

  const handleAddBenefit = () => {
    setBenefits([...benefits, { name: "", limit: "" }]);
  };

  const handleBenefitChange = (index: number, field: "name" | "limit", value: string) => {
    const updated = [...benefits];
    updated[index][field] = value;
    setBenefits(updated);
  };

  const handleRemoveBenefit = (index: number) => {
    setBenefits(benefits.filter((_, i) => i !== index));
  };

  const handleAddExclusion = () => {
    if (newExclusion.trim()) {
      setExclusions([...exclusions, newExclusion.trim()]);
      setNewExclusion("");
    }
  };

  const handleRemoveExclusion = (index: number) => {
    setExclusions(exclusions.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        provider: actualProvider,
        plan_name: planName,
        policy_number: policyNumber || undefined,
        policy_type: policyType,
        start_date: startDate,
        end_date: endDate,
        status,
        coverage_limit: benefits[0]?.limit || "RMB 1,000,000",
        deductible: "RMB 0",
        currency: "RMB",
        benefits: benefits.filter((b) => b.name.trim() && b.limit.trim()),
        exclusions,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pw-modal-overlay" onClick={onClose}>
      <div className="pw-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pw-modal-header">
          <div>
            <h2 className="pw-modal-title">Add Policy Manually</h2>
            <p className="pw-modal-sub">
              Enter your policy details. You can add basic information now and update later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b" }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Stepper */}
        <div className="pw-stepper-row">
          {[
            { num: 1, label: "Basic information" },
            { num: 2, label: "Coverage details" },
            { num: 3, label: "Dates & status" },
            { num: 4, label: "Review & confirm" },
          ].map((s) => {
            const isCompleted = step > s.num;
            const isActive = step === s.num;
            return (
              <div key={s.num} className="pw-stepper-item">
                <div
                  className={`pw-stepper-circle ${
                    isCompleted ? "completed" : isActive ? "active" : ""
                  }`}
                >
                  {isCompleted ? <Check size={14} /> : s.num}
                </div>
                <span className={`pw-stepper-label ${isActive ? "active" : ""}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step 1: Basic Information */}
        {step === 1 && (
          <div>
            <div className="pw-form-group">
              <label className="pw-form-label">Insurance company *</label>
              <select
                className="pw-form-select"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {INSURER_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {provider === "Other" && (
              <div className="pw-form-group">
                <label className="pw-form-label">Company name *</label>
                <input
                  type="text"
                  className="pw-form-input"
                  placeholder="e.g. FWD Insurance"
                  value={customProvider}
                  onChange={(e) => setCustomProvider(e.target.value)}
                />
              </div>
            )}

            <div className="pw-form-group">
              <label className="pw-form-label">Plan name *</label>
              <input
                type="text"
                className="pw-form-input"
                placeholder="e.g. Comprehensive Plan (Standard)"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
              />
            </div>

            <div className="pw-form-group">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="pw-form-label">Policy number</label>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Optional</span>
              </div>
              <input
                type="text"
                className="pw-form-input"
                placeholder="e.g. AIA-STU-2024-568923"
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
              />
            </div>

            <div className="pw-form-group">
              <label className="pw-form-label">Policy type *</label>
              <select
                className="pw-form-select"
                value={policyType}
                onChange={(e) => setPolicyType(e.target.value)}
              >
                {POLICY_TYPES.map((pt) => (
                  <option key={pt.value} value={pt.value}>
                    {pt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="pw-modal-footer">
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "9px 18px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!actualProvider || !planName}
                style={{
                  padding: "9px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: "#0284c7",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Next &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Coverage Details */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 750, color: "#0f172a" }}>
                  Coverage & benefits
                </h4>
                <button
                  type="button"
                  onClick={handleAddBenefit}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 650,
                    color: "#0284c7",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <Plus size={14} /> Add item
                </button>
              </div>
              <p style={{ margin: "2px 0 12px", fontSize: 12, color: "#64748b" }}>
                Enter the key benefits and limits of your policy.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {benefits.map((b, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="text"
                      className="pw-form-input"
                      placeholder="Benefit name (e.g. Inpatient treatment)"
                      value={b.name}
                      onChange={(e) => handleBenefitChange(idx, "name", e.target.value)}
                      style={{ flex: 1.5 }}
                    />
                    <input
                      type="text"
                      className="pw-form-input"
                      placeholder="Limit (e.g. RMB 1,000,000)"
                      value={b.limit}
                      onChange={(e) => handleBenefitChange(idx, "limit", e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveBenefit(idx)}
                      style={{
                        padding: 8,
                        background: "transparent",
                        border: "none",
                        color: "#ef4444",
                        cursor: "pointer",
                      }}
                      title="Delete benefit"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <h4 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 750, color: "#0f172a" }}>
                Exclusions (optional)
              </h4>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  type="text"
                  className="pw-form-input"
                  placeholder="e.g. Cosmetic or aesthetic treatment"
                  value={newExclusion}
                  onChange={(e) => setNewExclusion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddExclusion())}
                />
                <button
                  type="button"
                  onClick={handleAddExclusion}
                  style={{
                    padding: "8px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: 10,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Add
                </button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {exclusions.map((exc, idx) => (
                  <span
                    key={idx}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      background: "#fee2e2",
                      color: "#991b1b",
                      borderRadius: 8,
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    {exc}
                    <X
                      size={13}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleRemoveExclusion(idx)}
                    />
                  </span>
                ))}
              </div>
            </div>

            <div className="pw-modal-footer">
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  padding: "9px 18px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                &larr; Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                style={{
                  padding: "9px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: "#0284c7",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Next &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Dates & Status */}
        {step === 3 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 750, color: "#0f172a" }}>
                Dates & status
              </h4>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: "#64748b" }}>
                Provide important dates and current status.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
                <div>
                  <label className="pw-form-label">Policy start date *</label>
                  <input
                    type="date"
                    className="pw-form-input"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="pw-form-label">Policy end date *</label>
                  <input
                    type="date"
                    className="pw-form-input"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="pw-form-group">
                <label className="pw-form-label">Current status *</label>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 6 }}>
                  {[
                    { val: "ACTIVE", label: "Active" },
                    { val: "EXPIRED", label: "Expired" },
                    { val: "NOT_YET_ACTIVE", label: "Not yet active" },
                    { val: "UNKNOWN", label: "Unknown" },
                  ].map((s) => (
                    <label
                      key={s.val}
                      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}
                    >
                      <input
                        type="radio"
                        name="current_status"
                        checked={status === s.val}
                        onChange={() => setStatus(s.val as typeof status)}
                      />
                      <span>{s.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Unverified info box */}
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 12,
                  padding: 14,
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  marginTop: 18,
                }}
              >
                <Info size={18} color="#2563eb" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ display: "block", fontSize: 13, color: "#1e40af", marginBottom: 2 }}>
                    This policy will be added as unverified
                  </strong>
                  <p style={{ margin: 0, fontSize: 12, color: "#1e3a8a", lineHeight: 1.45 }}>
                    Since this information is entered manually, it will be marked as Unverified until verified with documents.
                  </p>
                </div>
              </div>
            </div>

            <div className="pw-modal-footer">
              <button
                type="button"
                onClick={() => setStep(2)}
                style={{
                  padding: "9px 18px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                &larr; Back
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                style={{
                  padding: "9px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: "#0284c7",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Next &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Review & Confirm */}
        {step === 4 && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 750, color: "#0f172a" }}>
                Review & confirm
              </h4>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: "#64748b" }}>
                Please check the information before adding this policy.
              </p>

              {/* Preview Card matching Figma Image 2 */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 18,
                  boxShadow: "0 4px 14px rgba(0,0,0,0.03)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div className="pw-brand-logo-box">
                      {(brand.markUrl || brand.logoUrl) ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={brand.markUrl || brand.logoUrl} alt={brand.name} className="pw-brand-logo-img" />
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
                    <div>
                      <h3 style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 750, color: "#0f172a" }}>
                        {planName}
                      </h3>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span className="pw-pill-category">
                          {POLICY_TYPES.find((pt) => pt.value === policyType)?.label || policyType}
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "#fef3c7",
                            color: "#b45309",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Info size={11} /> Unverified
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 4 }}>
                        Policy No. {policyNumber || "Not provided"}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 650,
                      color: "#0284c7",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <Pencil size={13} /> Edit
                  </button>
                </div>

                <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
                  <div style={{ display: "flex" }}>
                    <span style={{ width: 140, color: "#64748b" }}>Coverage period:</span>
                    <strong style={{ color: "#0f172a" }}>
                      {startDate} &ndash; {endDate}
                    </strong>
                  </div>

                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <span style={{ width: 140, color: "#64748b", flexShrink: 0 }}>Coverage highlights:</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {benefits.map((b, idx) => (
                        <span key={idx} style={{ color: "#334155" }}>
                          &bull; {b.name}: <strong>{b.limit}</strong>
                        </span>
                      ))}
                    </div>
                  </div>

                  {exclusions.length > 0 && (
                    <div style={{ display: "flex", alignItems: "flex-start" }}>
                      <span style={{ width: 140, color: "#64748b", flexShrink: 0 }}>Exclusions:</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {exclusions.map((exc, idx) => (
                          <span key={idx} style={{ color: "#b91c1c" }}>
                            &bull; {exc}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="pw-modal-footer">
              <button
                type="button"
                onClick={() => setStep(3)}
                style={{
                  padding: "9px 18px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                &larr; Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: "9px 22px",
                  borderRadius: 10,
                  border: "none",
                  background: "#0284c7",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(2, 132, 199, 0.25)",
                }}
              >
                {submitting ? "Adding policy..." : "Add to Policy Wallet"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
