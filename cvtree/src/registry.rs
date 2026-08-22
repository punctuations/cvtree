use crate::error::{Error, Result};
use crate::model::Ecosystem;

pub const NPM_BASE_URL: &str = "https://registry.npmjs.org";
pub const CRATES_BASE_URL: &str = "https://crates.io/api/v1";

pub struct RegistryClient {
    http: reqwest::Client,
    npm_base_url: String,
    crates_base_url: String,
}

impl RegistryClient {
    pub fn new() -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("cvtree/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|err| Error::source("registry", err))?;
        Ok(RegistryClient {
            http,
            npm_base_url: NPM_BASE_URL.to_string(),
            crates_base_url: CRATES_BASE_URL.to_string(),
        })
    }

    pub fn with_base_urls(mut self, npm: impl Into<String>, crates: impl Into<String>) -> Self {
        self.npm_base_url = npm.into().trim_end_matches('/').to_string();
        self.crates_base_url = crates.into().trim_end_matches('/').to_string();
        self
    }

    pub async fn latest_version(&self, name: &str, ecosystem: Ecosystem) -> Result<String> {
        let url = match ecosystem {
            Ecosystem::Npm => format!("{}/{name}/latest", self.npm_base_url),
            Ecosystem::CratesIo => format!("{}/crates/{name}", self.crates_base_url),
        };

        let fail = |message: String| Error::VersionResolution {
            name: name.to_string(),
            ecosystem,
            message,
        };

        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|err| fail(err.to_string()))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(fail("package not found".to_string()));
        }
        if !response.status().is_success() {
            return Err(fail(format!("HTTP {}", response.status().as_u16())));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|err| fail(format!("unexpected response format: {err}")))?;

        version_from(&body, ecosystem)
            .ok_or_else(|| fail("the registry did not report a version".to_string()))
    }
}

fn version_from(body: &serde_json::Value, ecosystem: Ecosystem) -> Option<String> {
    let value = match ecosystem {
        Ecosystem::Npm => body.get("version"),
        Ecosystem::CratesIo => body
            .get("crate")
            .and_then(|item| item.get("max_stable_version").or_else(|| item.get("max_version"))),
    };
    value?.as_str().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_npm_version() {
        let body = serde_json::json!({ "name": "lodash", "version": "4.17.21" });
        assert_eq!(version_from(&body, Ecosystem::Npm).unwrap(), "4.17.21");
    }

    #[test]
    fn prefers_stable_crates_version() {
        let body = serde_json::json!({
            "crate": { "max_version": "2.0.0-beta.1", "max_stable_version": "1.9.0" }
        });
        assert_eq!(version_from(&body, Ecosystem::CratesIo).unwrap(), "1.9.0");
    }
}
