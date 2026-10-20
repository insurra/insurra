"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Info,
  RefreshCw,
  Scale,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getWorkflowHeaders, getWorkflowUrl } from "@/lib/api/workflow-client";

interface StatutoryScheme {
  scheme_id: string;
  name: string;
  category: string;
  coverage_scope: string;
  eligibility: string;
  mandatory_status: string;
  official_reference: string;
}

interface GroupProduct {
  product_id: string;
  name: string;
  insurer_id: string;
  coverage_territory: string;
  published_pricing?: string | null;
}

interface CoordinationPrinciples {
  statutory_role: string;
  employer_supplementary_role: string;
  personal_commercial_role: string;
  coordination_rule: string;
  notice: string;
}

interface EmployerBenefitsOverview {
  country_code: string;
  statutory_schemes: StatutoryScheme[];
  group_catalog_products: GroupProduct[];
  coordination_principles: CoordinationPrinciples;
  recommended_documentation: string[];
}

export default function EmployerBenefitsPage() {
  const { token: accountToken } = useAuth();
  const [country, setCountry] = useState<string>("CN");
  const [data, setData] = useState<EmployerBenefitsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getWorkflowHeaders(accountToken);
      const res = await fetch(getWorkflowUrl(`/api/v1/workflow/employer-benefits/overview?country_code=${country}`), { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result: EmployerBenefitsOverview = await res.json();
      setData(result);
    } catch (err) {
      console.error("Error loading employer benefits:", err);
    } finally {
      setLoading(false);
    }
  }, [country, accountToken]);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 text-slate-900">
      {/* Heading */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">
            Employer & Statutory Health Benefits
          </h1>
          <p className="text-sm text-slate-500">
            Understand how your employer group health plan coordinates with statutory social security (UEBMI / BPJS).
          </p>
        </div>

        {/* Country Selector */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCountry("CN")}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
              country === "CN" ? "bg-teal-700 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            China (CN)
          </button>
          <button
            type="button"
            onClick={() => setCountry("ID")}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
              country === "ID" ? "bg-teal-700 text-white shadow" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Indonesia (ID)
          </button>
        </div>
      </div>

      {loading && (
        <div className="py-20 text-center text-slate-400">
          <RefreshCw className="animate-spin inline-block text-teal-700 mb-2" size={28} />
          <p className="text-sm">Loading verified benefits coordination rules...</p>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-8">
          {/* Section 1: Coordination of Benefits (COB) Principles */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4 text-teal-800">
              <Scale size={22} />
              <h2 className="text-lg font-bold text-slate-900">
                Benefit Coordination Principles ({country})
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <span className="text-[11px] font-bold text-teal-800 uppercase block mb-1">
                  1. Statutory Social Security
                </span>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {data.coordination_principles.statutory_role}
                </p>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <span className="text-[11px] font-bold text-indigo-800 uppercase block mb-1">
                  2. Employer Supplementary Plan
                </span>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {data.coordination_principles.employer_supplementary_role}
                </p>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <span className="text-[11px] font-bold text-sky-800 uppercase block mb-1">
                  3. Individual Commercial Cover
                </span>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {data.coordination_principles.personal_commercial_role}
                </p>
              </div>
            </div>

            <div className="p-4 bg-teal-50/70 rounded-xl border border-teal-200 text-xs text-teal-900 flex items-start gap-3">
              <Info size={18} className="text-teal-700 flex-shrink-0 mt-0.5" />
              <div>
                <strong>Coordination Rule Notice:</strong> {data.coordination_principles.coordination_rule}
              </div>
            </div>
          </div>

          {/* Section 2: Statutory Social Security Schemes */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4 text-slate-800">
              <Building2 size={22} className="text-teal-700" />
              <h2 className="text-lg font-bold text-slate-900">
                Statutory Social Insurance Schemes
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.statutory_schemes.map((scheme) => (
                <div key={scheme.scheme_id} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-slate-900 text-sm">{scheme.name || scheme.scheme_id}</h3>
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                      {scheme.mandatory_status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mb-2 leading-relaxed">
                    {scheme.coverage_scope}
                  </p>
                  <div className="text-[11px] text-slate-500 font-medium">
                    Eligibility: {scheme.eligibility}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Recommended Claim Documentation */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              Required Documentation for Multi-Plan Claims
            </h2>
            <ul className="space-y-2 text-xs text-slate-700">
              {data.recommended_documentation.map((doc, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-teal-700 flex-shrink-0" />
                  <span>{doc}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
