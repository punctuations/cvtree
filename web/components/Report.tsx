import {
  advisoryUrl,
  describeRange,
  identifiers,
  type PackageReport,
  type Severity,
  type Vulnerability,
} from "@/lib/model";

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

function severityClass(severity: Severity | null | undefined): string {
  return `severity severity-${(severity ?? "UNKNOWN").toLowerCase()}`;
}

function label(severity: Severity | null | undefined): string {
  return severity ?? "UNKNOWN";
}

function bySeverity(a: Vulnerability, b: Vulnerability): number {
  return SEVERITY_ORDER[label(a.severity)] - SEVERITY_ORDER[label(b.severity)];
}

export function Report({ report, cached }: { report: PackageReport; cached: boolean }) {
  const vulnerabilities = [...report.vulnerabilities].sort(bySeverity);
  const count = report.vulnerability_count;

  return (
    <section className="report">
      <header className="report-header">
        <div>
          <h2>{report.package}</h2>
          <p className="meta">
            <span className="tag">{report.ecosystem}</span>
            <span className="version">{report.version}</span>
          </p>
        </div>
        <div className="report-count">
          {count === 0 ? (
            <span className="clean">No known vulnerabilities</span>
          ) : (
            <span className={severityClass(report.max_severity)}>
              {count} {count === 1 ? "vulnerability" : "vulnerabilities"}
            </span>
          )}
          {cached ? <span className="cache-note">served from cache</span> : null}
        </div>
      </header>

      {vulnerabilities.map((vulnerability) => (
        <article key={vulnerability.id} className="vulnerability">
          <div className="vulnerability-head">
            <span className={severityClass(vulnerability.severity)}>
              {label(vulnerability.severity)}
            </span>
            <span className="identifiers">
              {identifiers(vulnerability).map((identifier) => (
                <code key={identifier}>{identifier}</code>
              ))}
            </span>
            {typeof vulnerability.cvss_score === "number" ? (
              <span className="score">CVSS {vulnerability.cvss_score.toFixed(1)}</span>
            ) : null}
          </div>

          <h3>{vulnerability.summary ?? "No summary provided"}</h3>

          <dl className="ranges">
            {vulnerability.affected && vulnerability.affected.length > 0 ? (
              <div>
                <dt>Affected</dt>
                <dd>{vulnerability.affected.map(describeRange).join("  |  ")}</dd>
              </div>
            ) : null}
            {vulnerability.fixed_versions && vulnerability.fixed_versions.length > 0 ? (
              <div>
                <dt>Fixed</dt>
                <dd>
                  {vulnerability.fixed_versions.map((version) => `>= ${version}`).join("  |  ")}
                </dd>
              </div>
            ) : null}
          </dl>

          {advisoryUrl(vulnerability) ? (
            <a
              className="advisory"
              href={advisoryUrl(vulnerability) ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              View advisory
            </a>
          ) : null}
        </article>
      ))}
    </section>
  );
}
