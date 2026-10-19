"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { getWorkflowUrl } from "@/lib/api/workflow-client";

interface BenefitItem {
  benefit_name?: string | null;
  limit?: string | number | null;
  currency?: string | null;
  period?: string | null;
  covered_service?: string | null;
  waiting_period_days?: number | null;
}

interface ExclusionItem {
  excluded_event?: string | null;
  conditions?: string | null;
  waiting_period_days?: number | null;
}

interface ProductItem {
  product_id: string;
  name?: string | null;
  product_name?: string | null;
  original_name?: string | null;
  original_product_name?: string | null;
  insurer_id: string;
  insurer_name: string;
  product_category: string;
  product_version?: string | null;
  effective_period?: string | null;
  coverage_territory?: string | null;
  target_users?: string[];
  eligibility_conditions?: string[];
  published_pricing?: {
    standard_annual?: string | null;
    minimum_period?: string | null;
    currency?: string | null;
  } | null;
  published_pricing_text?: string | null;
  published_pricing_conditions?: string | null;
  benefits?: BenefitItem[];
  exclusions?: ExclusionItem[];
  source_url?: string | null;
  verification_status: string;
  evidence_class?: string | null;
  provenance_note?: string | null;
  disclaimer?: string | null;
}

interface ProductCompareResponse {
  country_code: string;
  total_products?: number;
  total_available?: number;
  categories?: string[];
  active_categories?: string[];
  products: ProductItem[];
  commission_disclosure?: {
    has_broker_commission?: boolean;
    objective_ranking_note?: string;
  } | null;
}

export default function ProductComparePage() {
  const [country, setCountry] = useState<string>("CN");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [data, setData] = useState<ProductCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadComparison = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("country_code", country);
      if (selectedCategory !== "ALL") {
        params.set("product_category", selectedCategory);
      }
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/products/compare?${params.toString()}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ProductCompareResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load product comparison.");
    } finally {
      setLoading(false);
    }
  }, [country, selectedCategory]);

  useEffect(() => {
    void Promise.resolve().then(loadComparison);
  }, [loadComparison]);

  const categories = data?.categories ?? data?.active_categories ?? [];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 text-slate-900">
      {/* Heading */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">
            Insurance Product Comparison
          </h1>
          <p className="text-sm text-slate-500">
            Compare curated insurance products across China and Indonesia with explicit source provenance and verification status.
          </p>
        </div>

        {/* Country Selector */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setCountry("CN"); setSelectedCategory("ALL"); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
              country === "CN" ? "bg-teal-700 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            China (CN)
          </button>
          <button
            type="button"
            onClick={() => { setCountry("ID"); setSelectedCategory("ALL"); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
              country === "ID" ? "bg-teal-700 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Indonesia (ID)
          </button>
        </div>
      </div>

      {/* Provenance & Commission Notice */}
      <div className="mb-6 p-4 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
        <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-700" />
        <div>
          <strong>Catalog Provenance Notice:</strong> Public catalog entries are curated reference summaries and do not represent your owned coverage. Unless a record has an independently retrieved official filing artifact (`RETRIEVED_OFFICIAL`), it is marked <strong>Unverified</strong>. Commission disclosure: {data?.commission_disclosure?.objective_ranking_note ?? "Not disclosed"}.
        </div>
      </div>

      {/* Category Filter Pills */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6">
          <button
            type="button"
            onClick={() => setSelectedCategory("ALL")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
              selectedCategory === "ALL"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All Products
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                selectedCategory === cat
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {cat.replace(/_/g, " ").toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="py-24 text-center text-slate-400">
          <RefreshCw className="animate-spin inline-block text-teal-700 mb-2" size={28} />
          <p className="text-sm">Loading product catalog comparison...</p>
        </div>
      )}

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 mb-6">
          {error}
        </div>
      )}

      {/* Comparison Grid */}
      {!loading && data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.products.map((p) => {
            const isVerifiedOfficial =
              p.verification_status === "VERIFIED" && p.evidence_class === "RETRIEVED_OFFICIAL";
            const title = p.name || p.product_name || "Not available";
            const origName = p.original_name || p.original_product_name;
            const pricingText = p.published_pricing?.standard_annual
              ? `${p.published_pricing.currency || ""} ${p.published_pricing.standard_annual}`.trim()
              : p.published_pricing_text || "Not available";

            return (
              <div
                key={p.product_id}
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wider bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded-full">
                      {(p.product_category || "general").replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      {p.coverage_territory || "Not available"}
                    </span>
                  </div>

                  <h3 className="font-bold text-slate-900 text-base mb-1">{title}</h3>
                  {origName && (
                    <p className="text-xs text-slate-500 mb-3">{origName}</p>
                  )}

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs mb-4 space-y-1.5">
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Underwriting Insurer</span>
                      <span className="font-bold text-slate-800">{p.insurer_name || "Not available"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Policy Version</span>
                      <span className="font-medium text-slate-700">{p.product_version || "Not available"}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Published Premium</span>
                      <span className="font-bold text-slate-900">{pricingText}</span>
                    </div>
                  </div>

                  <div className="mb-4">
                    <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1.5">
                      Target Eligibility
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {p.target_users && p.target_users.length > 0 ? (
                        p.target_users.map((u, i) => (
                          <span
                            key={i}
                            className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium"
                          >
                            {u}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400">Not available</span>
                      )}
                    </div>
                  </div>

                  {p.benefits && p.benefits.length > 0 && (
                    <div className="mb-4">
                      <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1.5">
                        Listed Benefits (Catalog)
                      </span>
                      <ul className="text-xs text-slate-700 space-y-1">
                        {p.benefits.slice(0, 3).map((b, idx) => (
                          <li key={idx} className="flex justify-between gap-2">
                            <span>{b.benefit_name || "Not available"}</span>
                            <span className="font-semibold text-slate-900">
                              {b.limit ? `${b.currency || ""} ${b.limit}`.trim() : "Not available"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {p.exclusions && p.exclusions.length > 0 && (
                    <div className="mb-4">
                      <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1.5">
                        Key Exclusions & Waiting Periods
                      </span>
                      <ul className="text-xs text-slate-600 space-y-1">
                        {p.exclusions.slice(0, 2).map((ex, idx) => (
                          <li key={idx}>
                            {ex.excluded_event || "Not available"}
                            {ex.waiting_period_days != null ? ` (${ex.waiting_period_days}d wait)` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {p.provenance_note && (
                    <p className="text-[11px] text-slate-500 italic mb-3">
                      {p.provenance_note}
                    </p>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  {isVerifiedOfficial ? (
                    <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                      <ShieldCheck size={14} /> Verified Official Source
                    </span>
                  ) : (
                    <span
                      className="text-xs text-amber-700 font-semibold flex items-center gap-1"
                      data-testid="unverified-product-badge"
                    >
                      <AlertCircle size={14} /> Curated · Unverified
                    </span>
                  )}
                  {p.source_url ? (
                    <a
                      href={p.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-teal-700 font-semibold hover:underline flex items-center gap-1"
                    >
                      Source Link <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">Source not available</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
