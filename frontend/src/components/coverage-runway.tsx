import "./coverage-runway.css";

type Props = {
  start?: string | null;
  coverageEnd?: string | null;
  visaEnd?: string | null;
  /** Gap length as computed by the backend. Never derived in the browser. */
  gapDays?: number | null;
  sample?: boolean;
};

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function ms(value?: string | null) {
  if (!value) return null;
  const t = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Horizontal timeline that places the coverage window next to the visa end date.
 * Positions are visual only. Day counts come from the server rules engine.
 */
export function CoverageRunway({ start, coverageEnd, visaEnd, gapDays, sample }: Props) {
  const s = ms(start);
  const c = ms(coverageEnd);
  const v = ms(visaEnd);

  if (c === null || v === null) {
    const missing = [c === null && "coverage end date", v === null && "visa end date"]
      .filter(Boolean)
      .join(" and ");
    return (
      <div className="runway runway-empty" role="img" aria-label={`Timeline unavailable, ${missing} needed`}>
        <div className="runway-track">
          <span className="runway-seg runway-seg-unknown" style={{ left: "0%", width: "100%" }} />
        </div>
        <p>
          We need your <strong>{missing}</strong> before the timeline can be drawn.
        </p>
      </div>
    );
  }

  const lo = Math.min(s ?? c, c, v);
  const hi = Math.max(c, v);
  const pad = Math.max((hi - lo) * 0.08, 86_400_000 * 14);
  const a = lo - pad;
  const b = hi + pad;
  const pct = (t: number) => ((t - a) / (b - a)) * 100;

  const startPct = pct(s ?? lo);
  const coverPct = pct(c);
  const visaPct = pct(v);
  const gap = c < v;

  const summary = gap
    ? `Coverage ends ${fmt.format(c)}, visa ends ${fmt.format(v)}${
        gapDays != null ? `, ${gapDays} days potentially uncovered` : ""
      }`
    : `Coverage ends ${fmt.format(c)}, visa ends ${fmt.format(v)}, no gap found in these dates`;

  return (
    <figure className="runway" aria-label={summary}>
      <div className="runway-track" aria-hidden="true">
        <span
          className="runway-seg runway-seg-covered"
          style={{ left: `${startPct}%`, width: `${Math.max(coverPct - startPct, 0)}%` }}
        />
        {gap && (
          <span
            className="runway-seg runway-seg-gap"
            style={{ left: `${coverPct}%`, width: `${visaPct - coverPct}%` }}
          />
        )}
        <span className="runway-tick runway-tick-cover" style={{ left: `${coverPct}%` }} />
        <span className="runway-tick runway-tick-visa" style={{ left: `${visaPct}%` }} />
      </div>
      <dl className="runway-legend" aria-hidden="true">
        <div>
          <dt>
            <span className="runway-dot runway-dot-cover" /> Coverage ends
          </dt>
          <dd>{fmt.format(c)}</dd>
        </div>
        <div>
          <dt>
            <span className="runway-dot runway-dot-visa" /> Visa ends
          </dt>
          <dd>{fmt.format(v)}</dd>
        </div>
      </dl>
      <figcaption className="runway-caption">
        {gap ? (
          <>
            <span className="runway-key runway-key-gap" />
            {gapDays != null ? (
              <>
                <strong>{gapDays} days</strong> potentially uncovered
              </>
            ) : (
              <>Potential gap between coverage end and visa end</>
            )}
          </>
        ) : (
          <>
            <span className="runway-key runway-key-covered" />
            Coverage reaches your visa end date
          </>
        )}
        {sample && <span className="runway-sample">Illustrative example</span>}
      </figcaption>
    </figure>
  );
}
