"use client";

import { Globe2, ShieldCheck, Users } from "lucide-react";

export function BottomSection() {
  return (
    <section className="bottom" id="how">
      <div className="shell">
        <div className="bottom-card">
          <div className="bottom-content">
            <div className="bottom-text">
              <h2>
                Wherever life takes you,
                <br />
                travel, study, work, or home.
              </h2>
              <p>INSURRA helps you stay protected across borders and benefits.</p>
            </div>
            <div className="pillrow">
              <div className="stat">
                <Globe2 aria-hidden="true" className="stat-icon" />
                <div>
                  <b>100+</b>
                  <small>Countries and territories</small>
                </div>
              </div>
              <div className="stat">
                <ShieldCheck aria-hidden="true" className="stat-icon" />
                <div>
                  <b>Multiple</b>
                  <small>Insurance types</small>
                </div>
              </div>
              <div className="stat">
                <Users aria-hidden="true" className="stat-icon" />
                <div>
                  <b>Individuals, families</b>
                  <small>and professionals</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
