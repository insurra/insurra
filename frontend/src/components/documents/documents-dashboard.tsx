"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Eye,
  FileCheck,
  FileText,
  Lightbulb,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";

export interface DashboardDocumentItem {
  id: string;
  name: string;
  size: string;
  type: string;
  extractedInfo: string;
  extractedDetail?: {
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
  };
  status: "Verified" | "Needs review" | "Unsupported";
  uploadedOn: string;
  isUnsupported?: boolean;
}

interface DocumentsDashboardProps {
  documents: DashboardDocumentItem[];
  onUploadClick: () => void;
  onSelectDocument: (doc: DashboardDocumentItem) => void;
  onDeleteDocument?: (id: string) => void;
}

export function DocumentsDashboard({
  documents,
  onUploadClick,
  onSelectDocument,
  onDeleteDocument,
}: DocumentsDashboardProps) {
  // Category filter tabs
  const [activeCategoryTab, setActiveCategoryTab] = useState<string>("all");

  // Search & dropdown filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateSort, setDateSort] = useState<"newest" | "oldest">("newest");

  // Row selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openActionId, setOpenActionId] = useState<string | null>(null);

  // Compute stat counts
  const totalCount = documents.length;
  const verifiedCount = documents.filter((d) => d.status === "Verified").length;
  const needsReviewCount = documents.filter((d) => d.status === "Needs review").length;
  const unsupportedCount = documents.filter((d) => d.status === "Unsupported").length;

  const policyCount = documents.filter((d) =>
    d.type.toLowerCase().includes("policy")
  ).length;
  const certificateCount = documents.filter((d) =>
    d.type.toLowerCase().includes("certificate")
  ).length;
  const benefitScheduleCount = documents.filter((d) =>
    d.type.toLowerCase().includes("benefit")
  ).length;
  const visaCount = documents.filter((d) =>
    d.type.toLowerCase().includes("visa")
  ).length;
  const salesOfferCount = documents.filter((d) =>
    d.type.toLowerCase().includes("sales")
  ).length;

  // Filtered & sorted document list
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Category tab
      if (activeCategoryTab === "policies" && !doc.type.toLowerCase().includes("policy")) {
        return false;
      }
      if (
        activeCategoryTab === "certificates" &&
        !doc.type.toLowerCase().includes("certificate")
      ) {
        return false;
      }
      if (
        activeCategoryTab === "benefit_schedules" &&
        !doc.type.toLowerCase().includes("benefit")
      ) {
        return false;
      }
      if (activeCategoryTab === "visa_documents" && !doc.type.toLowerCase().includes("visa")) {
        return false;
      }
      if (activeCategoryTab === "sales_offers" && !doc.type.toLowerCase().includes("sales")) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = doc.name.toLowerCase().includes(q);
        const matchType = doc.type.toLowerCase().includes(q);
        const matchInfo = doc.extractedInfo.toLowerCase().includes(q);
        if (!matchName && !matchType && !matchInfo) return false;
      }

      // Dropdown type filter
      if (typeFilter !== "all" && doc.type !== typeFilter) {
        return false;
      }

      // Dropdown status filter
      if (statusFilter !== "all" && doc.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [documents, activeCategoryTab, searchQuery, typeFilter, statusFilter]);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDocuments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDocuments.map((d) => d.id)));
    }
  };

  const toggleSelectOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Verified":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Verified</span>
          </span>
        );
      case "Needs review":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>Needs review</span>
          </span>
        );
      case "Unsupported":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>Unsupported</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200">
            <span>{status}</span>
          </span>
        );
    }
  };

  const getTypeBadgeClass = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("policy")) return "bg-blue-50 text-blue-700 border-blue-200";
    if (t.includes("certificate")) return "bg-sky-50 text-sky-700 border-sky-200";
    if (t.includes("benefit")) return "bg-purple-50 text-purple-700 border-purple-200";
    if (t.includes("visa")) return "bg-indigo-50 text-indigo-700 border-indigo-200";
    if (t.includes("sales")) return "bg-amber-50 text-amber-700 border-amber-200";
    if (t.includes("claim")) return "bg-slate-100 text-slate-700 border-slate-300";
    if (t.includes("id")) return "bg-violet-50 text-violet-700 border-violet-200";
    if (t.includes("medical")) return "bg-teal-50 text-teal-700 border-teal-200";
    return "bg-slate-50 text-slate-700 border-slate-200";
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-12 min-w-0">
      {/* Top Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Documents</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Manage your insurance documents. Our AI extracts key information and keeps it organized for you.
          </p>
        </div>

        <button
          onClick={onUploadClick}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-sm self-start sm:self-auto flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Upload documents</span>
        </button>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 min-w-0">
        {/* Total Documents */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold text-slate-900 leading-tight">{totalCount}</div>
            <div className="text-xs text-slate-500 font-medium truncate" title="Total documents">
              Total documents
            </div>
          </div>
        </div>

        {/* Successfully Extracted */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <FileCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold text-slate-900 leading-tight">{verifiedCount}</div>
            <div className="text-xs text-slate-500 font-medium truncate" title="Successfully extracted">
              Successfully extracted
            </div>
          </div>
        </div>

        {/* Needs Your Review */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold text-slate-900 leading-tight">{needsReviewCount}</div>
            <div className="text-xs text-slate-500 font-medium truncate" title="Needs your review">
              Needs your review
            </div>
          </div>
        </div>

        {/* Unsupported Category */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center flex-shrink-0">
            <XCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold text-slate-900 leading-tight">{unsupportedCount}</div>
            <div className="text-xs text-slate-500 font-medium truncate" title="Unsupported category">
              Unsupported category
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Table Section + Right Sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start min-w-0 w-full">
        {/* Left Table Section */}
        <div className="xl:col-span-8 space-y-4 min-w-0 w-full">
          {/* Category Filter Tabs matching Image 3 */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-semibold text-slate-600 border-b border-slate-200 w-full min-w-0">
            <button
              onClick={() => setActiveCategoryTab("all")}
              className={`pb-2.5 px-1 border-b-2 transition-colors whitespace-nowrap ${
                activeCategoryTab === "all"
                  ? "border-blue-600 text-blue-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              All documents ({totalCount})
            </button>
            <button
              onClick={() => setActiveCategoryTab("policies")}
              className={`pb-2.5 px-1 border-b-2 transition-colors whitespace-nowrap ${
                activeCategoryTab === "policies"
                  ? "border-blue-600 text-blue-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              Policies ({policyCount})
            </button>
            <button
              onClick={() => setActiveCategoryTab("certificates")}
              className={`pb-2.5 px-1 border-b-2 transition-colors whitespace-nowrap ${
                activeCategoryTab === "certificates"
                  ? "border-blue-600 text-blue-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              Certificates ({certificateCount})
            </button>
            <button
              onClick={() => setActiveCategoryTab("benefit_schedules")}
              className={`pb-2.5 px-1 border-b-2 transition-colors whitespace-nowrap ${
                activeCategoryTab === "benefit_schedules"
                  ? "border-blue-600 text-blue-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              Benefit schedules ({benefitScheduleCount})
            </button>
            <button
              onClick={() => setActiveCategoryTab("visa_documents")}
              className={`pb-2.5 px-1 border-b-2 transition-colors whitespace-nowrap ${
                activeCategoryTab === "visa_documents"
                  ? "border-blue-600 text-blue-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              Visa documents ({visaCount})
            </button>
            <button
              onClick={() => setActiveCategoryTab("sales_offers")}
              className={`pb-2.5 px-1 border-b-2 transition-colors whitespace-nowrap ${
                activeCategoryTab === "sales_offers"
                  ? "border-blue-600 text-blue-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              Sales offers ({salesOfferCount})
            </button>
          </div>

          {/* Search & Dropdown Filters Bar matching Image 3 */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 border border-slate-200 rounded-xl shadow-2xs min-w-0 w-full">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
              />
            </div>

            {/* Dropdown Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-medium focus:outline-none"
              >
                <option value="all">Document type</option>
                <option value="Policy document">Policy document</option>
                <option value="Insurance certificate">Insurance certificate</option>
                <option value="Benefit schedule">Benefit schedule</option>
                <option value="Visa document">Visa document</option>
                <option value="Sales offer">Sales offer</option>
                <option value="Claim document">Claim document</option>
                <option value="ID document">ID document</option>
                <option value="Medical record">Medical record</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-medium focus:outline-none"
              >
                <option value="all">Status</option>
                <option value="Verified">Verified</option>
                <option value="Needs review">Needs review</option>
                <option value="Unsupported">Unsupported</option>
              </select>

              <select
                value={dateSort}
                onChange={(e) => setDateSort(e.target.value as "newest" | "oldest")}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-medium focus:outline-none"
              >
                <option value="newest">Date uploaded</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>

          {/* Documents Table matching Image 3 */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs w-full min-w-0">
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs min-w-[620px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-3.5 w-10">
                      <input
                        type="checkbox"
                        checked={
                          selectedIds.size > 0 &&
                          selectedIds.size === filteredDocuments.length
                        }
                        onChange={toggleSelectAll}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="py-3 px-3">Document name</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Extracted information</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Uploaded on</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDocuments.map((doc) => {
                    const isSelected = selectedIds.has(doc.id);
                    const isPdf = doc.name.toLowerCase().endsWith(".pdf");
                    return (
                      <tr
                        key={doc.id}
                        onClick={() => onSelectDocument(doc)}
                        className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${
                          isSelected ? "bg-blue-50/30" : ""
                        }`}
                      >
                        {/* Checkbox */}
                        <td
                          className="py-3 px-3.5 w-10"
                          onClick={(e) => toggleSelectOne(doc.id, e)}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>

                        {/* Document Name */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                isPdf ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-600"
                              }`}
                            >
                              {isPdf ? "PDF" : "IMG"}
                            </div>
                            <div className="min-w-0">
                              <div
                                className="font-semibold text-slate-900 truncate max-w-[120px] sm:max-w-[170px]"
                                title={doc.name}
                              >
                                {doc.name}
                              </div>
                              <div className="text-[11px] text-slate-400 font-normal">{doc.size}</div>
                            </div>
                          </div>
                        </td>

                        {/* Type Badge */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getTypeBadgeClass(
                              doc.type
                            )}`}
                          >
                            {doc.type}
                          </span>
                        </td>

                        {/* Extracted Information Preview */}
                        <td className="py-3 px-3">
                          <div className="text-slate-800 font-medium leading-relaxed max-w-[160px] sm:max-w-[200px]">
                            {doc.extractedInfo.split("\n").map((line, idx) => (
                              <div
                                key={idx}
                                className={
                                  idx > 0
                                    ? "text-[11px] text-slate-500 font-normal truncate"
                                    : "text-slate-900 font-medium truncate"
                                }
                              >
                                {line}
                              </div>
                            ))}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3 whitespace-nowrap">{getStatusBadge(doc.status)}</td>

                        {/* Uploaded On */}
                        <td className="py-3 px-3 text-slate-600 font-medium whitespace-nowrap text-[11px]">
                          {doc.uploadedOn}
                        </td>

                        {/* Actions ... menu */}
                        <td className="py-3 px-3 text-right">
                          <div className="relative inline-block text-left">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenActionId(openActionId === doc.id ? null : doc.id);
                              }}
                              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                              aria-label="Actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {openActionId === doc.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-1 w-36 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-20 text-xs font-medium text-slate-700"
                              >
                                <button
                                  onClick={() => {
                                    setOpenActionId(null);
                                    onSelectDocument(doc);
                                  }}
                                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                                  <span>Review details</span>
                                </button>
                                {onDeleteDocument && (
                                  <button
                                    onClick={() => {
                                      setOpenActionId(null);
                                      onDeleteDocument(doc.id);
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-rose-600 flex items-center gap-2"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredDocuments.length === 0 && (
              <div className="p-12 text-center text-slate-500 text-xs space-y-3">
                <div className="relative w-28 h-28 mx-auto">
                  <Image
                    src="/Winking Kangaroo Mascot with Document.png"
                    alt="Inssura Mascot"
                    fill
                    className="object-contain"
                  />
                </div>
                <p className="font-bold text-sm text-slate-900">
                  {documents.length === 0 ? "No documents uploaded yet" : "No documents found matching filters"}
                </p>
                <p className="max-w-md mx-auto text-slate-500 text-xs leading-relaxed">
                  {documents.length === 0
                    ? "Upload your insurance policies, membership certificates, health cards, or visa documents. Inssura Document Intelligence will extract data and prepare your protection analysis automatically."
                    : "Try clearing filters or search query to see all documents."}
                </p>
                {documents.length === 0 && (
                  <button
                    onClick={onUploadClick}
                    className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Upload First Document</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar Widgets matching Image 3 */}
        <div className="xl:col-span-4 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-1 gap-4 min-w-0 w-full">
          {/* 1. Mascot Card: Your documents, organized */}
          <div className="bg-gradient-to-br from-white to-sky-50/50 border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-3">
            <div className="relative w-full h-36 flex items-center justify-center">
              <Image
                src="/Winking Kangaroo Mascot with Document.png"
                alt="Inssura Mascot with Document"
                fill
                className="object-contain"
              />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                Your documents, organized
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                We extract key information from your documents and keep them secure and private.
              </p>
            </div>
          </div>

          {/* 2. Tips Checklist Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
              <Lightbulb className="w-4 h-4 text-amber-500" />
              <span>Tips</span>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-600 font-medium">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <span>Upload clear and complete documents</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <span>Supported formats: PDF, JPG, PNG</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <span>We&apos;ll extract key information automatically</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <span>You can review and edit any extracted field</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <span>Your documents are encrypted and stored securely</span>
              </li>
            </ul>
          </div>

          {/* 3. Drag & Drop Box: Need to add more? */}
          <div
            onClick={onUploadClick}
            className="bg-white border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-2xl p-6 text-center cursor-pointer transition-colors shadow-2xs"
          >
            <h4 className="text-xs font-bold text-slate-900 mb-2">Need to add more?</h4>
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-2">
              <CloudUpload className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold text-slate-800">
              Drag and drop files here
            </p>
            <p className="text-[11px] text-blue-600 font-semibold mt-0.5">
              or click to browse
            </p>
            <p className="text-[10px] text-slate-400 mt-2 font-medium">
              PDF, JPG, PNG • Max 10 MB per file
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
