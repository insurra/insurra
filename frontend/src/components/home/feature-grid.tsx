"use client";

import Image from "next/image";

const features = [
  {
    image: "/feature-coverage.webp",
    title: "Unify Coverage",
    description:
      "Bring personal, employer, public, and overseas protection into one view.",
  },
  {
    image: "/feature-gaps.webp",
    title: "Detect Gaps",
    description:
      "Spot hidden gaps, policy overlaps, and benefit conflicts.",
  },
  {
    image: "/feature-care.webp",
    title: "Guide Care Decisions",
    description:
      "Understand where to go, what may be covered, and what to verify first.",
  },
  {
    image: "/feature-claims.webp",
    title: "Prepare Claims",
    description:
      "Organize supporting documents and move forward with confidence.",
  },
];

export function FeatureGrid() {
  return (
    <section className="features" id="features">
      <div className="shell">
        <div className="eyebrow">TURN UNCERTAINTY INTO CLARITY</div>
        <h2 className="section-title">Everything you need, in one place.</h2>

        <div className="featuregrid">
          {features.map((item) => (
            <article key={item.title} className="feature">
              <div className="featureicon" aria-hidden="true">
                <Image src={item.image} alt="" width={96} height={96} />
              </div>
              <div>
                <b>{item.title}</b>
                <p>{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
