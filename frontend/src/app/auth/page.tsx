"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Eye,
  EyeOff,
  FileCheck2,
  LockKeyhole,
  Mail,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api/client";
import { safeRedirectPath } from "@/lib/safe-redirect";

const EMAIL_DELIVERY_NOTICE =
  "Email delivery is not configured on this server. Verification and reset emails cannot be sent.";

function EmailDeliveryNotice() {
  return (
    <div className="journey-alert warning" role="status" data-testid="email-delivery-notice">
      <ShieldAlert className="w-4 h-4 flex-none" />
      <span>{EMAIL_DELIVERY_NOTICE}</span>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <main className="journey-auth-page">
          <section className="journey-auth-panel">
            <p>Loading Inssura authentication...</p>
          </section>
        </main>
      }
    >
      <AuthContent />
    </Suspense>
  );
}

function AuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = safeRedirectPath(searchParams.get("redirect"), "/home");
  const actionParam = searchParams.get("action");
  const tokenParam = searchParams.get("token");

  const {
    account,
    googleLoginUrl,
    loginWithPassword,
    registerWithPassword,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    submitConsents,
  } = useAuth();

  // Primary mode: "login" (default) | "register" | "verify" | "forgot" | "reset"
  const initialMode = actionParam === "reset" && tokenParam ? "reset" : "login";
  const [mode, setMode] = useState<"login" | "register" | "verify" | "forgot" | "reset">(initialMode);

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // UI toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Status and error messages
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState<number | null>(null);

  // Verification cooldown (60 seconds)
  const [cooldown, setCooldown] = useState<number>(0);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string>("");
  const [otpCode, setOtpCode] = useState<string>("");

  // Consent Screen States (US-01-03)
  const [consentDocs, setConsentDocs] = useState(false);
  const [consentAi, setConsentAi] = useState(false);
  const [consentRetention, setConsentRetention] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);

  // Form IDs for accessibility
  const emailId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();
  const termsId = useId();

  // Email delivery is reported by the server; assume unavailable until it says otherwise.
  const [emailDelivery, setEmailDelivery] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .request("get", "/api/v1/auth/capabilities", {})
      .then((value) => {
        if (active) setEmailDelivery(value.email_delivery);
      })
      .catch(() => {
        if (active) setEmailDelivery(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Handle URL tokens for verification
  useEffect(() => {
    if (actionParam === "verify" && tokenParam) {
      verifyEmail(tokenParam).then((res) => {
        if (res.success) {
          setFormSuccess("Email verified successfully. Please log in.");
          setMode("login");
        } else {
          setFormError(res.error || "Invalid or expired verification token.");
          setMode("login");
        }
      });
    }
  }, [actionParam, tokenParam, verifyEmail]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  // Lockout countdown timer
  useEffect(() => {
    if (!lockoutRemaining || lockoutRemaining <= 0) return;
    const interval = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev === null || prev <= 1) return null;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutRemaining]);

  // Password validation & strength calculations (FR-02, FR-03, FR-04, FR-06)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isEmailValid = emailRegex.test(email.trim());
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const isPasswordValid = hasMinLength && hasLetter && hasNumber;
  const isConfirmMatch = password.length > 0 && password === passwordConfirm;

  // Strength calculation
  let strength: "weak" | "medium" | "strong" = "weak";
  if (password.length >= 8 && hasLetter && hasNumber) {
    const hasSymbol = /[^a-zA-Z0-9]/.test(password);
    const hasUpperAndLower = /[a-z]/.test(password) && /[A-Z]/.test(password);
    if (password.length >= 10 && hasSymbol && hasUpperAndLower) {
      strength = "strong";
    } else {
      strength = "medium";
    }
  }

  // Registration submit enabled only when all criteria valid (FR-08)
  const isRegisterFormValid =
    isEmailValid && isPasswordValid && isConfirmMatch && termsAccepted && !isSubmitting;

  // Login submit enabled check
  const isLoginFormValid = isEmailValid && password.length > 0 && !isSubmitting;

  // Route progression once authenticated & consent handled
  const handleProceedAfterAuth = useCallback(
    (consentDecided: boolean, profileCompleted: boolean) => {
      if (!consentDecided) return;
      if (profileCompleted) {
        router.replace(redirectTarget === "/onboarding" ? "/home" : redirectTarget);
      } else {
        router.replace("/onboarding");
      }
    },
    [redirectTarget, router],
  );

  // If already authenticated and consent is already decided, redirect immediately
  useEffect(() => {
    if (account && account.consent_decided) {
      handleProceedAfterAuth(account.consent_decided, account.profile_completed ?? false);
    }
  }, [account, handleProceedAfterAuth]);

  // Handle Log In submission
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setIsSubmitting(true);

    const result = await loginWithPassword(email.trim(), password);
    setIsSubmitting(false);

    if (result.success) {
      // Session active; consent check will handle next view or redirect
      return;
    }

    if (result.code === "EMAIL_NOT_VERIFIED") {
      setUnverifiedEmail(email.trim());
      setFormError("Please verify your email before logging in.");
      return;
    }

    if (result.code === "ACCOUNT_LOCKED") {
      const waitTime = result.retryAfter ?? 300;
      setLockoutRemaining(waitTime);
      setFormError(`Too many failed login attempts. Please try again in ${Math.ceil(waitTime / 60)} minutes.`);
      return;
    }

    setFormError("Invalid email or password.");
  };

  // Handle Register submission
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!isEmailValid) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (!hasMinLength) {
      setFormError("Password must contain at least 8 characters.");
      return;
    }
    if (!hasNumber) {
      setFormError("Include at least one number.");
      return;
    }
    if (!isConfirmMatch) {
      setFormError("Passwords do not match.");
      return;
    }
    if (!termsAccepted) {
      setFormError("You must agree to the Terms & Conditions and Privacy Policy.");
      return;
    }

    setIsSubmitting(true);
    const result = await registerWithPassword(email.trim(), password, passwordConfirm);
    setIsSubmitting(false);

    if (result.success) {
      setUnverifiedEmail(email.trim());
      setCooldown(60);
      setMode("verify");
    } else {
      if (result.code === "EMAIL_ALREADY_REGISTERED") {
        setFormError("This email is already registered.");
      } else {
        setFormError(result.error || "Failed to create account. Please try again.");
      }
    }
  };

  // Handle Resend Verification
  const handleResend = async () => {
    const targetEmail = unverifiedEmail || email.trim();
    if (!targetEmail) return;
    setFormError(null);
    const result = await resendVerification(targetEmail);
    if (result.success) {
      setCooldown(60);
      setFormSuccess(
        emailDelivery
          ? "Verification email resent. Please check your inbox."
          : "Request recorded. No email was sent because email delivery is not configured.",
      );
    } else {
      if (result.code === "COOLDOWN_ACTIVE" && result.retryAfter) {
        setCooldown(result.retryAfter);
      }
      setFormError(result.error || "Failed to resend verification email.");
    }
  };

  // Handle OTP Code Verification
  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otpCode.trim();
    if (!code) return;
    setIsSubmitting(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const targetEmail = unverifiedEmail || email.trim();
      const res = await verifyEmail(code, targetEmail || undefined);
      if (res.success) {
        setFormSuccess(res.message || "Email verified successfully! Please log in.");
        setTimeout(() => {
          setMode("login");
          setFormSuccess("Email verified successfully! Please log in with your password.");
        }, 1200);
      } else {
        setFormError(res.error || "Invalid or expired verification code.");
      }
    } catch {
      setFormError("Failed to verify code. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Forgot Password
  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmailValid) {
      setFormError("Enter a valid email address.");
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    const result = await forgotPassword(email.trim());
    setIsSubmitting(false);
    if (result.success) {
      setFormSuccess(
        emailDelivery
          ? "If this email is registered, password reset instructions have been sent."
          : "Request recorded. No email was sent because email delivery is not configured.",
      );
    } else {
      setFormError(result.error || "Failed to process request.");
    }
  };

  // Handle Reset Password
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasMinLength || !hasNumber) {
      setFormError("Password must contain at least 8 characters and one number.");
      return;
    }
    if (password !== passwordConfirm) {
      setFormError("Passwords do not match.");
      return;
    }
    if (!tokenParam) {
      setFormError("Reset token is missing or invalid.");
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    const result = await resetPassword(tokenParam, password, passwordConfirm);
    setIsSubmitting(false);
    if (result.success) {
      setFormSuccess("Password reset successfully. Please log in with your new password.");
      setMode("login");
    } else {
      setFormError(result.error || "Password reset failed or token expired.");
    }
  };

  // Handle Consent Decision (US-01-03)
  const handleConsentChoice = async (skip: boolean) => {
    setConsentSubmitting(true);
    const ok = await submitConsents({
      process_documents: skip ? false : consentDocs,
      external_ai: skip ? false : consentAi,
      retention: skip ? false : consentRetention,
      skip,
    });
    setConsentSubmitting(false);
    if (ok) {
      handleProceedAfterAuth(true, account?.profile_completed ?? false);
    } else {
      setFormError("Could not save your consent choices. Please try again.");
    }
  };

  return (
    <main className="journey-auth-page">
      {/* Left visual column */}
      <section className="journey-auth-visual" aria-label="Inssura insurance journey">
        <Link href="/" className="journey-auth-logo" aria-label="Inssura home">
          <Image
            src="/mascot-logo.png"
            alt="Inssura: Your AI Insurance Companion"
            width={1774}
            height={887}
            priority
          />
        </Link>

        <div className="journey-auth-copy">
          <h1>
            One account
            <br />
            for all your <em>insurance.</em>
          </h1>
          <p>
            Bring your personal, employer, public and overseas coverage together. Understand, verify,
            and take action with greater confidence.
          </p>
        </div>

        <div className="journey-auth-cards" aria-hidden="true">
          <div className="journey-fact-card">
            <CalendarDays />
            <span>
              Visa Period
              <small>01 Jul 2025 to 31 Jul 2027</small>
            </span>
            <b>Active</b>
          </div>
          <div className="journey-fact-card">
            <FileCheck2 />
            <span>
              OSHC / Student Insurance
              <small>01 Jul 2025 to 30 Jun 2027</small>
            </span>
            <b className="warning">31 days to verify</b>
          </div>
          <div className="journey-fact-card compact">
            <BriefcaseBusiness />
            <span>
              Corporate Benefits
              <small>Illustrative overview</small>
            </span>
          </div>
        </div>

        <div className="journey-mascot-note">
          <Image src="/mascot-bubble.png" alt="Inssura kangaroo mascot" width={1312} height={1199} />
          <p>Clear before you need it.</p>
        </div>

        <div className="journey-trust-strip">
          <span>
            <ShieldCheck />
            <b>Privacy-first</b>
            <small>Your data, your control</small>
          </span>
          <span>
            <FileCheck2 />
            <b>Evidence-based</b>
            <small>Grounded in policy terms</small>
          </span>
          <span>
            <LockKeyhole />
            <b>Secure by design</b>
            <small>Protected account sessions</small>
          </span>
        </div>
      </section>

      {/* Right panel column */}
      <section className="journey-auth-panel">
        <div className="journey-auth-topbar">
          <Link href="/" className="journey-back">
            <ArrowLeft /> Home
          </Link>
          <span>EN</span>
        </div>

        <div className="journey-auth-box">
          {/* STATE 1: Authenticated, Consent Not Decided (US-01-03 Consent Screen) */}
          {account && !account.consent_decided ? (
            <div className="journey-consent-view">
              <div className="journey-consent-header">
                <h2>Before We Get Started</h2>
                <p>You stay in control of how INSSURA uses your information.</p>
              </div>

              {formError && (
                <div className="journey-alert error" role="alert">
                  <ShieldAlert className="w-4 h-4 flex-none" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="journey-consent-cards">
                {/* Consent 1: Document Processing */}
                <div className="journey-consent-card">
                  <div className="journey-consent-info">
                    <div className="journey-consent-title-row">
                      <span className="journey-consent-title">Process My Insurance Documents</span>
                      <span className="journey-badge-required">Required</span>
                    </div>
                    <p className="journey-consent-desc">
                      Allow INSSURA to read and process insurance documents I upload.
                    </p>
                  </div>
                  <label className="journey-consent-toggle-wrap">
                    <input
                      type="checkbox"
                      checked={consentDocs}
                      onChange={(e) => setConsentDocs(e.target.checked)}
                    />
                    <span>I agree</span>
                  </label>
                </div>

                {/* Consent 2: External AI */}
                <div className="journey-consent-card">
                  <div className="journey-consent-info">
                    <div className="journey-consent-title-row">
                      <span className="journey-consent-title">Use External AI Services</span>
                      <span className="journey-badge-required">Required</span>
                    </div>
                    <p className="journey-consent-desc">
                      Allow approved AI services to process relevant document information and answer questions.
                    </p>
                  </div>
                  <label className="journey-consent-toggle-wrap">
                    <input
                      type="checkbox"
                      checked={consentAi}
                      onChange={(e) => setConsentAi(e.target.checked)}
                    />
                    <span>I agree</span>
                  </label>
                </div>

                {/* Consent 3: Retention */}
                <div className="journey-consent-card">
                  <div className="journey-consent-info">
                    <div className="journey-consent-title-row">
                      <span className="journey-consent-title">Keep Original Documents</span>
                      <span className="journey-badge-optional">Optional</span>
                    </div>
                    <p className="journey-consent-desc">
                      Keep uploaded originals after extraction so I can view them again later.
                    </p>
                  </div>
                  <label className="journey-consent-toggle-wrap">
                    <input
                      type="checkbox"
                      checked={consentRetention}
                      onChange={(e) => setConsentRetention(e.target.checked)}
                    />
                    <span>I agree</span>
                  </label>
                </div>
              </div>

              <div className="journey-consent-actions">
                <button
                  type="button"
                  className="journey-auth-submit"
                  disabled={consentSubmitting}
                  onClick={() => handleConsentChoice(false)}
                >
                  {consentSubmitting ? "Saving..." : "Agree & Continue"}
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className="journey-btn-skip"
                  disabled={consentSubmitting}
                  onClick={() => handleConsentChoice(true)}
                >
                  Skip for Now
                </button>
              </div>

              <p className="journey-auth-terms">
                You can change or revoke your consent preferences at any time in Settings {">"} Privacy.
              </p>
            </div>
          ) : mode === "verify" ? (
            /* STATE 2: Check Your Email (FR-10, FR-11) */
            <div className="journey-verify-box">
              <div className="journey-verify-icon">
                <Mail className="w-8 h-8" />
              </div>
              <h3>{emailDelivery ? "Check Your Email" : "Account created"}</h3>
              {emailDelivery ? (
                <p>
                  We sent a verification link to <strong>{unverifiedEmail || "your email address"}</strong>.
                  Please check your inbox and click the link to activate your account.
                </p>
              ) : (
                <EmailDeliveryNotice />
              )}

              {formSuccess && (
                <div className="journey-alert success w-full text-left mb-4" role="status">
                  <CheckCircle2 className="w-4 h-4 flex-none" />
                  <span>{formSuccess}</span>
                </div>
              )}
              {formError && (
                <div className="journey-alert error w-full text-left mb-4" role="alert">
                  <ShieldAlert className="w-4 h-4 flex-none" />
                  <span>{formError}</span>
                </div>
              )}

              {emailDelivery && (
                <form onSubmit={handleOtpSubmit} className="w-full my-4 text-left">
                  <label htmlFor="otp-input" className="journey-label block mb-1.5 font-medium text-xs text-gray-700">
                    Or Enter Verification / OTP Code (6 digits)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="otp-input"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="e.g. 123456"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      className="journey-input text-center text-base tracking-widest font-mono flex-1"
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting || otpCode.length < 6}
                      className="journey-primary-button px-4 flex-none text-sm font-semibold rounded-lg"
                    >
                      {isSubmitting ? "Memverifikasi…" : "Verifikasi"}
                    </button>
                  </div>
                </form>
              )}

              <button
                type="button"
                className="journey-resend-btn w-full"
                disabled={cooldown > 0 || !emailDelivery}
                onClick={handleResend}
              >
                {cooldown > 0 ? `Resend Verification (${cooldown}s)` : "Resend Verification Email"}
              </button>

              <div className="journey-divider w-full">
                <span>or</span>
              </div>

              <button
                type="button"
                className="journey-btn-skip w-full"
                onClick={() => {
                  setMode("login");
                  setFormError(null);
                  setFormSuccess(null);
                }}
              >
                Back to Log In
              </button>
            </div>
          ) : mode === "forgot" ? (
            /* STATE 3: Forgot Password (FR-17) */
            <div>
              <h2>Reset your password</h2>
              <p className="journey-auth-lead">
                {emailDelivery
                  ? "Enter your registered email address and we will send you a password reset link."
                  : "Password reset by email is currently unavailable."}
              </p>
              {!emailDelivery && <EmailDeliveryNotice />}

              {formSuccess && (
                <div className="journey-alert success" role="status">
                  <CheckCircle2 className="w-4 h-4 flex-none" />
                  <span>{formSuccess}</span>
                </div>
              )}
              {formError && (
                <div className="journey-alert error" role="alert">
                  <ShieldAlert className="w-4 h-4 flex-none" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleForgotPasswordSubmit} className="journey-auth-form">
                <div className="journey-form-group">
                  <label htmlFor={emailId}>Email Address</label>
                  <div className="journey-input-wrapper">
                    <Mail className="journey-input-icon" />
                    <input
                      id={emailId}
                      type="email"
                      required
                      placeholder="name@example.com"
                      className="journey-text-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="journey-auth-submit"
                  disabled={!isEmailValid || isSubmitting || !emailDelivery}
                >
                  {isSubmitting ? "Sending..." : "Send Reset Link"}
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  className="journey-btn-skip"
                  onClick={() => {
                    setMode("login");
                    setFormError(null);
                    setFormSuccess(null);
                  }}
                >
                  Back to Log In
                </button>
              </form>
            </div>
          ) : mode === "reset" ? (
            /* STATE 4: Reset Password with Token */
            <div>
              <h2>Create new password</h2>
              <p className="journey-auth-lead">
                Choose a strong new password with at least 8 characters including letters and numbers.
              </p>

              {formError && (
                <div className="journey-alert error" role="alert">
                  <ShieldAlert className="w-4 h-4 flex-none" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleResetPasswordSubmit} className="journey-auth-form">
                <div className="journey-form-group">
                  <label htmlFor={passwordId}>New Password</label>
                  <div className="journey-input-wrapper">
                    <LockKeyhole className="journey-input-icon" />
                    <input
                      id={passwordId}
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="At least 8 characters"
                      className="journey-text-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="journey-toggle-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="journey-form-group">
                  <label htmlFor={confirmPasswordId}>Confirm New Password</label>
                  <div className="journey-input-wrapper">
                    <LockKeyhole className="journey-input-icon" />
                    <input
                      id={confirmPasswordId}
                      type={showConfirm ? "text" : "password"}
                      required
                      placeholder="Repeat new password"
                      className="journey-text-input"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                    />
                    <button
                      type="button"
                      className="journey-toggle-btn"
                      onClick={() => setShowConfirm(!showConfirm)}
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="journey-auth-submit"
                  disabled={!isPasswordValid || password !== passwordConfirm || isSubmitting}
                >
                  {isSubmitting ? "Updating..." : "Update Password"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : (
            /* STATE 5: Default Login & Register Tabs (US-01-01, US-01-02) */
            <div>
              <h2>{mode === "login" ? "Log in to Inssura" : "Create your account"}</h2>
              <p className="journey-auth-lead">
                {mode === "login"
                  ? "Welcome back to your private insurance companion."
                  : "Start your protection journey with INSSURA."}
              </p>

              {/* Top mode tabs (Default tab: Log In) (FR-14) */}
              <div className="journey-auth-tabs" role="tablist" aria-label="Account access">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "login"}
                  className={mode === "login" ? "active" : ""}
                  onClick={() => {
                    setMode("login");
                    setFormError(null);
                    setFormSuccess(null);
                  }}
                >
                  Log In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "register"}
                  className={mode === "register" ? "active" : ""}
                  onClick={() => {
                    setMode("register");
                    setFormError(null);
                    setFormSuccess(null);
                  }}
                >
                  Register
                </button>
              </div>

              {mode === "register" && !emailDelivery && <EmailDeliveryNotice />}

              {/* Status and Error Alerts */}
              {formSuccess && (
                <div className="journey-alert success" role="status">
                  <CheckCircle2 className="w-4 h-4 flex-none" />
                  <span>{formSuccess}</span>
                </div>
              )}
              {formError && (
                <div className="journey-alert error" role="alert">
                  <ShieldAlert className="w-4 h-4 flex-none" />
                  <div>
                    <span>{formError}</span>
                    {unverifiedEmail && (
                      <button
                        type="button"
                        className="block mt-1 font-bold underline cursor-pointer text-xs"
                        onClick={() => setMode("verify")}
                      >
                        Resend verification email
                      </button>
                    )}
                  </div>
                </div>
              )}
              {lockoutRemaining !== null && (
                <div className="journey-alert warning" role="alert">
                  <ShieldAlert className="w-4 h-4 flex-none" />
                  <span>
                    Account locked due to consecutive failed attempts. Try again in {lockoutRemaining}s.
                  </span>
                </div>
              )}

              {/* TAB 1: LOG IN FORM (US-01-02) */}
              {mode === "login" ? (
                <form onSubmit={handleLoginSubmit} className="journey-auth-form">
                  <div className="journey-form-group">
                    <label htmlFor={emailId}>Email Address</label>
                    <div className="journey-input-wrapper">
                      <Mail className="journey-input-icon" />
                      <input
                        id={emailId}
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="name@example.com"
                        className={`journey-text-input ${email.length > 0 && !isEmailValid ? "input-error" : ""}`}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    {email.length > 0 && !isEmailValid && (
                      <span className="journey-field-error">Enter a valid email address.</span>
                    )}
                  </div>

                  <div className="journey-form-group">
                    <div className="flex justify-between items-center">
                      <label htmlFor={passwordId}>Password</label>
                      <button
                        type="button"
                        className="text-xs text-[#078e79] hover:underline font-semibold cursor-pointer"
                        onClick={() => {
                          setMode("forgot");
                          setFormError(null);
                          setFormSuccess(null);
                        }}
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <div className="journey-input-wrapper">
                      <LockKeyhole className="journey-input-icon" />
                      <input
                        id={passwordId}
                        type={showPassword ? "text" : "password"}
                        required
                        autoComplete="current-password"
                        placeholder="Your password"
                        className="journey-text-input"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="journey-toggle-btn"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="journey-auth-submit"
                    disabled={!isLoginFormValid || lockoutRemaining !== null}
                  >
                    {isSubmitting ? "Logging in..." : "Log In"}
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <div className="journey-divider">
                    <span>or continue with</span>
                  </div>

                  <a href={googleLoginUrl} className="journey-google-button">
                    <span className="google-mark">G</span>
                    Continue with Google
                    <ArrowRight />
                  </a>

                  <div className="journey-auth-notice">
                    <LockKeyhole />
                    <div>
                      <b>Secure Session Verification</b>
                      <p>
                        Sessions expire after 7 days of inactivity. Accounts lock automatically for 5
                        minutes after 5 consecutive failed attempts.
                      </p>
                    </div>
                  </div>
                </form>
              ) : (
                /* TAB 2: REGISTER FORM (US-01-01) */
                <form onSubmit={handleRegisterSubmit} className="journey-auth-form">
                  <div className="journey-form-group">
                    <label htmlFor={emailId}>Email Address</label>
                    <div className="journey-input-wrapper">
                      <Mail className="journey-input-icon" />
                      <input
                        id={emailId}
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="name@example.com"
                        className={`journey-text-input ${email.length > 0 && !isEmailValid ? "input-error" : ""}`}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    {email.length > 0 && !isEmailValid && (
                      <span className="journey-field-error">Enter a valid email address.</span>
                    )}
                  </div>

                  <div className="journey-form-group">
                    <label htmlFor={passwordId}>Password</label>
                    <div className="journey-input-wrapper">
                      <LockKeyhole className="journey-input-icon" />
                      <input
                        id={passwordId}
                        type={showPassword ? "text" : "password"}
                        required
                        autoComplete="new-password"
                        placeholder="At least 8 characters, letters and numbers"
                        className={`journey-text-input ${password.length > 0 && !isPasswordValid ? "input-error" : ""}`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="journey-toggle-btn"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Password Strength Meter (FR-06) */}
                    {password.length > 0 && (
                      <div className="journey-strength-container">
                        <div className="journey-strength-bars">
                          <div
                            className={`journey-strength-segment ${
                              strength === "weak"
                                ? "active-weak"
                                : strength === "medium"
                                  ? "active-medium"
                                  : "active-strong"
                            }`}
                          />
                          <div
                            className={`journey-strength-segment ${
                              strength === "medium"
                                ? "active-medium"
                                : strength === "strong"
                                  ? "active-strong"
                                  : ""
                            }`}
                          />
                          <div
                            className={`journey-strength-segment ${
                              strength === "strong" ? "active-strong" : ""
                            }`}
                          />
                        </div>
                        <span className="journey-strength-caption">
                          Strength:{" "}
                          <strong className="capitalize">{strength}</strong>
                        </span>
                      </div>
                    )}

                    {password.length > 0 && !hasMinLength && (
                      <span className="journey-field-error">Password must contain at least 8 characters.</span>
                    )}
                    {password.length >= 8 && !hasNumber && (
                      <span className="journey-field-error">Include at least one number.</span>
                    )}
                  </div>

                  <div className="journey-form-group">
                    <label htmlFor={confirmPasswordId}>Confirm Password</label>
                    <div className="journey-input-wrapper">
                      <LockKeyhole className="journey-input-icon" />
                      <input
                        id={confirmPasswordId}
                        type={showConfirm ? "text" : "password"}
                        required
                        autoComplete="new-password"
                        placeholder="Repeat your password"
                        className={`journey-text-input ${passwordConfirm.length > 0 && !isConfirmMatch ? "input-error" : ""}`}
                        value={passwordConfirm}
                        onChange={(e) => setPasswordConfirm(e.target.value)}
                      />
                      <button
                        type="button"
                        className="journey-toggle-btn"
                        onClick={() => setShowConfirm(!showConfirm)}
                        aria-label={showConfirm ? "Hide password" : "Show password"}
                      >
                        {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {passwordConfirm.length > 0 && !isConfirmMatch && (
                      <span className="journey-field-error">Passwords do not match.</span>
                    )}
                  </div>

                  {/* Mandatory Terms & Privacy Checkbox (FR-07) */}
                  <div className="journey-checkbox-group">
                    <input
                      id={termsId}
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      required
                    />
                    <label htmlFor={termsId}>
                      I agree to the <Link href="/settings/terms">Terms & Conditions</Link> and{" "}
                      <Link href="/settings/privacy">Privacy Policy</Link>.
                    </label>
                  </div>

                  {/* Submit Button disabled until all criteria valid (FR-08) */}
                  <button type="submit" className="journey-auth-submit" disabled={!isRegisterFormValid}>
                    {isSubmitting ? "Creating Account..." : "Create Account"}
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <div className="journey-divider">
                    <span>or register with</span>
                  </div>

                  <a href={googleLoginUrl} className="journey-google-button">
                    <span className="google-mark">G</span>
                    Register with Google
                    <ArrowRight />
                  </a>
                </form>
              )}

              <p className="journey-auth-terms">
                By continuing, you acknowledge our <Link href="/settings/privacy">Privacy Policy</Link>.
                Consent choices remain separate and default to off.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
