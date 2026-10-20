"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useActor } from "@/lib/actor";
import { useAuth } from "@/lib/auth";
import { config } from "@/lib/config";
import { DocumentReview, type ReviewDocData, type ReviewDocBenefitItem } from "@/components/documents/document-review";

export default function DocumentDetailRoute() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const { headers } = useActor();
  const { token } = useAuth();
  const [doc, setDoc] = useState<ReviewDocData | null>(null);

  useEffect(() => {
    if (!id) return;
    const authHeaders = headers || (token ? { Authorization: `Bearer ${token}` } : null);
    if (!authHeaders) return;

    void (async () => {
      try {
        const detail = await api.request("get", "/api/v1/account/documents/{document_id}", {
          params: { document_id: id },
          headers: authHeaders,
        });

        // Fetch file blob for in-canvas preview
        let fileUrl: string | null = null;
        try {
          const fileRes = await fetch(`${config.apiBaseUrl}/api/v1/account/documents/${id}/file`, {
            headers: authHeaders,
          });
          if (fileRes.ok) {
            const blob = await fileRes.blob();
            fileUrl = URL.createObjectURL(blob);
          }
        } catch {
          // File preview unavailable, falls back to visual simulator
        }

        const fields = detail.fields || [];
        const getField = (key: string): string => {
          const found = fields.find((f) => f.field_key === key);
          return typeof found?.value === "string" ? found.value : "";
        };

        const mappedBenefits: ReviewDocBenefitItem[] = (
          detail.benefits as Array<{
            benefit_item?: string;
            name?: string;
            coverage_limit?: string;
            limit?: string;
            deductible?: string;
            source_page?: number;
            page?: number;
          }> | undefined
        )?.map((b, idx) => ({
          id: `b-${idx}`,
          name: b.benefit_item || b.name || "Coverage benefit",
          limit: b.coverage_limit || b.limit || "-",
          deductible: b.deductible || "-",
          page: b.source_page || b.page || 1,
        })) || [];

        setDoc({
          id: detail.id,
          filename: detail.original_filename,
          docType: detail.kind.replace(/_/g, " "),
          fileUrl,
          mimeType: detail.mime_type,
          insurer: getField("provider") || getField("insurance_provider"),
          planName: getField("plan_name"),
          policyNumber: getField("policy_number"),
          policyholder: getField("policyholder_name") || getField("insured_name"),
          insuredPerson: getField("insured_name"),
          dob: getField("birth_date"),
          coverageStart: getField("coverage_start_date"),
          coverageEnd: getField("coverage_end_date"),
          planType: getField("plan_type"),
          status: detail.status === "VERIFIED" ? "Verified" : "Needs review",
          benefits: mappedBenefits,
          exclusions: detail.exclusions || [],
          waitingPeriods: detail.waiting_periods || [],
          claimConditions: detail.claim_conditions || [],
          rawPages: (detail.pages as Array<{ page_no?: number; text?: string; ocr_used?: boolean }> | undefined)?.map((p) => ({
            pageNo: typeof p.page_no === "number" ? p.page_no : 1,
            text: typeof p.text === "string" ? p.text : "",
            ocrUsed: Boolean(p.ocr_used),
          })) || [],
        });
      } catch {
        // Fallback placeholder with empty fields
        setDoc({
          id,
          filename: "document.pdf",
          docType: "Policy document",
          insurer: "",
          planName: "",
          policyNumber: "",
          policyholder: "",
          insuredPerson: "",
          dob: "",
          coverageStart: "",
          coverageEnd: "",
          planType: "",
          status: "Needs review",
          benefits: [],
          exclusions: [],
          waitingPeriods: [],
          claimConditions: [],
        });
      }
    })();
  }, [id, headers, token]);

  if (!doc) {
    return (
      <div className="p-12 text-center text-xs text-slate-500 font-medium">
        Loading document review...
      </div>
    );
  }

  return (
    <DocumentReview
      initialDoc={doc}
      onBack={() => router.push("/documents")}
      onConfirmSuccess={() => router.push("/documents")}
    />
  );
}
