import {
  advisoryUrl,
  identifiers,
  SEVERITY_RANK,
  type DeepReport as DeepReportModel,
  type Finding,
  type PackageTrust,
  type Severity,
} from "@/lib/model";

import { TrustMeter } from "./TrustMeter";

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

function count(report: DeepReportModel, severity: Severity | "UNKNOWN"): number {
  switch (severity) {
    case "CRITICAL":
      return report.summary.critical;
    case "HIGH":
      return report.summary.high;
    case "MEDIUM":
      return report.summary.medium;
    case "LOW":
      return report.summary.low;
    default:
      return report.summary.unknown;
  }
}

export function DeepReport({
  report,
  cached,
}: {
  report: DeepReportModel;
  cached: boolean;
}) {
  const findings = [...report.vulnerabilities].sort((a, b) => rank(b.severity) - rank(a.severity));
  const total = findings.length;

  return (
    <section className="report">
      <article className="tile tile-identity">
        <h2>{report.package}</h2>
        <p className="meta">
          <span className="tag">{report.ecosystem}</span>
          <span className="version">{report.version}</span>
        </p>
        <p className="deep-note">
          {report.dependencies} packages, {report.depth} {report.depth === 1 ? "level" : "levels"}{" "}
          deep
          {report.truncated ? " (truncated)" : ""}
        </p>
        {cached ? <p className="cache-note">served from cache</p> : null}
      </article>

      <article className="tile tile-summary">
        <div className="trust-headline">
          <TrustMeter score={report.trust} />
          <span>trust</span>
        </div>
        {total === 0 ? (
          <p className="clean">No known vulnerabilities in the tree</p>
        ) : (
          <>
            <p className="figure">
              <strong>{total}</strong>
              <span>
                across {report.vulnerable_dependencies}{" "}
                {report.vulnerable_dependencies === 1 ? "package" : "packages"}
              </span>
            </p>
            <ul className="tally">
              {ORDER.filter((severity) => count(report, severity) > 0).map((severity) => (
                <li key={severity}>
                  <span className={severityClass(severity === "UNKNOWN" ? null : severity)}>
                    {severity}
                  </span>
                  <b>{count(report, severity)}</b>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      <article className="tile tile-wide tile-trust">
        <h3>Trust by package</h3>
        <p className="hint">
          Advisories ever filed against a package, over how many versions it has published. Many
          advisories across few releases scores low.
        </p>
        <ul className="trust-list">
          {report.packages.map((entry) => (
            <TrustRow key={`${entry.name}@${entry.version}`} entry={entry} />
          ))}
        </ul>
      </article>

      {findings.map((finding) => (
        <FindingTile key={`${finding.package}@${finding.version}:${finding.id}`} finding={finding} />
      ))}

      {report.unresolved.length > 0 ? (
        <article className="tile tile-wide">
          <h3>Unresolved</h3>
          <ul className="unresolved">
            {report.unresolved.map((entry) => (
              <li key={`${entry.parent}:${entry.name}`}>
                <code>
                  {entry.name} {entry.range}
                </code>
                <span>
                  from {entry.parent} — {entry.reason}
                </span>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}

function TrustRow({ entry }: { entry: PackageTrust }) {
  return (
    <li className="trust-row">
      <TrustMeter score={entry.trust} size="small" />
      <span className="trust-name">
        {entry.name}
        <i>@{entry.version}</i>
      </span>
      <span className="trust-stats">
        {entry.advisories} {entry.advisories === 1 ? "advisory" : "advisories"} over{" "}
        {entry.versions} {entry.versions === 1 ? "version" : "versions"}
      </span>
      {entry.vulnerability_count > 0 ? (
        <span className="trust-flag">{entry.vulnerability_count} here</span>
      ) : null}
    </li>
  );
}

function FindingTile({ finding }: { finding: Finding }) {
  const url = advisoryUrl(finding);

  return (
    <article className={`tile vulnerability${finding.severity === "CRITICAL" ? " tile-wide" : ""}`}>
      <div className="vulnerability-head">
        <span className={severityClass(finding.severity)}>{label(finding.severity)}</span>
        {typeof finding.cvss_score === "number" ? (
          <span className="score">CVSS {finding.cvss_score.toFixed(1)}</span>
        ) : null}
      </div>

      <p className="identifiers">
        {identifiers(finding).map((identifier) => (
          <code key={identifier}>{identifier}</code>
        ))}
      </p>

      <h3>{finding.summary ?? "No summary provided"}</h3>

      <p className="path">
        {finding.path.map((step, index) => (
          <span key={step}>
            {index > 0 ? <i>→</i> : null}
            <code>{step}</code>
          </span>
        ))}
      </p>

      {url ? (
        <a className="advisory" href={url} target="_blank" rel="noreferrer">
          View advisory
        </a>
      ) : null}
    </article>
  );
}
