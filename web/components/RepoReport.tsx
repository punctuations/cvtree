import {
  advisoryUrl,
  describeRange,
  identifiers,
  SEVERITY_RANK,
  type RepoAdvisory,
  type RepoReport as Report,
  type Severity,
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

export function RepoReport({ report }: { report: Report }) {
  const advisories = [...report.advisories].sort((a, b) => rank(b.severity) - rank(a.severity));

  const tally = new Map<Severity | "UNKNOWN", number>();
  for (const advisory of advisories) {
    const key = label(advisory.severity);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  const count = report.advisory_count;
  const degraded = report.sources.filter((source) => !source.ok);

  return (
    <section className="report">
      <article className="tile tile-identity">
        <h2>{report.repo}</h2>
        <p className="meta">
          <span className="tag">github</span>
          <a className="version" href={report.url} target="_blank" rel="noreferrer">
            repository
          </a>
        </p>
      </article>

      <article className="tile tile-summary">
        {count === 0 ? (
          <p className="clean">No known advisories</p>
        ) : (
          <>
            <p className="figure">
              <strong>{count}</strong>
              <span>{count === 1 ? "advisory" : "advisories"}</span>
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

        <ul className="sources">
          {report.sources.map((source) => (
            <li key={source.name}>
              <span className={source.ok ? "source source-ok" : "source source-down"}>
                {source.name}
              </span>
              <b>{source.ok ? source.count : "unavailable"}</b>
            </li>
          ))}
        </ul>

        {degraded.length > 0 ? (
          <p className="cache-note">
            {degraded.map((source) => `${source.name}: ${source.message ?? "unavailable"}`).join(" · ")}
          </p>
        ) : null}
      </article>

      {advisories.map((advisory) => (
        <Tile key={advisory.id} advisory={advisory} />
      ))}
    </section>
  );
}

function Tile({ advisory }: { advisory: RepoAdvisory }) {
  const url = advisoryUrl(advisory);
  const affected = advisory.affected ?? [];
  const fixed = advisory.fixed_versions ?? [];
  const packages = advisory.affected_packages ?? [];

  return (
    <article className={`tile vulnerability${advisory.severity === "CRITICAL" ? " tile-wide" : ""}`}>
      <div className="vulnerability-head">
        <span className={severityClass(advisory.severity)}>{label(advisory.severity)}</span>
        {typeof advisory.cvss_score === "number" ? (
          <span className="score">CVSS {advisory.cvss_score.toFixed(1)}</span>
        ) : null}
        <span className="origins">{advisory.sources.join(" + ")}</span>
      </div>

      <p className="identifiers">
        {identifiers(advisory).map((identifier) => (
          <code key={identifier}>{identifier}</code>
        ))}
      </p>

      <h3>{advisory.summary ?? "No summary provided"}</h3>

      <dl className="ranges">
        {packages.length > 0 ? (
          <div>
            <dt>Packages</dt>
            <dd>{packages.map((item) => `${item.ecosystem}:${item.name}`).join("  ·  ")}</dd>
          </div>
        ) : null}
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
