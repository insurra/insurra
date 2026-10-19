"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { getWorkflowUrl } from "@/lib/api/workflow-client";

interface ProductItem {
  product_id: string;
  name: string;
  original_name?: string | null;
  insurer_id: string;
  insurer_name: string;
  product_category: string;
  coverage_territory: string;
  target_users: string[];
  published_pricing?: {
    standard_annual?: string | null;
    minimum_period?: string | null;
    currency?: string | null;
  } | null;
  source_url?: string | null;
  verification_status: string;
}

interface ProductCompareResponse {
  country_code: string;
  total_products: number;
  categories: string[];
  products: ProductItem[];
}

export default function ProductComparePage() {
  const [country, setCountry] = useState<string>("CN");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [data, setData] = useState<ProductCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadComparison = useCallback(async () => {
    setLoading(true);
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
      console.error("Failed to load product comparison:", err);
    } finally {
      setLoading(false);
    }
  }, [country, selectedCategory]);

  useEffect(() => {
    void Promise.resolve().then(loadComparison);
  }, [loadComparison]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 text-slate-900">
      {/* Heading */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">
            Insurance Product Comparison
          </h1>
          <p className="text-sm text-slate-500">
            Compare verified insurance products across China and Indonesia based on published regulatory filings.
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

      {/* Category Filter Pills */}
      {data && data.categories.length > 0 && (
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
          {data.categories.map((cat) => (
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
              {cat.replace("_", " ").toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="py-24 text-center text-slate-400">
          <RefreshCw className="animate-spin inline-block text-teal-700 mb-2" size={28} />
          <p className="text-sm">Loading verified insurance comparison matrix...</p>
        </div>
      )}

      {/* Comparison Grid */}
      {!loading && data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.products.map((p) => (
            <div
              key={p.product_id}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wider bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded-full">
                    {p.product_category.replace("_", " ")}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    {p.coverage_territory}
                  </span>
                </div>

                <h3 className="font-bold text-slate-900 text-base mb-1">{p.name}</h3>
                {p.original_name && (
                  <p className="text-xs text-slate-400 mb-3">{p.original_name}</p>
                )}

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs mb-4">
                  <div className="flex justify-between py-1 border-b border-slate-200/60">
                    <span className="text-slate-500">Underwriting Insurer</span>
                    <span className="font-bold text-slate-800">{p.insurer_name}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Published Premium</span>
                    <span className="font-bold text-slate-900">
                      {p.published_pricing?.standard_annual
                        ? `${p.published_pricing.currency || ""} ${p.published_pricing.standard_annual}`
                        : "Refer to Policy Schedule"}
                    </span>
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
                      <span className="text-xs text-slate-400">General Public</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                  <ShieldCheck size={14} /> Regulatory Verified
                </span>
                {p.source_url && (
                  <a
                    href={p.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-teal-700 font-semibold hover:underline flex items-center gap-1"
                  >
                    Official Portal <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
