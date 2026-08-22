mod schema;

pub use schema::{normalize, normalize_all, OsvBatchResponse, OsvQueryResponse, OsvVulnerability};

use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use futures::stream::{self, StreamExt};
use serde_json::json;

use crate::error::{Error, Result};
use crate::model::{Dependency, Vulnerability};
use crate::source::VulnerabilitySource;

pub const DEFAULT_BASE_URL: &str = "https://api.osv.dev";
const BATCH_SIZE: usize = 500;
const DETAIL_CONCURRENCY: usize = 12;
const MAX_PAGES: usize = 5;

pub struct OsvClient {
    http: reqwest::Client,
    base_url: String,
}

impl OsvClient {
    pub fn new() -> Result<Self> {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    pub fn with_base_url(base_url: impl Into<String>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("cvtree/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|err| Error::source("OSV", err))?;
        Ok(OsvClient {
            http,
            base_url: base_url.into().trim_end_matches('/').to_string(),
        })
    }

    async fn post<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<T> {
        let response = self
            .http
            .post(format!("{}{path}", self.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|err| Error::source("OSV", friendly(&err)))?;
        decode(response).await
    }

    async fn vulnerability(&self, id: &str) -> Result<OsvVulnerability> {
        let response = self
            .http
            .get(format!("{}/v1/vulns/{id}", self.base_url))
            .send()
            .await
            .map_err(|err| Error::source("OSV", friendly(&err)))?;
        decode(response).await
    }

    async fn ids_for(&self, dependencies: &[Dependency]) -> Result<Vec<Vec<String>>> {
        let mut ids = Vec::with_capacity(dependencies.len());

        for chunk in dependencies.chunks(BATCH_SIZE) {
            let queries: Vec<serde_json::Value> = chunk.iter().map(query_body).collect();
            let response: OsvBatchResponse = self
                .post("/v1/querybatch", json!({ "queries": queries }))
                .await?;

            for index in 0..chunk.len() {
                let found = response
                    .results
                    .get(index)
                    .map(|result| result.vulns.iter().map(|v| v.id.clone()).collect())
                    .unwrap_or_default();
                ids.push(found);
            }
        }

        Ok(ids)
    }

    async fn details_for(
        &self,
        ids: &HashSet<String>,
    ) -> Result<HashMap<String, OsvVulnerability>> {
        let fetched: Vec<Result<OsvVulnerability>> = stream::iter(ids.iter().cloned())
            .map(|id| async move { self.vulnerability(&id).await })
            .buffer_unordered(DETAIL_CONCURRENCY)
            .collect()
            .await;

        let mut details = HashMap::new();
        for item in fetched {
            let raw = item?;
            details.insert(raw.id.clone(), raw);
        }
        Ok(details)
    }
}

#[async_trait]
impl VulnerabilitySource for OsvClient {
    fn name(&self) -> &'static str {
        "OSV"
    }

    async fn query(&self, dependency: &Dependency) -> Result<Vec<Vulnerability>> {
        let mut body = query_body(dependency);
        let mut raw = Vec::new();

        for _ in 0..MAX_PAGES {
            let response: OsvQueryResponse = self.post("/v1/query", body.clone()).await?;
            raw.extend(response.vulns);
            match response.next_page_token {
                Some(token) if !token.is_empty() => {
                    body["page_token"] = json!(token);
                }
                _ => break,
            }
        }

        Ok(normalize_all(&raw, dependency))
    }

    async fn query_batch(&self, dependencies: &[Dependency]) -> Result<Vec<Vec<Vulnerability>>> {
        if dependencies.is_empty() {
            return Ok(Vec::new());
        }

        let ids = self.ids_for(dependencies).await?;
        let unique: HashSet<String> = ids.iter().flatten().cloned().collect();
        let details = self.details_for(&unique).await?;

        Ok(dependencies
            .iter()
            .zip(ids)
            .map(|(dependency, found)| {
                let raw: Vec<OsvVulnerability> = found
                    .iter()
                    .filter_map(|id| details.get(id))
                    .cloned()
                    .collect();
                normalize_all(&raw, dependency)
            })
            .collect())
    }
}

fn query_body(dependency: &Dependency) -> serde_json::Value {
    json!({
        "package": {
            "name": dependency.name,
            "ecosystem": dependency.ecosystem.osv_name(),
        },
        "version": dependency.version,
    })
}

async fn decode<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| Error::source("OSV", friendly(&err)))?;

    if !status.is_success() {
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.chars().take(200).collect());
        return Err(Error::source(
            "OSV",
            format!("HTTP {} from api.osv.dev: {detail}", status.as_u16()),
        ));
    }

    serde_json::from_str(&body)
        .map_err(|err| Error::source("OSV", format!("unexpected response format: {err}")))
}

fn friendly(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "network request timed out".to_string()
    } else if err.is_connect() {
        "network request failed (could not connect)".to_string()
    } else {
        err.to_string()
    }
}
