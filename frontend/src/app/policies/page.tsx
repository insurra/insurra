"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  ExternalLink,
  FileText,
  Filter,
  Shield,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type PolicySummary = components["schemas"]["AccountPolicySummary"];
type PolicyDetail = components["schemas"]["AccountPolicyDetail"];

export default function PoliciesPage() {
  const { account, token, loading } = useAuth();
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [policyDetail, setPolicyDetail] = useState<PolicyDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPolicies = useCallback(async () => {
    if (!token) return;
    try {
      const list = await api.request("get", "/api/v1/account/policies", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPolicies(list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load policies.");
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(refreshPolicies);
  }, [refreshPolicies]);

  async function openPolicy(id: string) {
    if (!token) return;
    setSelectedPolicyId(id);
    setLoadingDetail(true);
    setPolicyDetail(null);
    try {
      const detail = await api.request("get", "/api/v1/account/policies/{policy_id}", {
        params: { policy_id: id },
        headers: { Authorization: `Bearer ${token}` },
      });
      setPolicyDetail(detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load policy details.");
    } finally {
      setLoadingDetail(false);
    }
  }

  if (loading) return <p role="status">Checking account session...</p>;
  if (!account || !token) {
    return (
      <div className="card account-empty">
        <h1>Sign in to view your Policy Wallet.</h1>
        <Button asChild>
          <Link href="/auth">Sign In or Register</Link>
        </Button>
      </div>
    );
  }

  const types = Array.from(new Set(policies.map((p) => p.kind)));
  const filteredPolicies = policies.filter((policy) => {
    const matchesType = filterType === "ALL" || policy.kind === filterType;
    const searchable = `${policy.provider ?? ""} ${policy.kind} ${policy.country_code}`.toLowerCase();
    return matchesType && searchable.includes(query.trim().toLowerCase());
  });

  return (
    <div className="policy-wallet-page protection-screen">
      <nav aria-label="Breadcrumb" className="protection-breadcrumb">
        <Link href="/protection">My Protection</Link>
        <ChevronRight size={14} className="breadcrumb-separator" />
        <span aria-current="page">Policy Wallet</span>
      </nav>

      <div className="page-heading">
        <div>
          <div className="eyebrow">PERSONAL COVERAGE</div>
          <h1>Policy Wallet</h1>
          <p>Manage insurance policies and review detailed clauses extracted from your uploaded documents.</p>
        </div>
        <div className="policy-heading-actions">
          <Wallet size={34} />
          <Button asChild>
            <Link href="/documents">
              <FileText size={16} /> Add Policy
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div className="policy-controls card">
        <div className="filter-group">
          <Filter size={18} />
          <span>Filter by Coverage Type:</span>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="ALL">All Coverages ({policies.length})</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <label className="policy-search">
          <span className="sr-only">Search policies</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search provider or coverage type..."
          />
        </label>
      </div>

      {!policies.length ? (
        <div className="card account-empty">
          <Shield size={40} />
          <h2>No policies in wallet yet</h2>
          <p>
            Upload a booklet, policy schedule, or insurance card in Documents to inspect extracted benefits and limits.
          </p>
          <Button asChild>
            <Link href="/documents">
              Upload Document <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
      ) : (
        filteredPolicies.length === 0 ? (
          <div className="card account-empty">
            <h2>No matching policies found</h2>
            <p>Try searching with another keyword or selecting a different coverage filter.</p>
          </div>
        ) : (
          <div className="policy-grid">
            {filteredPolicies.map((policy) => {
              const statusClass =
                policy.status === "ACTIVE"
                  ? "status-active"
                  : policy.status === "EXPIRING_SOON"
                  ? "status-expiring"
                  : "status-expired";
              return (
                <article key={policy.id} className={`card policy-card ${selectedPolicyId === policy.id ? "selected" : ""}`}>
                  <div className="policy-card-header">
                    <div>
                      <span className="policy-kind-tag">{policy.kind.replaceAll("_", " ")} · {policy.country_code}</span>
                      <h3>{policy.provider || "Unidentified Provider"}</h3>
                    </div>
                    <span className={`badge ${statusClass}`}>
                      {policy.status.replaceAll("_", " ")}
                    </span>
                  </div>

                  <div className="policy-card-body">
                    <div className="policy-meta-row">
                      <span>Policy Number:</span>
                      <strong>{policy.policy_number_masked || "Not found in document"}</strong>
                    </div>
                    <div className="policy-meta-row">
                      <span>Country:</span>
                      <strong>{policy.country_code}</strong>
                    </div>
                    <div className="policy-meta-row">
                      <span>Coverage Period:</span>
                      <strong>
                        {policy.start_date || "Unknown"} to {policy.end_date || "Unknown"}
                      </strong>
                    </div>
                  </div>

                  <div className="policy-card-footer">
                    <Button size="sm" onClick={() => selectedPolicyId === policy.id ? setSelectedPolicyId(null) : void openPolicy(policy.id)}>
                      {selectedPolicyId === policy.id ? "Close details" : "Review details"} <ArrowRight size={14} />
                    </Button>
                    {policy.document_id && (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/documents/${policy.document_id}`}>
                          Source Doc <ExternalLink size={13} />
                        </Link>
                      </Button>
                    )}
                  </div>

                  {selectedPolicyId === policy.id && (
                    <div className="policy-inline-detail">
                      {loadingDetail ? (
                        <p role="status">Loading policy clauses and evidence...</p>
                      ) : policyDetail ? (
                        <>
                          <div className="policy-detail-caption">
                            <Shield size={18} />
                            <strong>Document Evidence Summary</strong>
                          </div>
                          <p>
                            Information below is extracted from your document evidence and should be verified against original sources.
                          </p>
                          <div className="policy-inline-facts">
                            {(policyDetail.benefits ?? []).length ? (
                              policyDetail.benefits!.map((benefit, index) => (
                                <div key={index}>
                                  <span>{String(benefit.field_key).replaceAll("_", " ")}</span>
                                  <strong>{String(benefit.value)}</strong>
                                  {benefit.source_page ? <small>Source: Page {String(benefit.source_page)}</small> : null}
                                </div>
                              ))
                            ) : (
                              <small>No specific benefits or limits identified in document yet.</small>
                            )}
                          </div>
                          <div className="policy-inline-facts">
                            <div>
                              <span>Exclusions</span>
                              <strong>{policyDetail.exclusions?.length ? policyDetail.exclusions.join(" · ") : "None found"}</strong>
                            </div>
                            <div>
                              <span>Waiting periods</span>
                              <strong>{policyDetail.waiting_periods?.length ? policyDetail.waiting_periods.join(" · ") : "None found"}</strong>
                            </div>
                          </div>
                          {policyDetail.country_code === "ID" && (
                            <small>BPJS Coordination (KAPJ): {policyDetail.bpjs_coordination ?? "Unknown"}</small>
                          )}
                          <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #dfeee9" }}>
                            <Button asChild variant="outline" size="sm">
                              <Link href="/documents">
                                Correct Information in Documents <ArrowRight size={13} />
                              </Link>
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p>Policy details not available.</p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
