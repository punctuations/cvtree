import { SEVERITY_RANK, type Ecosystem, type PackageReport, type Severity } from "./model";
import { queryOsv } from "./osv/client";
import { latestVersion } from "./registry";

export async function packageReport(
  name: string,
  version: string | null,
  ecosystem: Ecosystem,
): Promise<PackageReport> {
  const resolved = version ?? (await latestVersion(name, ecosystem));
  const vulnerabilities = await queryOsv({ name, version: resolved, ecosystem });

  return {
    package: name,
    version: resolved,
    ecosystem,
    vulnerability_count: vulnerabilities.length,
    max_severity: highestSeverity(vulnerabilities.map((item) => item.severity)),
    vulnerabilities,
  };
}

function highestSeverity(severities: (Severity | null | undefined)[]): Severity | null {
  let highest: Severity | null = null;

  for (const severity of severities) {
    if (severity && (!highest || SEVERITY_RANK[severity] > SEVERITY_RANK[highest])) {
      highest = severity;
    }
  }

  return highest;
}
