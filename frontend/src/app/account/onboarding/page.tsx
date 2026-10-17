"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Profile = components["schemas"]["ProfileData"];
type Consent = components["schemas"]["PurposeConsent"];
type Setup = components["schemas"]["AccountSetup"];
type Purpose = components["schemas"]["ConsentPurpose"];
type QuestionId =
  | "country" | "name" | "city" | "occupation" | "workplace" | "dependents"
  | "arrival" | "visa" | "priorities" | "coverage" | "budget"
  | "process_documents" | "external_ai" | "retention" | "review";
type Turn = { prompt: string; answer: string };

const steps = ["Context", "About You", "Situation", "Coverage", "Consent", "Review"];
const initialProfile: Profile = {
  display_name: "",
  residence_context: "ABROAD",
  country_code: "AU",
  city: "",
  occupation: "STUDENT",
  dependents: [],
  owned_coverage: [],
  priorities: [],
  budget_range: null,
  currency: "AUD",
  arrival_date: null,
  visa_expiry_date: null,
};
const questionCopy: Record<QuestionId, string> = {
  country: "Where are you mainly living or arranging coverage?",
  name: "What name should I use when we talk?",
  city: "Which city are you based in? You can skip this.",
  occupation: "Which best describes what you do right now?",
  workplace: "Where do you study or work?",
  dependents: "Will anyone else rely on this coverage with you?",
  arrival: "When did you arrive, or when will you arrive? This is optional.",
  visa: "When does your visa end? This is optional.",
  priorities: "What would you most like help understanding? Choose up to two.",
  coverage: "Do you already have any insurance or public coverage?",
  budget: "Would you like to add a budget range? This is optional.",
  process_documents: "May Insurra process documents you choose to upload?",
  external_ai: "May sanitized document text be sent to external AI services?",
  retention: "Would you like original uploaded files to be retained?",
  review: "Here is the profile I understood. Ready to continue?",
};
function questionGroup(question: QuestionId): number {
  if (question === "country") return 0;
  if (["name", "city", "occupation"].includes(question)) return 1;
  if (["workplace", "dependents", "arrival", "visa"].includes(question)) return 2;
  if (["priorities", "coverage", "budget"].includes(question)) return 3;
  if (["process_documents", "external_ai", "retention"].includes(question)) return 4;
  return 5;
}

export default function AccountOnboarding() {
  const { account, token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [history, setHistory] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const questions = useMemo<QuestionId[]>(() => {
    const common: QuestionId[] = ["country", "name", "city", "occupation", "workplace", "dependents"];
    if (profile.country_code === "AU") common.push("arrival", "visa");
    return [...common, "priorities", "coverage", "budget", "process_documents", "external_ai", "retention", "review"];
  }, [profile.country_code]);
  const activeQuestion = questions[Math.min(questionIndex, questions.length - 1)];
  const group = questionGroup(activeQuestion);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      api.request("get", "/api/v1/account/profile", { headers }),
      api.request("get", "/api/v1/account/consents", { headers }),
    ])
      .then(([state, grants]) => {
        if (!active) return;
        const draft = (state.profile ?? state.draft) as Partial<Profile>;
        setProfile({ ...initialProfile, ...draft, display_name: draft.display_name ?? account?.display_name ?? "" });
        setConsents(grants.consents);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Account profile could not be loaded.");
      });
    return () => { active = false; };
  }, [token, account?.display_name]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api.request("get", "/api/v1/account/setup/{country_code}", {
      params: { country_code: profile.country_code },
      headers: { Authorization: `Bearer ${token}` },
    }).then((value) => {
      if (active) setSetup(value);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Country configuration unavailable.");
    });
    return () => { active = false; };
  }, [token, profile.country_code]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [questionIndex]);

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function answerFor(id: QuestionId, profileValue = profile, consentValues = consents): string {
    switch (id) {
      case "country": return profileValue.country_code === "ID" ? "Indonesia" : "Australia";
      case "name": return profileValue.display_name || "Name not provided";
      case "city": return profileValue.city || "Skip for now";
      case "occupation": return profileValue.occupation === "STUDENT" ? "Student" : profileValue.occupation === "EMPLOYEE" ? "Professional" : "Other";
      case "workplace": return (profileValue.occupation === "STUDENT" ? profileValue.institution_name : profileValue.employment_status) || "Not provided";
      case "dependents": return `${(profileValue.dependents ?? []).length} dependents`;
      case "arrival": return profileValue.arrival_date || "Skip for now";
      case "visa": return profileValue.visa_expiry_date || "Skip for now";
      case "priorities": return (profileValue.priorities ?? []).join(", ") || "No preference selected";
      case "coverage": return (profileValue.owned_coverage ?? []).join(", ") || "No existing coverage listed";
      case "budget": return profileValue.budget_range || "Skip for now";
      case "process_documents":
      case "external_ai":
      case "retention": return consentValues.find((item) => item.purpose === id)?.granted ? "Yes, allow this" : "No, keep this off";
      case "review": return "Profile confirmed";
    }
  }

  async function setConsent(purpose: Purpose, granted: boolean) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.request("post", "/api/v1/account/consents", {
        headers: { Authorization: `Bearer ${token}` },
        body: { purpose, granted, policy_version: "1.5" },
      });
      setConsents(result.consents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consent state could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function sendAnswer(profileValue = profile) {
    if (!token) return;
    setError(null);
    if (activeQuestion === "name" && !profileValue.display_name.trim()) {
      setError("Please enter your name before continuing.");
      return;
    }
    setBusy(true);
    try {
      if (activeQuestion === "review") {
        await api.request("put", "/api/v1/account/profile/draft", {
          headers: { Authorization: `Bearer ${token}` }, body: profileValue,
        });
        await api.request("put", "/api/v1/account/profile", {
          headers: { Authorization: `Bearer ${token}` }, body: profileValue,
        });
        router.push("/account");
        return;
      }
      await api.request("put", "/api/v1/account/profile/draft", {
        headers: { Authorization: `Bearer ${token}` }, body: profileValue,
      });
      setHistory((current) => [...current, { prompt: questionCopy[activeQuestion], answer: answerFor(activeQuestion, profileValue) }]);
      setQuestionIndex((current) => Math.min(current + 1, questions.length - 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Progress could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (questionIndex < 1) return;
    setQuestionIndex((current) => current - 1);
    setHistory((current) => current.slice(0, -1));
  }

  function skipQuestion() {
    const clearedProfile = { ...profile };
    if (activeQuestion === "city") clearedProfile.city = null;
    if (activeQuestion === "arrival") clearedProfile.arrival_date = null;
    if (activeQuestion === "visa") clearedProfile.visa_expiry_date = null;
    if (activeQuestion === "budget") clearedProfile.budget_range = null;
    if (activeQuestion === "coverage") clearedProfile.owned_coverage = [];
    if (activeQuestion === "workplace") {
      if (profile.occupation === "STUDENT") clearedProfile.institution_name = null;
      else clearedProfile.employment_status = null;
    }
    setProfile(clearedProfile);
    void sendAnswer(clearedProfile);
  }

  if (authLoading) return <div className="journey-onboarding-loading" role="status">Checking account session…</div>;
  if (!account || !token) {
    return (
      <main className="journey-onboarding-gate">
        <Image src="/mascot-logo.png" alt="Insurra" width={160} height={70} />
        <h1>Sign in to start your coverage journey.</h1>
        <p>Your answers will be saved securely as you go.</p>
        <Button asChild><Link href="/auth">Sign in or register <ArrowRight size={16} /></Link></Button>
      </main>
    );
  }

  const occupationName = profile.occupation === "STUDENT" ? "Student" : profile.occupation === "EMPLOYEE" ? "Professional" : "Other";
  const currentConsent = activeQuestion === "review" ? undefined : consents.find((item) => item.purpose === activeQuestion);
  const isConsentQuestion = ["process_documents", "external_ai", "retention"].includes(activeQuestion);

  return (
    <main className="journey-onboarding-page journey-chat-page">
      <header className="journey-chat-topbar">
        <Link href="/" className="journey-chat-logo" aria-label="Insurra home">
          <Image src="/mascot-logo.png" alt="Insurra" width={150} height={66} priority />
        </Link>
        <div className="journey-chat-stepper" aria-label={`Step ${group + 1} of 6`}>
          {steps.map((label, index) => (
            <span key={label} className={group === index ? "current" : group > index ? "done" : ""}>
              <i>{group > index ? <Check size={12} /> : index + 1}</i><small>{label}</small>
            </span>
          ))}
        </div>
        <Link href="/account" className="journey-chat-exit">Save &amp; exit</Link>
      </header>

      <section className="journey-chat-layout">
        <aside className="journey-chat-art" aria-label="Insurra travel companion">
          <Image src="/onboarding-traveler.png" alt="Traveler with a teal backpack and luggage at an airport" fill sizes="(max-width: 1100px) 0px, 38vw" priority />
          <div className="journey-chat-art-shade" />
          <div className="journey-chat-art-quote">
            <Sparkles size={21} aria-hidden="true" />
            <span>Let&apos;s make your<br />coverage work for you.</span>
          </div>
          <div className="journey-chat-art-copy"><span>INSURRA COMPANION</span><strong>One small step toward more clarity.</strong></div>
          <div className="journey-chat-art-note"><ShieldCheck size={19} /><span><b>Private by design</b>Your choices stay in your control.</span></div>
        </aside>

        <section className="journey-conversation" aria-label="Onboarding conversation">
          <div className="journey-conversation-heading">
            <span>YOUR COVERAGE JOURNEY</span>
            <h1>Let&apos;s get to know your situation.</h1>
            <p>A few quick questions. Skip anything optional.</p>
          </div>

          <div className="journey-message-list" aria-live="polite">
            <div className="journey-bot-message opening">
              <Image src="/mascot-bubble.png" alt="" width={48} height={52} />
              <p>Hi{profile.display_name ? ` ${profile.display_name}` : ""}! I&apos;m Insurra. I&apos;ll ask one thing at a time, and you can change your answers later.</p>
            </div>
            {history.map((turn, index) => (
              <div className="journey-chat-turn" key={`${index}-${turn.prompt}`}>
                <div className="journey-bot-message compact"><Image src="/mascot-bubble.png" alt="" width={34} height={38} /><p>{turn.prompt}</p></div>
                <div className="journey-user-message"><span>{turn.answer}</span></div>
              </div>
            ))}
            <div className="journey-bot-message active" ref={bottomRef}>
              <Image src="/mascot-bubble.png" alt="" width={48} height={52} />
              <p>{questionCopy[activeQuestion]}</p>
            </div>
          </div>

          <div className="journey-reply-area">
            {activeQuestion === "country" && (
              <div className="journey-reply-choices two">
                {([ ["AU", "Australia", "Living, studying, or working abroad"], ["ID", "Indonesia", "Domestic coverage and BPJS context"] ] as const).map(([code, title, detail]) => (
                  <button type="button" key={code} className={profile.country_code === code ? "selected" : ""} onClick={() => setProfile((current) => ({ ...current, country_code: code, residence_context: code === "ID" ? "DOMESTIC" : "ABROAD", currency: code === "ID" ? "IDR" : "AUD", city: null, arrival_date: null, visa_expiry_date: null, budget_range: null }))}>
                    <b>{title}</b><small>{detail}</small>{profile.country_code === code && <Check size={16} />}
                  </button>
                ))}
              </div>
            )}
            {activeQuestion === "name" && <label className="journey-reply-field"><span>Your name</span><input autoFocus value={profile.display_name} maxLength={100} onChange={(event) => update("display_name", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendAnswer(); }} placeholder="Type your name" /></label>}
            {activeQuestion === "city" && <label className="journey-reply-field"><span>City</span><input autoFocus value={profile.city ?? ""} onChange={(event) => update("city", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendAnswer(); }} placeholder="e.g. Melbourne or Jakarta" /></label>}
            {activeQuestion === "occupation" && <div className="journey-reply-choices three">{([ ["STUDENT", "Student"], ["EMPLOYEE", "Professional"], ["OTHER", "Other"] ] as const).map(([value, label]) => <button type="button" key={value} className={profile.occupation === value ? "selected" : ""} onClick={() => update("occupation", value)}>{label}{profile.occupation === value && <Check size={15} />}</button>)}</div>}
            {activeQuestion === "workplace" && <label className="journey-reply-field"><span>{profile.occupation === "STUDENT" ? "School or institution" : "Employer"}</span><input autoFocus value={profile.occupation === "STUDENT" ? profile.institution_name ?? "" : profile.employment_status ?? ""} onChange={(event) => update(profile.occupation === "STUDENT" ? "institution_name" : "employment_status", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendAnswer(); }} placeholder={profile.occupation === "STUDENT" ? "e.g. University of Melbourne" : "e.g. Company name"} /></label>}
            {activeQuestion === "dependents" && <div className="journey-reply-choices four">{[0, 1, 2, 3].map((count) => <button type="button" key={count} className={(profile.dependents ?? []).length === count ? "selected" : ""} onClick={() => update("dependents", Array.from({ length: count }, (_, index) => `Dependent ${index + 1}`))}>{count === 0 ? "Just me" : count === 3 ? "3+ people" : `${count} ${count === 1 ? "person" : "people"}`}</button>)}</div>}
            {(activeQuestion === "arrival" || activeQuestion === "visa") && <label className="journey-reply-field"><span>{activeQuestion === "arrival" ? "Arrival date" : "Visa expiry date"}</span><input type="date" value={activeQuestion === "arrival" ? profile.arrival_date ?? "" : profile.visa_expiry_date ?? ""} onChange={(event) => update(activeQuestion === "arrival" ? "arrival_date" : "visa_expiry_date", event.target.value || null)} /></label>}
            {activeQuestion === "priorities" && <div className="journey-reply-choices two">{["Medical Expenses", "GP Visits", "Hospital Inpatient", "Claim Guidance", "Visa Compliance", "Family Protection"].map((item) => { const selected = (profile.priorities ?? []).includes(item); return <button type="button" key={item} className={selected ? "selected" : ""} onClick={() => update("priorities", selected ? (profile.priorities ?? []).filter((value) => value !== item) : [...(profile.priorities ?? []), item].slice(-2))}>{item}{selected && <Check size={15} />}</button>; })}</div>}
            {activeQuestion === "coverage" && <label className="journey-reply-field"><span>Current coverage (optional)</span><input autoFocus value={(profile.owned_coverage ?? []).join(", ")} onChange={(event) => update("owned_coverage", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} onKeyDown={(event) => { if (event.key === "Enter") void sendAnswer(); }} placeholder="e.g. OSHC, BPJS, or employer plan" /></label>}
            {activeQuestion === "budget" && <label className="journey-reply-field"><span>Budget range (optional)</span><input autoFocus value={profile.budget_range ?? ""} onChange={(event) => update("budget_range", event.target.value || null)} onKeyDown={(event) => { if (event.key === "Enter") void sendAnswer(); }} placeholder="Type a range, or skip" /></label>}
            {isConsentQuestion && <div className="journey-reply-choices two consent">{([ [true, "Yes, allow this"], [false, "No, keep this off"] ] as const).map(([granted, label]) => <button type="button" key={String(granted)} disabled={busy} className={currentConsent?.granted === granted || (!currentConsent && !granted) ? "selected" : ""} onClick={() => void setConsent(activeQuestion as Purpose, granted)}>{label}{(currentConsent?.granted === granted || (!currentConsent && !granted)) && <Check size={15} />}</button>)}</div>}
            {activeQuestion === "review" && <div className="journey-review-bubble"><span><small>Country</small><b>{setup?.country_label ?? (profile.country_code === "ID" ? "Indonesia" : "Australia")}</b></span><span><small>Name</small><b>{profile.display_name || "Not provided"}</b></span><span><small>Situation</small><b>{occupationName}{profile.city ? ` · ${profile.city}` : ""}</b></span><span><small>Priorities</small><b>{(profile.priorities ?? []).join(", ") || "None selected"}</b></span><span><small>Permissions enabled</small><b>{consents.filter((item) => item.granted).length} of 3</b></span></div>}
            {error && <div className="alert error" role="alert">{error}</div>}
            <div className="journey-reply-actions">
              <button type="button" className="journey-back-answer" disabled={busy || questionIndex === 0} onClick={goBack}><ArrowLeft size={15} /> Back</button>
              <div>
                {["city", "arrival", "visa", "coverage", "budget", "workplace"].includes(activeQuestion) && <button type="button" className="journey-skip-answer" disabled={busy} onClick={skipQuestion}>Skip</button>}
                <Button disabled={busy} onClick={() => void sendAnswer()}>{busy ? "Saving…" : activeQuestion === "review" ? "Create profile" : "Send"}<ArrowRight size={15} /></Button>
              </div>
            </div>
          </div>
          <p className="journey-chat-privacy"><LockKeyhole size={13} /> Your answers are saved securely as you go.</p>
        </section>
      </section>
    </main>
  );
}
