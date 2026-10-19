"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FlaskConical, MapPin } from "lucide-react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/types.gen";
import { useSession } from "@/lib/session";

type Persona = components["schemas"]["DemoPersona"];

const COUNTRY_NAMES: Record<string, string> = { CN: "China", ID: "Indonesia" };

export function DemoPersonas() {
  const router = useRouter();
  const { selectPersona } = useSession();
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .request("get", "/api/v1/demo/personas", { signal: controller.signal })
      .then((list) => setPersonas(list))
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, []);

  async function launch(personaId: string) {
    if (launching) return;
    setLaunching(personaId);
    setLaunchError(null);
    const ok = await selectPersona(personaId);
    if (ok) {
      router.push("/home");
    } else {
      setLaunchError("The demo could not be started. Please try again.");
      setLaunching(null);
    }
  }

  return (
    <section className="demo-section" id="demo" aria-labelledby="demo-title">
      <div className="shell">
        <h2 id="demo-title">Try the interactive demo</h2>
        <p className="demo-intro">
          Pick a persona to explore Insurra with synthetic data. The demo runs in its own isolated
          session, it is not a real account, and nothing you do there is linked to a real person or
          a real insurer.
        </p>

        {personas === null && !loadError && (
          <p className="demo-status" role="status">
            Loading demo personas...
          </p>
        )}
        {loadError && (
          <p className="demo-error" role="alert">
            Demo personas are unavailable right now. You can still create an account with Get
            Started.
          </p>
        )}

        {personas && (
          <ul className="demo-grid">
            {personas.map((persona) => (
              <li key={persona.persona_id} className="demo-card" data-testid="persona-card">
                <span className="demo-badge">
                  <FlaskConical size={13} aria-hidden="true" /> Synthetic demo data
                </span>
                <h3>{persona.display_name}</h3>
                <p className="demo-role">{persona.role_label ?? "Demo persona"}</p>
                <p className="demo-place">
                  <MapPin size={14} aria-hidden="true" />{" "}
                  {[persona.city, COUNTRY_NAMES[persona.country_code] ?? persona.country_code]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="demo-desc">{persona.description}</p>
                {!!persona.insurance_categories?.length && (
                  <ul className="demo-tags" aria-label="Declared insurance categories">
                    {persona.insurance_categories.map((category) => (
                      <li key={category}>{category.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={launching !== null}
                  onClick={() => void launch(persona.persona_id)}
                >
                  {launching === persona.persona_id
                    ? "Opening demo..."
                    : `Explore as ${persona.display_name}`}
                  {launching !== persona.persona_id && <ArrowRight size={16} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {launchError && (
          <p className="demo-error" role="alert">
            {launchError}
          </p>
        )}
      </div>
    </section>
  );
}
