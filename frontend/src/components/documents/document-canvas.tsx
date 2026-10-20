"use client";

import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  FileText,
  ShieldCheck,
} from "lucide-react";

interface DocumentCanvasProps {
  documentName: string;
  documentType?: string;
  fileUrl?: string | null;
  mimeType?: string;
  pageCount?: number;
  activePage?: number;
  onPageChange?: (page: number) => void;
  benefits?: Array<{ name: string; limit: string; deductible: string; page?: number }>;
  extractedData?: {
    policyNumber?: string;
    insurer?: string;
    planName?: string;
    policyholder?: string;
    insuredPerson?: string;
    dob?: string;
    coverageStart?: string;
    coverageEnd?: string;
    planType?: string;
    passportNumber?: string;
  };
}

export function DocumentCanvas({
  documentName,
  documentType = "Policy document",
  fileUrl,
  mimeType = "application/pdf",
  pageCount = 12,
  activePage = 1,
  onPageChange,
  benefits,
  extractedData,
}: DocumentCanvasProps) {
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedPage, setSelectedPage] = useState(activePage);

  const handlePageSelect = (page: number) => {
    setSelectedPage(page);
    onPageChange?.(page);
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 15, 175));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 15, 65));

  const totalPages = Math.max(pageCount, 1);

  return (
    <div
      className={`flex flex-col bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-sm transition-all ${
        isFullscreen ? "fixed inset-4 z-50 bg-white" : "h-[620px]"
      }`}
    >
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 text-xs text-slate-700">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-[10px]">
            PDF
          </div>
          <span className="font-semibold text-slate-900 truncate max-w-[200px]" title={documentName}>
            {documentName}
          </span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            {documentType}
          </span>
        </div>

        {/* Zoom & Page Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 border border-slate-200">
            <button
              onClick={() => handlePageSelect(Math.max(1, selectedPage - 1))}
              disabled={selectedPage <= 1}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
              title="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-medium text-slate-700">
              Page {selectedPage} of {totalPages}
            </span>
            <button
              onClick={() => handlePageSelect(Math.min(totalPages, selectedPage + 1))}
              disabled={selectedPage >= totalPages}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
              title="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 border border-slate-200">
            <button
              onClick={handleZoomOut}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-medium text-slate-700 w-12 text-center">{zoom}%</span>
            <button
              onClick={handleZoomIn}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-white"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Split: Thumbnails Sidebar + Canvas View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Thumbnails Sidebar */}
        <div className="w-20 bg-slate-100/70 border-r border-slate-200 p-2 flex flex-col gap-2.5 overflow-y-auto">
          {Array.from({ length: Math.min(totalPages, 6) }).map((_, idx) => {
            const pageNum = idx + 1;
            const isActive = selectedPage === pageNum;
            return (
              <button
                key={pageNum}
                onClick={() => handlePageSelect(pageNum)}
                className={`flex flex-col items-center p-1 rounded-md transition-all text-[10px] font-medium ${
                  isActive
                    ? "bg-white border-2 border-emerald-600 shadow-sm text-emerald-800"
                    : "bg-white/80 border border-slate-200 text-slate-600 hover:bg-white"
                }`}
              >
                <div className="w-12 h-16 bg-white border border-slate-200 rounded p-1 flex flex-col justify-between overflow-hidden shadow-xs">
                  <div className="w-full h-1 bg-slate-200 rounded-xs mb-1" />
                  <div className="space-y-0.5">
                    <div className="w-3/4 h-0.5 bg-slate-200 rounded-xs" />
                    <div className="w-full h-0.5 bg-slate-200 rounded-xs" />
                    <div className="w-1/2 h-0.5 bg-slate-200 rounded-xs" />
                  </div>
                  <div className="text-[8px] text-center font-bold text-slate-400">
                    p.{pageNum}
                  </div>
                </div>
                <span className="mt-1">{pageNum}</span>
              </button>
            );
          })}
        </div>

        {/* Document Canvas Viewer */}
        <div className="flex-1 bg-slate-200/50 p-6 overflow-auto flex items-start justify-center">
          <div
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
            className="transition-transform duration-150"
          >
            {fileUrl && mimeType.startsWith("image/") ? (
              <div className="bg-white rounded-lg shadow-md p-2 border border-slate-200 max-w-[620px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl}
                  alt={documentName}
                  className="max-w-full h-auto rounded"
                />
              </div>
            ) : fileUrl && mimeType === "application/pdf" ? (
              <div className="w-[580px] bg-white rounded-lg shadow-md overflow-hidden border border-slate-300">
                <iframe
                  src={`${fileUrl}#page=${selectedPage}`}
                  className="w-full h-[700px] border-none"
                  title={documentName}
                />
              </div>
            ) : (
              /* High-fidelity Visual Document Simulator */
              <div className="w-[580px] min-h-[720px] bg-white rounded-lg shadow-md border border-slate-200 p-8 text-slate-800 font-sans relative">
                {/* Header with Insurer Logo and Title */}
                <div className="flex items-start justify-between pb-4 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center text-white font-black text-sm shadow-xs uppercase tracking-wider">
                      {(extractedData?.insurer || documentName || "DOC").slice(0, 3)}
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900 tracking-tight leading-tight">
                        {extractedData?.planName || documentName}
                      </h2>
                      <p className="text-xs text-slate-500 font-medium">
                        {extractedData?.insurer || "Insurance / Document Schedule"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-emerald-700">{documentType}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      No. {extractedData?.policyNumber || "-"}
                    </div>
                  </div>
                </div>

                {/* Slogan banner */}
                <div className="mt-3 py-1.5 px-3 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 font-semibold flex items-center justify-between">
                  <span>CONFIDENTIAL & VERIFIED EVIDENCE</span>
                  <span className="text-[10px] text-slate-500">Official Schedule</span>
                </div>

                {/* Policyholder Information Table */}
                <div className="mt-5">
                  <div className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>Beneficiary / Holder Information</span>
                  </div>
                  <table className="w-full text-xs border border-slate-200 rounded overflow-hidden">
                    <tbody>
                      <tr className="border-b border-slate-200 bg-slate-50/60">
                        <td className="py-1.5 px-3 font-medium text-slate-500 w-1/3">Name</td>
                        <td className="py-1.5 px-3 font-semibold text-slate-900">
                          {extractedData?.policyholder || extractedData?.insuredPerson || "-"}
                        </td>
                      </tr>
                      {extractedData?.dob && (
                        <tr className="border-b border-slate-200">
                          <td className="py-1.5 px-3 font-medium text-slate-500">Date of Birth</td>
                          <td className="py-1.5 px-3 text-slate-900">{extractedData.dob}</td>
                        </tr>
                      )}
                      {extractedData?.passportNumber && (
                        <tr className="border-b border-slate-200 bg-slate-50/60">
                          <td className="py-1.5 px-3 font-medium text-slate-500">ID / Passport No.</td>
                          <td className="py-1.5 px-3 text-slate-900 font-mono">
                            {extractedData.passportNumber}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Policy Details Table */}
                <div className="mt-5">
                  <div className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                    <span>Coverage Details</span>
                  </div>
                  <table className="w-full text-xs border border-slate-200 rounded overflow-hidden">
                    <tbody>
                      <tr className="border-b border-slate-200 bg-slate-50/60">
                        <td className="py-1.5 px-3 font-medium text-slate-500 w-1/3">Plan Type</td>
                        <td className="py-1.5 px-3 font-semibold text-slate-900">
                          {extractedData?.planType || extractedData?.planName || "-"}
                        </td>
                      </tr>
                      <tr className="border-b border-slate-200">
                        <td className="py-1.5 px-3 font-medium text-slate-500">Coverage Period</td>
                        <td className="py-1.5 px-3 font-medium text-slate-900">
                          {extractedData?.coverageStart || "-"} — {extractedData?.coverageEnd || "-"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 px-3 font-medium text-slate-500">Provider / Insurer</td>
                        <td className="py-1.5 px-3 text-slate-900">
                          {extractedData?.insurer || "-"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Benefits Summary Table if benefits present */}
                {benefits && benefits.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold text-slate-900 mb-2">
                      Benefits Schedule Summary
                    </div>
                    <table className="w-full text-[11px] border border-slate-200 rounded overflow-hidden">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 text-left font-semibold">
                          <th className="py-1.5 px-3">Benefit Item</th>
                          <th className="py-1.5 px-3">Coverage Limit</th>
                          <th className="py-1.5 px-3">Deductible</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {benefits.map((b, idx) => (
                          <tr key={idx} className={idx % 2 === 1 ? "bg-slate-50/50" : ""}>
                            <td className="py-1.5 px-3 font-medium">{b.name}</td>
                            <td className="py-1.5 px-3 font-semibold text-slate-900">{b.limit}</td>
                            <td className="py-1.5 px-3 text-slate-500">{b.deductible}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Footer Stamp & Page Indicator */}
                <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full border border-emerald-300 text-emerald-600 flex items-center justify-center font-bold text-[8px] transform -rotate-12">
                      SEAL
                    </div>
                    <span>Electronic Document Intelligence Layer</span>
                  </div>
                  <div>Page {selectedPage} of {totalPages}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
