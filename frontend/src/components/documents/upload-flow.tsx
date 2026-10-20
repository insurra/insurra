"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  FileText,
  Info,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { DocumentCanvas } from "./document-canvas";

export interface UploadQueueItem {
  id: string;
  file: File;
  name: string;
  size: string;
  status: "processing" | "ready" | "failed";
  progress?: number;
  fileUrl?: string;
  detail?: unknown;
  extracted?: {
    docType?: string;
    issuer?: string;
    planName?: string;
    policyNumber?: string;
    policyholder?: string;
    insuredPerson?: string;
    dob?: string;
    coverageStart?: string;
    coverageEnd?: string;
    planType?: string;
    passportNumber?: string;
    confidence?: "High" | "Medium" | "Low";
  };
}

interface UploadFlowProps {
  onBackToDashboard: () => void;
  onProceedToReview: (item: UploadQueueItem) => void;
  onUploadFile?: (file: File) => Promise<unknown>;
}

const SUPPORTED_DOC_TYPES = [
  {
    title: "Policy document",
    desc: "Full policy, booklet",
    iconColor: "text-blue-600 bg-blue-50 border-blue-200",
  },
  {
    title: "Insurance certificate",
    desc: "Coverage certificate",
    iconColor: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
  {
    title: "Benefit schedule",
    desc: "List of benefits and limits",
    iconColor: "text-purple-600 bg-purple-50 border-purple-200",
  },
  {
    title: "Visa document",
    desc: "Visa, residence permit",
    iconColor: "text-sky-600 bg-sky-50 border-sky-200",
  },
  {
    title: "Sales offer",
    desc: "Quotation, plan summary",
    iconColor: "text-teal-600 bg-teal-50 border-teal-200",
  },
];

export function UploadFlow({
  onBackToDashboard,
  onProceedToReview,
  onUploadFile,
}: UploadFlowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const activeItem = queue.find((q) => q.id === selectedId) || queue[0] || null;

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 10);
    const newItems: UploadQueueItem[] = list.map((file, idx) => {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      const sizeStr = file.size > 1024 * 1024 ? `${mb} MB` : `${Math.round(file.size / 1024)} KB`;
      return {
        id: `upload-${Date.now()}-${idx}`,
        file,
        name: file.name,
        size: sizeStr,
        status: "processing",
        fileUrl: URL.createObjectURL(file),
      };
    });

    setQueue((prev) => [...prev, ...newItems]);
    if (newItems.length > 0) {
      setSelectedId(newItems[0].id);
    }

interface UploadFlowResult {
  document_id?: string;
  detail?: {
    kind?: string;
    fields?: Array<{ field_key: string; value?: unknown }>;
  };
}

    // Process files dynamically
    for (const item of newItems) {
      try {
        let uploadRes: UploadFlowResult | null = null;
        if (onUploadFile) {
          const raw = await onUploadFile(item.file);
          uploadRes = raw as UploadFlowResult;
        } else {
          await new Promise((r) => setTimeout(r, 800));
        }

        const detail = uploadRes?.detail;
        const findField = (key: string): string => {
          const f = detail?.fields?.find((i: { field_key: string; value?: unknown }) => i.field_key === key);
          return typeof f?.value === "string" ? f.value : "";
        };

        const isPdf = item.name.toLowerCase().endsWith(".pdf");
        const docType = detail?.kind
          ? detail.kind.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
          : isPdf
          ? "Policy document"
          : "Insurance certificate";

        const issuer = findField("provider") || findField("insurance_provider") || (item.name.toLowerCase().includes("aia") ? "AIA" : "");
        const planName = findField("plan_name") || item.name;
        const policyNumber = findField("policy_number") || "";
        const policyholder = findField("policyholder_name") || findField("insured_name") || "";
        const insuredPerson = findField("insured_name") || "";
        const dob = findField("birth_date") || "";
        const coverageStart = findField("coverage_start_date") || "";
        const coverageEnd = findField("coverage_end_date") || "";

        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  id: uploadRes?.document_id || q.id,
                  status: "ready",
                  detail,
                  extracted: {
                    docType,
                    issuer,
                    planName,
                    policyNumber,
                    policyholder,
                    insuredPerson,
                    dob,
                    coverageStart,
                    coverageEnd,
                    planType: docType,
                    confidence: "High",
                  },
                }
              : q
          )
        );
      } catch {
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: "failed" } : q))
        );
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-12 min-w-0">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <button
            onClick={onBackToDashboard}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Documents</span>
          </button>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Upload document</h1>
          <p className="text-sm text-slate-500 mt-1">
            Upload your insurance documents and let Inssura extract the key information for you.
          </p>
        </div>

        {/* Mascot Banner matching Image 1 top right */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-sky-50 to-blue-50 border border-sky-100 rounded-xl p-3 sm:max-w-md shadow-xs">
          <div className="relative w-12 h-12 flex-shrink-0">
            <Image
              src="/Winking Kangaroo Mascot with Document.png"
              alt="Inssura Mascot"
              fill
              className="object-contain"
            />
          </div>
          <div className="text-xs">
            <p className="text-slate-700 font-medium leading-relaxed">
              We support policy documents, certificates, benefit schedules, visa documents, and more.
            </p>
            <button
              onClick={() => {}}
              className="text-blue-600 font-semibold hover:underline mt-0.5 inline-flex items-center gap-1"
            >
              View supported documents <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Progress Stepper matching Image 1 & 2 */}
      <div className="flex items-center justify-between sm:justify-start sm:gap-12 border-b border-slate-200 pb-4 text-xs font-medium">
        <div className="flex items-center gap-2 text-emerald-700 font-bold">
          <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">
            1
          </div>
          <span>Upload</span>
        </div>
        <div className="h-0.5 w-8 bg-slate-200 hidden sm:block" />
        <div className="flex items-center gap-2 text-slate-400">
          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-300 text-slate-500 flex items-center justify-center text-xs">
            2
          </div>
          <span>AI processing</span>
        </div>
        <div className="h-0.5 w-8 bg-slate-200 hidden sm:block" />
        <div className="flex items-center gap-2 text-slate-400">
          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-300 text-slate-500 flex items-center justify-center text-xs">
            3
          </div>
          <span>Review & confirm</span>
        </div>
        <div className="h-0.5 w-8 bg-slate-200 hidden sm:block" />
        <div className="flex items-center gap-2 text-slate-400">
          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-300 text-slate-500 flex items-center justify-center text-xs">
            4
          </div>
          <span>Saved to your protection</span>
        </div>
      </div>

      {/* Drag & Drop Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          isDragging
            ? "border-blue-500 bg-blue-50/80 scale-[1.005]"
            : "border-blue-200 hover:border-blue-400 bg-blue-50/30 hover:bg-blue-50/60"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
          }}
        />
        <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center mx-auto mb-3">
          <CloudUpload className="w-6 h-6 text-blue-600" />
        </div>
        <h3 className="text-base font-bold text-slate-900">
          Drag and drop your files here
        </h3>
        <p className="text-xs text-blue-600 font-medium mt-0.5">
          or click to browse
        </p>
        <p className="text-[11px] text-slate-500 mt-2 font-medium">
          PDF, JPG, PNG • Max 10 MB per file • Up to 10 files at once
        </p>
      </div>

      {/* Supported Document Types Pills */}
      <div>
        <div className="text-xs font-semibold text-slate-600 mb-2">Supported document types</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {SUPPORTED_DOC_TYPES.map((type, i) => (
            <div
              key={i}
              className="bg-white border border-slate-200 rounded-xl p-3 flex items-start gap-2.5 shadow-2xs hover:border-slate-300 transition-colors"
            >
              <div className={`p-1.5 rounded-lg border ${type.iconColor}`}>
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-slate-900 truncate">{type.title}</h4>
                <p className="text-[10px] text-slate-500 truncate">{type.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-File Upload Queue Status List */}
      <div className="flex flex-wrap items-center gap-3">
        {queue.map((item) => {
          const isSelected = item.id === selectedId;
          const isPdf = item.name.toLowerCase().endsWith(".pdf");
          return (
            <div
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border cursor-pointer transition-all ${
                isSelected
                  ? "bg-white border-blue-500 ring-2 ring-blue-100 shadow-sm"
                  : "bg-white/80 border-slate-200 hover:border-slate-300"
              }`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                  isPdf ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-600"
                }`}
              >
                {isPdf ? "PDF" : "IMG"}
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-slate-900 max-w-[140px] truncate">
                  {item.name}
                </div>
                <div className="text-[10px] text-slate-500">{item.size}</div>
              </div>

              {item.status === "processing" ? (
                <div className="flex items-center gap-1.5 ml-2 text-[11px] text-teal-600 font-semibold bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                  <Loader2 className="w-3 h-3 animate-spin text-teal-600" />
                  <span>Processing...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 ml-2 text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Ready</span>
                </div>
              )}
            </div>
          );
        })}

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5 text-slate-600" />
          <span>Add more files</span>
        </button>
      </div>

      {/* Split Preview Panel matching Image 1 bottom */}
      {activeItem && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
          {/* Left Canvas Preview */}
          <div className="lg:col-span-7">
            <DocumentCanvas
              documentName={activeItem.name}
              documentType={activeItem.extracted?.docType || "Policy document"}
              fileUrl={activeItem.fileUrl || (activeItem.file ? URL.createObjectURL(activeItem.file) : null)}
              mimeType={activeItem.file?.type || "application/pdf"}
              extractedData={{
                policyNumber: activeItem.extracted?.policyNumber,
                insurer: activeItem.extracted?.issuer,
                planName: activeItem.extracted?.planName,
                policyholder: activeItem.extracted?.policyholder,
                insuredPerson: activeItem.extracted?.insuredPerson,
                dob: activeItem.extracted?.dob,
                coverageStart: activeItem.extracted?.coverageStart,
                coverageEnd: activeItem.extracted?.coverageEnd,
                planType: activeItem.extracted?.planType,
              }}
            />
          </div>

          {/* Right Quick Extracted Info Card */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
            <div className="space-y-4">
              {/* Header with Badges */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Extracted information</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 text-blue-600" />
                    AI extracted
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                  <span>Confidence: High</span>
                  <Info className="w-3 h-3 text-emerald-600 ml-0.5" />
                </div>
              </div>

              {/* Notice Banner */}
              <div className="bg-amber-50/80 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-xs flex items-center gap-2 font-medium">
                <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>Please review the extracted information and confirm or edit if needed.</span>
              </div>

              {/* Document details section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                  <span>Document details</span>
                  <button className="text-blue-600 hover:underline text-[11px] font-semibold">Change</button>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-500 text-[11px]">Document type</span>
                    <div className="mt-0.5 flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200 font-medium">
                      <FileText className="w-3.5 h-3.5 text-rose-500" />
                      <span>{activeItem.extracted?.docType || "Policy document"}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 text-[11px]">Issuer / Insurance company</span>
                      <div className="mt-0.5 flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 font-semibold text-slate-900">
                        <span>{activeItem.extracted?.issuer || "-"}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[11px]">Plan name</span>
                      <div className="mt-0.5 flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 font-medium text-slate-900 truncate">
                        <span className="truncate">{activeItem.extracted?.planName || activeItem.name}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 ml-1" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Key information section */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                  <span>Key information</span>
                  <button className="text-blue-600 hover:underline text-[11px] font-semibold">Edit all</button>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 text-[11px]">Policy number</span>
                      <div className="mt-0.5 flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 font-mono text-slate-900">
                        <span>{activeItem.extracted?.policyNumber || "-"}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[11px]">Policyholder</span>
                      <div className="mt-0.5 flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-slate-900">
                        <span>{activeItem.extracted?.policyholder || "-"}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 text-[11px]">Insured person</span>
                      <div className="mt-0.5 flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-slate-900">
                        <span>{activeItem.extracted?.insuredPerson || "-"}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[11px]">Date of birth</span>
                      <div className="mt-0.5 flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-slate-900">
                        <span>{activeItem.extracted?.dob || "-"}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 text-[11px]">Coverage period</span>
                      <div className="mt-0.5 flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-slate-900 text-[11px]">
                        <span>
                          {activeItem.extracted?.coverageStart
                            ? `${activeItem.extracted.coverageStart} → ${activeItem.extracted.coverageEnd || ""}`
                            : "-"}
                        </span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[11px]">Plan type</span>
                      <div className="mt-0.5 flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-slate-900 truncate">
                        <span className="truncate">{activeItem.extracted?.planType || "-"}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 ml-1" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Proceed CTA */}
            <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-end">
              <button
                onClick={() => onProceedToReview(activeItem)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors shadow-sm"
              >
                <span>Review all extracted information</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
