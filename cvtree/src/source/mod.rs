pub mod osv;

use async_trait::async_trait;

use crate::error::Result;
use crate::model::{Dependency, Vulnerability};

#[async_trait]
pub trait VulnerabilitySource: Send + Sync {
    fn name(&self) -> &'static str;

    async fn query(&self, dependency: &Dependency) -> Result<Vec<Vulnerability>>;

    async fn query_batch(&self, dependencies: &[Dependency]) -> Result<Vec<Vec<Vulnerability>>> {
        let mut results = Vec::with_capacity(dependencies.len());
        for dependency in dependencies {
            results.push(self.query(dependency).await?);
        }
        Ok(results)
    }
}
