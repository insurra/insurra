"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  FileText,
  Filter,
  Info,
  Shield,
  Wallet,
  X,
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

  function closePolicy() {
    setSelectedPolicyId(null);
    setPolicyDetail(null);
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
  const filteredPolicies =
    filterType === "ALL" ? policies : policies.filter((p) => p.kind === filterType);

  return (
    <div className="policy-wallet-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">POLICY WALLET</div>
          <h1>My Protection & Policies</h1>
          <p>
            Structured record of your verified insurance policies, coverage validity, and benefit limits.
          </p>
        </div>
        <Wallet size={40} />
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
        <Button asChild variant="outline">
          <Link href="/documents">
            <FileText size={16} /> Upload New Policy Document
          </Link>
        </Button>
      </div>

      {!policies.length ? (
        <div className="card account-empty">
          <Shield size={40} />
          <h2>No policies in wallet yet.</h2>
          <p>
            Upload your insurance booklet, certificate of insurance, or health card to populate your wallet.
          </p>
          <Button asChild>
            <Link href="/documents">
              Upload Document <ArrowRight size={16} />
            </Link>
          </Button>
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
              <article key={policy.id} className="card policy-card">
                <div className="policy-card-header">
                  <div>
                    <span className="policy-kind-tag">{policy.kind.replaceAll("_", " ")}</span>
                    <h3>{policy.provider || "Insurance Provider Unspecified"}</h3>
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
                  <Button size="sm" onClick={() => void openPolicy(policy.id)}>
                    View Policy Details <ArrowRight size={14} />
                  </Button>
                  {policy.document_id && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/documents/${policy.document_id}`}>
                        Source Doc <ExternalLink size={13} />
                      </Link>
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedPolicyId && (
        <div className="policy-modal-overlay" onClick={closePolicy}>
          <div className="policy-modal-content card" onClick={(e) => e.stopPropagation()}>
            <div className="policy-modal-header">
              <div>
                <span className="eyebrow">DETAILED COVERAGE RECORD</span>
                <h2>{policyDetail?.provider || "Policy Details"}</h2>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={closePolicy}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {loadingDetail ? (
              <p role="status">Loading policy clauses and benefit limits...</p>
            ) : policyDetail ? (
              <div className="policy-modal-body">
                <div className="policy-summary-strip">
                  <div>
                    <span>Type:</span>
                    <strong>{policyDetail.kind.replaceAll("_", " ")}</strong>
                  </div>
                  <div>
                    <span>Policy Number:</span>
                    <strong>{policyDetail.policy_number_masked || "Not found in document"}</strong>
                  </div>
                  <div>
                    <span>Validity:</span>
                    <strong>
                      {policyDetail.start_date || "Unknown"} to {policyDetail.end_date || "Unknown"}
                    </strong>
                  </div>
                  <div>
                    <span>Status:</span>
                    <strong className="capitalize">{policyDetail.status.toLowerCase()}</strong>
                  </div>
                </div>

                {policyDetail.country_code === "ID" && (
                  <div className="alert info">
                    <Info size={16} />
                    Coordination with BPJS (KAPJ): {policyDetail.bpjs_coordination}
                  </div>
                )}

                {(() => {
                  const benefits = policyDetail.benefits ?? [];
                  const exclusions = policyDetail.exclusions ?? [];
                  const waitingPeriods = policyDetail.waiting_periods ?? [];
                  const sourcePages = policyDetail.source_pages ?? [];

                  return (
                    <>
                      <section className="policy-detail-section">
                        <h3>Benefits & Limit Information</h3>
                        {!benefits.length ? (
                          <p className="empty-subtext">
                            Not found in document. Benefits may be specified in a separate policy booklet.
                          </p>
                        ) : (
                          <div className="benefits-table">
                            {benefits.map((b, i) => (
                              <div key={i} className="benefit-row">
                                <span>{String(b.field_key).replaceAll("_", " ")}</span>
                                <strong>{String(b.value)}</strong>
                                {b.source_page ? (
                                  <small>Page {String(b.source_page)}</small>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="policy-detail-section">
                        <h3>Exclusions & Restrictions</h3>
                        {!exclusions.length ? (
                          <p className="empty-subtext">
                            Not found in document. Specific exclusions require manual booklet inspection.
                          </p>
                        ) : (
                          <ul className="exclusions-list">
                            {exclusions.map((ex, i) => (
                              <li key={i}>{ex}</li>
                            ))}
                          </ul>
                        )}
                      </section>

                      <section className="policy-detail-section">
                        <h3>Waiting Periods</h3>
                        {!waitingPeriods.length ? (
                          <p className="empty-subtext">
                            Not found in document. Waiting periods are typically 12 months for pre-existing conditions.
                          </p>
                        ) : (
                          <ul className="waiting-periods-list">
                            {waitingPeriods.map((wp, i) => (
                              <li key={i}>{wp}</li>
                            ))}
                          </ul>
                        )}
                      </section>

                      {sourcePages.length > 0 && (
                        <div className="policy-source-pages">
                          <FileText size={16} />
                          <span>Evidence verified from source pages: {sourcePages.join(", ")}</span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
