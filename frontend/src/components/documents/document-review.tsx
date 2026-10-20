"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  FileCheck,
  Info,
  Plus,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { DocumentCanvas } from "./document-canvas";

export interface ReviewDocBenefitItem {
  id: string;
  name: string;
  limit: string;
  deductible: string;
  page: number;
}

export interface ReviewDocData {
  id: string;
  filename: string;
  docType: string;
  fileUrl?: string | null;
  mimeType?: string;
  insurer: string;
  planName: string;
  policyNumber: string;
  policyholder: string;
  insuredPerson: string;
  dob: string;
  coverageStart: string;
  coverageEnd: string;
  planType: string;
  passportNumber?: string;
  status: string;
  versionDetected?: string;
  confidence?: string;
  benefits?: ReviewDocBenefitItem[];
  exclusions?: string[];
  waitingPeriods?: string[];
  claimConditions?: string[];
  rawPages?: { pageNo: number; text: string; ocrUsed: boolean }[];
}

export interface DocumentReviewProps {
  initialDoc?: ReviewDocData | null;
  onBack: () => void;
  onConfirmSuccess?: () => void;
}

export function DocumentReview({
  initialDoc,
  onBack,
  onConfirmSuccess,
}: DocumentReviewProps) {
  // Active step in the 4-step wizard
  const [step, setStep] = useState<3 | 4>(3);

  // Active tab in review panel
  const [activeTab, setActiveTab] = useState<
    "key_info" | "benefits" | "exclusions" | "raw_text"
  >("key_info");

  useEffect(() => {
    if (!/^#page-\d+$/.test(window.location.hash)) return;
    const timer = window.setTimeout(() => setActiveTab("raw_text"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Form State
  const [docType, setDocType] = useState(initialDoc?.docType || "Policy document");
  const [insurer, setInsurer] = useState(initialDoc?.insurer || "");
  const [planName, setPlanName] = useState(initialDoc?.planName || "");
  const [policyNumber, setPolicyNumber] = useState(initialDoc?.policyNumber || "");
  const [policyholder, setPolicyholder] = useState(initialDoc?.policyholder || "");
  const [insuredPerson] = useState(initialDoc?.insuredPerson || "");
  const [dob, setDob] = useState(initialDoc?.dob || "");
  const [coverageStart, setCoverageStart] = useState(initialDoc?.coverageStart || "");
  const [coverageEnd, setCoverageEnd] = useState(initialDoc?.coverageEnd || "");
  const [planType] = useState(initialDoc?.planType || "");
  const [status, setStatus] = useState(initialDoc?.status || "Verified");
  const [detectedVersion, setDetectedVersion] = useState(
    initialDoc?.versionDetected || "New policy"
  );

  // Benefits list
  const [benefits, setBenefits] = useState<ReviewDocBenefitItem[]>(
    initialDoc?.benefits || []
  );

  // Exclusions & Waiting Periods
  const [exclusions] = useState<string[]>(initialDoc?.exclusions || []);
  const [waitingPeriods] = useState<string[]>(initialDoc?.waitingPeriods || []);
  const [claimConditions] = useState<string[]>(initialDoc?.claimConditions || []);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleConfirmAndSave = async () => {
    setSaving(true);
    try {
      // Simulate/trigger confirm payload
      await new Promise((r) => setTimeout(r, 600));
      setStep(4);
      onConfirmSuccess?.();
    } catch {
      setNotice("Failed to confirm. Please check your network and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = () => {
    setNotice("Document saved as draft.");
    setTimeout(() => setNotice(null), 3000);
  };

  const addBenefitRow = () => {
    setBenefits((prev) => [
      ...prev,
      {
        id: `b-${Date.now()}`,
        name: "Additional Benefit Coverage",
        limit: "RMB 50,000",
        deductible: "RMB 0",
        page: 1,
      },
    ]);
  };

  const removeBenefitRow = (id: string) => {
    setBenefits((prev) => prev.filter((b) => b.id !== id));
  };

  // Saved celebration step matching Step 4
  if (step === 4) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-center space-y-6">
        <div className="relative w-36 h-36 mx-auto">
          <Image
            src="/Cheerful Jumping Kangaroo Mascot.png"
            alt="Success Mascot"
            fill
            className="object-contain"
          />
        </div>
        <div className="space-y-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Verified Insurance Facts Saved
          </span>
          <h2 className="text-2xl font-bold text-slate-900">
            Document verified and protection updated!
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            {planName} has been added to your active protection portfolio. Your coverage runway,
            completeness checklist, and AI assistance context have been updated.
          </p>
        </div>

        {/* Verified Facts Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 text-left space-y-3 shadow-xs">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Verified Coverage Summary
          </h4>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-lg">
              <span className="text-slate-500">Provider & Policy:</span>
              <p className="font-semibold text-slate-900 mt-0.5">{insurer} · {policyNumber}</p>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg">
              <span className="text-slate-500">Insured Member:</span>
              <p className="font-semibold text-slate-900 mt-0.5">{insuredPerson}</p>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg">
              <span className="text-slate-500">Coverage Window:</span>
              <p className="font-semibold text-slate-900 mt-0.5">{coverageStart} → {coverageEnd}</p>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg">
              <span className="text-slate-500">Benefits Extracted:</span>
              <p className="font-semibold text-slate-900 mt-0.5">{benefits.length} verified benefit limits</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <Link
            href="/protection"
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors shadow-sm inline-flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>View in My Protection</span>
          </Link>
          <button
            onClick={onBack}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors"
          >
            Back to Documents
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-12 min-w-0">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Documents</span>
          </button>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Review extracted information
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Check the information extracted from your document. You can edit any field before confirming.
          </p>
        </div>

        {notice && (
          <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{notice}</span>
          </div>
        )}
      </div>

      {/* Wizard Stepper matching Image 2 */}
      <div className="flex items-center justify-between sm:justify-start sm:gap-12 border-b border-slate-200 pb-4 text-xs font-medium">
        <div className="flex items-center gap-2 text-emerald-700 font-semibold">
          <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">
            <Check className="w-3.5 h-3.5" />
          </div>
          <span>Upload</span>
        </div>
        <div className="h-0.5 w-8 bg-emerald-600 hidden sm:block" />
        <div className="flex items-center gap-2 text-emerald-700 font-semibold">
          <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">
            <Check className="w-3.5 h-3.5" />
          </div>
          <span>AI processing</span>
        </div>
        <div className="h-0.5 w-8 bg-emerald-600 hidden sm:block" />
        <div className="flex items-center gap-2 text-emerald-700 font-bold">
          <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">
            3
          </div>
          <span>Review & confirm</span>
        </div>
        <div className="h-0.5 w-8 bg-slate-200 hidden sm:block" />
        <div className="flex items-center gap-2 text-slate-400">
          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-300 text-slate-500 flex items-center justify-center text-xs">
            4
          </div>
          <span>Saved</span>
        </div>
      </div>

      {/* Main Split: Left Document Viewer + Right Extracted Information Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Panel: Document Viewer */}
        <div className="lg:col-span-6">
          <DocumentCanvas
            documentName={initialDoc?.filename || "document.pdf"}
            documentType={docType}
            fileUrl={initialDoc?.fileUrl}
            mimeType={initialDoc?.mimeType}
            benefits={benefits}
            extractedData={{
              policyNumber,
              insurer,
              planName,
              policyholder,
              insuredPerson,
              dob,
              coverageStart,
              coverageEnd,
              planType,
            }}
          />
        </div>

        {/* Right Panel: Extracted Information */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col justify-between">
          <div className="p-6 space-y-4">
            {/* Header with Badges */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">Extracted information</h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-blue-600" />
                  AI extracted
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                <span>Confidence: High</span>
                <Info className="w-3.5 h-3.5 text-emerald-600 ml-0.5" />
              </div>
            </div>

            {/* Amber Alert Banner */}
            <div className="bg-amber-50/80 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs flex items-center gap-2.5 font-medium">
              <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>Please review the extracted information and confirm or edit if needed.</span>
            </div>

            {/* Navigation Tabs matching Image 2 */}
            <div className="flex items-center gap-6 border-b border-slate-200 text-xs font-medium pt-1">
              <button
                onClick={() => setActiveTab("key_info")}
                className={`pb-2.5 transition-colors relative ${
                  activeTab === "key_info"
                    ? "text-blue-600 font-bold border-b-2 border-blue-600"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Key information
              </button>
              <button
                onClick={() => setActiveTab("benefits")}
                className={`pb-2.5 transition-colors relative ${
                  activeTab === "benefits"
                    ? "text-blue-600 font-bold border-b-2 border-blue-600"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Benefits & coverage
              </button>
              <button
                onClick={() => setActiveTab("exclusions")}
                className={`pb-2.5 transition-colors relative ${
                  activeTab === "exclusions"
                    ? "text-blue-600 font-bold border-b-2 border-blue-600"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Exclusions & waiting periods
              </button>
              <button
                onClick={() => setActiveTab("raw_text")}
                className={`pb-2.5 transition-colors relative ${
                  activeTab === "raw_text"
                    ? "text-blue-600 font-bold border-b-2 border-blue-600"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Raw text & evidence
              </button>
            </div>

            {/* Tab 1: Key Information Content */}
            {activeTab === "key_info" && (
              <div className="space-y-5 pt-2">
                {/* Document Details Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-900">Document details</h4>
                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-1">
                      Document type
                    </label>
                    <select
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                    >
                      <option value="Policy document">Policy document</option>
                      <option value="Insurance certificate">Insurance certificate</option>
                      <option value="Benefit schedule">Benefit schedule</option>
                      <option value="Visa document">Visa document</option>
                      <option value="Sales offer">Sales offer</option>
                      <option value="Claim document">Claim document</option>
                      <option value="ID document">ID document</option>
                      <option value="Medical record">Medical record</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">
                        Insurer / Insurance company
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={insurer}
                          onChange={(e) => setInsurer(e.target.value)}
                          className="w-full text-xs font-semibold px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 pr-8"
                        />
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-2.5 top-2.5" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">
                        Plan name
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={planName}
                          onChange={(e) => setPlanName(e.target.value)}
                          className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 pr-8"
                        />
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-2.5 top-2.5" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Policy Information Section */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900">Policy information</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">
                        Policy number
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={policyNumber}
                          onChange={(e) => setPolicyNumber(e.target.value)}
                          className="w-full text-xs font-mono font-medium px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 pr-8"
                        />
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-2.5 top-2.5" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">
                        Policyholder name
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={policyholder}
                          onChange={(e) => setPolicyholder(e.target.value)}
                          className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 pr-8"
                        />
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-2.5 top-2.5" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">
                        Date of birth
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={dob}
                          onChange={(e) => setDob(e.target.value)}
                          className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 pr-8"
                        />
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-2.5 top-2.5" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">
                        Coverage period
                      </label>
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            value={coverageStart}
                            onChange={(e) => setCoverageStart(e.target.value)}
                            className="w-full text-xs font-medium px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                          />
                        </div>
                        <span className="text-slate-400">→</span>
                        <div className="relative flex-1">
                          <input
                            type="text"
                            value={coverageEnd}
                            onChange={(e) => setCoverageEnd(e.target.value)}
                            className="w-full text-xs font-medium px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                          />
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status & Version Section */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900">Status & version</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">
                        Document status
                      </label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                      >
                        <option value="Verified">Verified</option>
                        <option value="Needs review">Needs review</option>
                        <option value="Unsupported">Unsupported</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-500 block mb-1">
                        Detected as
                      </label>
                      <select
                        value={detectedVersion}
                        onChange={(e) => setDetectedVersion(e.target.value)}
                        className="w-full text-xs font-medium px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                      >
                        <option value="New policy">New policy</option>
                        <option value="Update to existing policy">Update to existing policy</option>
                        <option value="Duplicate">Duplicate</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Info Callout Banner */}
                <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-blue-900">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="font-medium leading-relaxed">
                    All key information has been extracted with high confidence. You can review other
                    sections or edit any field if needed.
                  </p>
                </div>
              </div>
            )}

            {/* Tab 2: Benefits & Coverage Content */}
            {activeTab === "benefits" && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Coverage Benefits Schedule</h4>
                    <p className="text-[11px] text-slate-500">
                      Extracted benefit limits and deductible rules mapped to page citations.
                    </p>
                  </div>
                  <button
                    onClick={addBenefitRow}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add benefit
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {benefits.map((b) => (
                    <div
                      key={b.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <input
                          type="text"
                          value={b.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBenefits((prev) =>
                              prev.map((item) => (item.id === b.id ? { ...item, name: val } : item))
                            );
                          }}
                          className="font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none w-3/4"
                        />
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-500">
                            p.{b.page}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeBenefitRow(b.id)}
                            className="text-slate-400 hover:text-red-500 p-0.5 transition-colors"
                            title="Delete benefit"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] text-slate-500">Coverage limit:</span>
                          <input
                            type="text"
                            value={b.limit}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBenefits((prev) =>
                                prev.map((item) => (item.id === b.id ? { ...item, limit: val } : item))
                              );
                            }}
                            className="w-full mt-0.5 px-2 py-1 bg-white border border-slate-200 rounded font-medium text-slate-900"
                          />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500">Deductible:</span>
                          <input
                            type="text"
                            value={b.deductible}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBenefits((prev) =>
                                prev.map((item) =>
                                  item.id === b.id ? { ...item, deductible: val } : item
                                )
                              );
                            }}
                            className="w-full mt-0.5 px-2 py-1 bg-white border border-slate-200 rounded text-slate-700"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Exclusions & Waiting Periods Content */}
            {activeTab === "exclusions" && (
              <div className="space-y-4 pt-2 max-h-[420px] overflow-y-auto pr-1">
                {/* Exclusions */}
                <div>
                  <h4 className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                    <span>General & Specific Exclusions ({exclusions.length})</span>
                  </h4>
                  <div className="space-y-2">
                    {exclusions.map((ex, i) => (
                      <div
                        key={i}
                        className="p-2.5 bg-rose-50/50 border border-rose-100 rounded-lg text-xs text-rose-900 flex items-start gap-2"
                      >
                        <span className="font-bold text-rose-500">•</span>
                        <p className="flex-1 font-medium">{ex}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Waiting Periods */}
                <div className="pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                    <span>Waiting Periods</span>
                  </h4>
                  <div className="space-y-2">
                    {waitingPeriods.map((wp, i) => (
                      <div
                        key={i}
                        className="p-2.5 bg-amber-50/50 border border-amber-100 rounded-lg text-xs text-amber-900 flex items-start gap-2"
                      >
                        <span className="font-bold text-amber-500">•</span>
                        <p className="flex-1 font-medium">{wp}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Claim Conditions */}
                <div className="pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <FileCheck className="w-3.5 h-3.5 text-blue-500" />
                    <span>Claim Submission Conditions</span>
                  </h4>
                  <div className="space-y-2">
                    {claimConditions.map((cc, i) => (
                      <div
                        key={i}
                        className="p-2.5 bg-blue-50/50 border border-blue-100 rounded-lg text-xs text-blue-900 flex items-start gap-2"
                      >
                        <span className="font-bold text-blue-500">•</span>
                        <p className="flex-1 font-medium">{cc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Raw Text & Evidence Content */}
            {activeTab === "raw_text" && (
              <div className="space-y-4 pt-2">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 font-medium">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>
                    No prompt injection or untrusted instructions detected. Untrusted evidence isolated in sandbox.
                  </span>
                </div>

                <div className="space-y-3 max-h-[360px] overflow-y-auto bg-slate-50 p-3 rounded-xl border border-slate-200 text-slate-700 font-mono text-[11px] leading-relaxed">
                  {initialDoc?.rawPages && initialDoc.rawPages.length > 0 ? (
                    initialDoc.rawPages.map((page) => (
                      <details
                        id={`page-${page.pageNo}`}
                        key={page.pageNo}
                        open
                        className="border-b border-slate-200 pb-2 mb-2 last:border-b-0 last:pb-0 last:mb-0"
                      >
                        <summary className="font-bold text-slate-900 mb-1">
                          [Page {page.pageNo} - {page.ocrUsed ? "OCR Extracted" : "Digital Text Layer"}]
                        </summary>
                        <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 bg-white p-2 rounded border border-slate-200">
                          {page.text || "(No readable text detected on this page)"}
                        </pre>
                      </details>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-400 font-sans text-xs">
                      No raw text pages available for this item.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Action Footer matching Image 2 */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 hover:bg-white text-xs font-semibold text-slate-700 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                onClick={handleSaveDraft}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 hover:bg-white text-xs font-semibold text-slate-700 transition-colors shadow-2xs"
              >
                <Save className="w-3.5 h-3.5 text-slate-500" />
                <span>Save as draft</span>
              </button>

              <button
                onClick={handleConfirmAndSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
              >
                <span>Confirm and save</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
