export interface OsvSeverity {
  type?: string;
  score?: string;
}

export interface OsvPackage {
  name: string;
  ecosystem?: string;
}

export interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

export interface OsvRange {
  type?: string;
  events?: OsvEvent[];
}

export interface OsvAffected {
  package?: OsvPackage;
  ranges?: OsvRange[];
  versions?: string[];
  severity?: OsvSeverity[];
}

export interface OsvReference {
  type?: string;
  url: string;
}

export interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  published?: string;
  modified?: string;
  withdrawn?: string;
  severity?: OsvSeverity[];
  references?: OsvReference[];
  affected?: OsvAffected[];
  database_specific?: Record<string, unknown>;
}

export interface OsvQueryResponse {
  vulns?: OsvVulnerability[];
  next_page_token?: string;
}
