"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bed,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit2,
  FileText,
  Heart,
  HelpCircle,
  Pill,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";

type Document = components["schemas"]["AccountDocumentSummary"];

export default function AccountDocuments() {
  const { token } = useAuth();
  const [, setDocuments] = useState<Document[]>([]);
  const [activeTab, setActiveTab] = useState<"UPLOAD" | "MY_DOCS" | "REQUIRED">("UPLOAD");
  const [selectedDocId, setSelectedDocId] = useState<string>("1");
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states for extracted data
  const [docType, setDocType] = useState("Health Insurance Policy");
  const [provider, setProvider] = useState("AIA");
  const [policyNumber, setPolicyNumber] = useState("HP123456789");
  const [period, setPeriod] = useState("1 Aug 2024 - 31 Jul 2027");
  const [region, setRegion] = useState("Singapore");
  const [planType, setPlanType] = useState("Student Plan");

  const [benefits, setBenefits] = useState([
    { id: "1", type: "outpatient", name: "Outpatient Care", limit: "Up to SGD 1,000 per year" },
    { id: "2", type: "inpatient", name: "Inpatient Care", limit: "Up to SGD 100,000 per year" },
    { id: "3", type: "drugs", name: "Prescription Drugs", limit: "Up to SGD 500 per year" },
  ]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api.request("get", "/api/v1/account/documents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDocuments(list);
    } catch {
      // Ignore
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "health_policy");
      await api.request("post", "/api/v1/account/documents", {
        body,
        headers: { Authorization: `Bearer ${token}` },
      });
      await refresh();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  function handleRemoveBenefit(id: string) {
    setBenefits((prev) => prev.filter((b) => b.id !== id));
  }

  const queueDocuments = [
    {
      id: "1",
      filename: "Student Insurance Policy.pdf",
      uploadedAgo: "Uploaded 2 minutes ago",
      status: "Extraction complete",
      statusType: "success",
    },
    {
      id: "2",
      filename: "Visa Approval Letter.pdf",
      uploadedAgo: "Uploaded 1 hour ago",
      status: "Extracting... 70%",
      statusType: "processing",
    },
    {
      id: "3",
      filename: "Travel Insurance.jpg",
      uploadedAgo: "Uploaded 2 days ago",
      status: "Ready to review",
      statusType: "neutral",
    },
  ];

  return (
    <div className="figma-page-shell">
      {/* ---------------- Back Navigation ---------------- */}
      <Link href="/protection" className="figma-back-link">
        ← My Protection
      </Link>

      {/* ---------------- Header ---------------- */}
      <header className="figma-page-header">
        <div>
          <h1>Documents</h1>
          <p>Upload your insurance documents and let INSURRA extract the important information.</p>
        </div>
        <button type="button" className="figma-btn-outline" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <HelpCircle size={15} /> Need help?
        </button>
      </header>

      {/* ---------------- Tabs ---------------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        <button
          type="button"
          className={`figma-pill-btn ${activeTab === "UPLOAD" ? "active" : ""}`}
          onClick={() => setActiveTab("UPLOAD")}
        >
          <Upload size={14} style={{ display: "inline", marginRight: 6 }} /> Upload &amp; Extract
        </button>
        <button
          type="button"
          className={`figma-pill-btn ${activeTab === "MY_DOCS" ? "active" : ""}`}
          onClick={() => setActiveTab("MY_DOCS")}
        >
          <FileText size={14} style={{ display: "inline", marginRight: 6 }} /> My Documents
        </button>
        <button
          type="button"
          className={`figma-pill-btn ${activeTab === "REQUIRED" ? "active" : ""}`}
          onClick={() => setActiveTab("REQUIRED")}
        >
          <CheckCircle2 size={14} style={{ display: "inline", marginRight: 6 }} /> Required Documents
        </button>
      </div>

      {/* ---------------- Two Column Layout ---------------- */}
      <div className="figma-wallet-grid" style={{ gridTemplateColumns: "45% 55%" }}>
        {/* Left Column: Upload Dropzone & Uploaded List */}
        <div>
          {/* Drag & Drop Card */}
          <div
            className="figma-dropzone-box"
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ display: "none" }}
              accept=".pdf,.jpg,.jpeg,.png"
            />
            <div className="figma-dropzone-icon">
              <UploadCloud size={26} />
            </div>
            <strong style={{ fontSize: 16, fontWeight: 800, color: "#0f1d38" }}>
              {busy ? "Uploading document..." : "Drag and drop your documents here"}
            </strong>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {busy ? "Please wait while we process the file" : "or click to browse files"}
            </span>
            <small style={{ fontSize: 11.5, color: "#94a3b8" }}>
              We support PDF, JPG, PNG (max 10MB per file)
            </small>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span className="figma-tag" style={{ color: "#dc2626", fontWeight: 750 }}>
                PDF
              </span>
              <span className="figma-tag" style={{ color: "#16a34a", fontWeight: 750 }}>
                JPG
              </span>
              <span className="figma-tag" style={{ color: "#0284c7", fontWeight: 750 }}>
                PNG
              </span>
            </div>
          </div>

          {/* Uploaded Documents List */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f1d38", margin: 0 }}>
                Uploaded Documents ({queueDocuments.length})
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#64748b" }}>
                <span>Sort by:</span>
                <strong style={{ color: "#0f1d38" }}>Newest</strong>
                <ChevronDown size={14} />
              </div>
            </div>

            {queueDocuments.map((doc) => {
              const isSelected = doc.id === selectedDocId;
              return (
                <div
                  key={doc.id}
                  className="figma-doc-queue-item"
                  style={{
                    borderColor: isSelected ? "#0ea58a" : "#e2e8f0",
                    background: isSelected ? "#f9fefd" : "#ffffff",
                  }}
                  onClick={() => setSelectedDocId(doc.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 36, height: 42, background: "#f1f5f9", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <FileText size={20} color="#64748b" />
                    </div>
                    <div>
                      <strong style={{ display: "block", fontSize: 13.5, color: "#0f1d38" }}>
                        {doc.filename}
                      </strong>
                      <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{doc.uploadedAgo}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {doc.statusType === "success" && (
                      <span className="figma-hub-card-pill success" style={{ padding: "4px 10px", fontSize: 11 }}>
                        <CheckCircle2 size={12} /> {doc.status}
                      </span>
                    )}
                    {doc.statusType === "processing" && (
                      <span className="figma-hub-card-pill neutral" style={{ padding: "4px 10px", fontSize: 11, background: "#e0f2fe", color: "#0284c7" }}>
                        <RefreshCw size={12} className="spin-slow" /> {doc.status}
                      </span>
                    )}
                    {doc.statusType === "neutral" && (
                      <span className="figma-hub-card-pill neutral" style={{ padding: "4px 10px", fontSize: 11 }}>
                        <Check size={12} /> {doc.status}
                      </span>
                    )}
                    <ChevronRight size={16} color="#94a3b8" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: AI Extraction Review Panel */}
        <div className="figma-policy-detail">
          {/* AI Banner */}
          <div className="figma-alert-banner">
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#0ea58a", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles size={16} />
            </div>
            <div>
              <strong style={{ display: "block", fontSize: 13.5, color: "#065f46" }}>AI extraction complete</strong>
              <span style={{ fontSize: 12, color: "#047857" }}>
                We&apos;ve extracted the key information below. Please review and edit if needed.
              </span>
            </div>
          </div>

          {/* Document Header Tile */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "#f8fafc", borderRadius: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 34, height: 42, background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FileText size={18} color="#0284c7" />
              </div>
              <div>
                <strong style={{ display: "block", fontSize: 14, color: "#0f1d38" }}>
                  Student Insurance Policy.pdf
                </strong>
                <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Uploaded 2 minutes ago</span>
              </div>
            </div>
            <button
              type="button"
              style={{ background: "none", border: "none", color: "#0ea58a", fontSize: 12.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
            >
              View file
            </button>
          </div>

          {/* Extracted Information Form */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f1d38", margin: 0 }}>
                Extracted Information
              </h3>
              <button
                type="button"
                className="figma-btn-outline"
                style={{ padding: "4px 10px", fontSize: 12, height: 30 }}
                onClick={() => setIsEditing(!isEditing)}
              >
                <Edit2 size={12} /> {isEditing ? "Done" : "Edit all"}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="figma-extract-field">
                <label>Document type</label>
                <select
                  className="figma-extract-input"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  disabled={!isEditing}
                >
                  <option>Health Insurance Policy</option>
                  <option>Visa Grant Notice</option>
                  <option>Travel Policy</option>
                </select>
              </div>

              <div className="figma-extract-field">
                <label>Provider</label>
                <select
                  className="figma-extract-input"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  disabled={!isEditing}
                >
                  <option>AIA</option>
                  <option>AXA</option>
                  <option>Allianz</option>
                  <option>Medibank</option>
                  <option>BPJS Kesehatan</option>
                </select>
              </div>

              <div className="figma-extract-field">
                <label>Policy number</label>
                <input
                  type="text"
                  className="figma-extract-input"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                  disabled={!isEditing}
                />
              </div>

              <div className="figma-extract-field">
                <label>Coverage period</label>
                <input
                  type="text"
                  className="figma-extract-input"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  disabled={!isEditing}
                />
              </div>

              <div className="figma-extract-field">
                <label>Coverage region</label>
                <select
                  className="figma-extract-input"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  disabled={!isEditing}
                >
                  <option>Singapore</option>
                  <option>Australia</option>
                  <option>Indonesia</option>
                </select>
              </div>

              <div className="figma-extract-field">
                <label>Plan type</label>
                <select
                  className="figma-extract-input"
                  value={planType}
                  onChange={(e) => setPlanType(e.target.value)}
                  disabled={!isEditing}
                >
                  <option>Student Plan</option>
                  <option>Standard Comprehensive</option>
                  <option>Corporate Health</option>
                </select>
              </div>
            </div>
          </div>

          {/* Key Benefits (Extracted) */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f1d38", margin: 0 }}>
                Key Benefits (Extracted)
              </h3>
              <button
                type="button"
                className="figma-btn-outline"
                style={{ padding: "4px 10px", fontSize: 12, height: 30 }}
                onClick={() => setBenefits((prev) => [...prev, { id: String(Date.now()), type: "dental", name: "Dental & Vision", limit: "Up to SGD 300 per year" }])}
              >
                <Plus size={12} /> Add benefit
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {benefits.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "#f8fafc",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        background: b.type === "outpatient" ? "#fee2e2" : b.type === "inpatient" ? "#e0f2fe" : "#f3e8ff",
                        color: b.type === "outpatient" ? "#dc2626" : b.type === "inpatient" ? "#0284c7" : "#7e22ce",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {b.type === "outpatient" ? <Heart size={13} /> : b.type === "inpatient" ? <Bed size={13} /> : <Pill size={13} />}
                    </div>
                    <strong style={{ fontSize: 13, color: "#0f1d38" }}>{b.name}</strong>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12.5, color: "#475569" }}>{b.limit}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveBenefit(b.id)}
                      style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 2 }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 12 }}>
            <Link href="/protection" className="figma-btn-outline" style={{ height: 42 }}>
              Save &amp; Close
            </Link>
            <Link
              href="/completeness"
              className="figma-btn-primary"
              style={{ height: 42 }}
            >
              Confirm Information <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
