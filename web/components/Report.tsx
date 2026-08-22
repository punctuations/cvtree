import {
  advisoryUrl,
  describeRange,
  identifiers,
  SEVERITY_RANK,
  type PackageReport,
  type Severity,
  type Vulnerability,
} from "@/lib/model";

const ORDER: (Severity | "UNKNOWN")[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function label(severity: Severity | null | undefined): Severity | "UNKNOWN" {
  return severity ?? "UNKNOWN";
}

function severityClass(severity: Severity | null | undefined): string {
  return `severity severity-${label(severity).toLowerCase()}`;
}

function rank(severity: Severity | null | undefined): number {
  return severity ? SEVERITY_RANK[severity] : 0;
}

function isWide(severity: Severity | null | undefined): boolean {
  return severity === "CRITICAL";
}

export function Report({ report, cached }: { report: PackageReport; cached: boolean }) {
  const vulnerabilities = [...report.vulnerabilities].sort(
    (a, b) => rank(b.severity) - rank(a.severity),
  );

  const tally = new Map<Severity | "UNKNOWN", number>();
  for (const vulnerability of vulnerabilities) {
    const key = label(vulnerability.severity);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  const count = report.vulnerability_count;

  return (
    <section className="report">
      <article className="tile tile-identity">
        <h2>{report.package}</h2>
        <p className="meta">
          <span className="tag">{report.ecosystem}</span>
          <span className="version">{report.version}</span>
        </p>
        {cached ? <p className="cache-note">served from cache</p> : null}
      </article>

      <article className="tile tile-summary">
        {count === 0 ? (
          <p className="clean">No known vulnerabilities</p>
        ) : (
          <>
            <p className="figure">
              <strong>{count}</strong>
              <span>{count === 1 ? "vulnerability" : "vulnerabilities"}</span>
            </p>
            <ul className="tally">
              {ORDER.filter((severity) => tally.has(severity)).map((severity) => (
                <li key={severity}>
                  <span className={severityClass(severity === "UNKNOWN" ? null : severity)}>
                    {severity}
                  </span>
                  <b>{tally.get(severity)}</b>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      {vulnerabilities.map((vulnerability) => (
        <Tile key={vulnerability.id} vulnerability={vulnerability} />
      ))}
    </section>
  );
}

function Tile({ vulnerability }: { vulnerability: Vulnerability }) {
  const url = advisoryUrl(vulnerability);
  const affected = vulnerability.affected ?? [];
  const fixed = vulnerability.fixed_versions ?? [];

  return (
    <article className={`tile vulnerability${isWide(vulnerability.severity) ? " tile-wide" : ""}`}>
      <div className="vulnerability-head">
        <span className={severityClass(vulnerability.severity)}>{label(vulnerability.severity)}</span>
        {typeof vulnerability.cvss_score === "number" ? (
          <span className="score">CVSS {vulnerability.cvss_score.toFixed(1)}</span>
        ) : null}
      </div>

      <p className="identifiers">
        {identifiers(vulnerability).map((identifier) => (
          <code key={identifier}>{identifier}</code>
        ))}
      </p>

      <h3>{vulnerability.summary ?? "No summary provided"}</h3>

      <dl className="ranges">
        {affected.length > 0 ? (
          <div>
            <dt>Affected</dt>
            <dd>{affected.map(describeRange).join("  ·  ")}</dd>
          </div>
        ) : null}
        {fixed.length > 0 ? (
          <div>
            <dt>Fixed</dt>
            <dd>{fixed.map((version) => `>= ${version}`).join("  ·  ")}</dd>
          </div>
        ) : null}
      </dl>

      {url ? (
        <a className="advisory" href={url} target="_blank" rel="noreferrer">
          View advisory
        </a>
      ) : null}
    </article>
  );
}
