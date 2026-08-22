use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use cvtree::audit::PackageReport;
use cvtree::registry::RegistryClient;
use cvtree::{Dependency, Ecosystem, OsvClient, PackageSpec, VulnerabilitySource};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;

use crate::style;

struct AppState {
    osv: OsvClient,
    registry: RegistryClient,
}

pub async fn run(host: &str, port: u16) -> anyhow::Result<()> {
    let state = Arc::new(AppState {
        osv: OsvClient::new()?,
        registry: RegistryClient::new()?,
    });

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/search", get(search))
        .route("/api/package/{ecosystem}/{*package}", get(package))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind((host, port)).await?;
    let address = listener.local_addr()?;
    eprintln!("{}", style::bold(&format!("cvtree api listening on http://{address}")));
    eprintln!(
        "{}",
        style::dim(&format!(
            "  try http://{address}/api/package/npm/lodash/4.17.15"
        ))
    );

    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok", "source": "OSV" }))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    ecosystem: Option<Ecosystem>,
}

async fn search(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<PackageReport>, ApiError> {
    let spec = PackageSpec::parse(&query.q)?;
    let ecosystem = spec.ecosystem.or(query.ecosystem).unwrap_or(Ecosystem::Npm);
    report(&state, &spec.name, spec.version.as_deref(), ecosystem).await
}

async fn package(
    State(state): State<Arc<AppState>>,
    Path((ecosystem, package)): Path<(String, String)>,
) -> Result<Json<PackageReport>, ApiError> {
    let ecosystem: Ecosystem = ecosystem.parse()?;
    let (name, version) = match package.rsplit_once('/') {
        Some((name, version)) if !name.is_empty() => (name.to_string(), Some(version.to_string())),
        _ => (package, None),
    };
    report(&state, &name, version.as_deref(), ecosystem).await
}

async fn report(
    state: &AppState,
    name: &str,
    version: Option<&str>,
    ecosystem: Ecosystem,
) -> Result<Json<PackageReport>, ApiError> {
    let version = match version {
        Some(version) => version.to_string(),
        None => state.registry.latest_version(name, ecosystem).await?,
    };

    let dependency = Dependency::new(name, version, ecosystem);
    let vulnerabilities = state.osv.query(&dependency).await?;
    Ok(Json(PackageReport::new(&dependency, vulnerabilities)))
}

#[derive(Serialize)]
struct ApiError {
    error: String,
    #[serde(skip)]
    status: StatusCode,
}

impl From<cvtree::Error> for ApiError {
    fn from(error: cvtree::Error) -> Self {
        let status = match error {
            cvtree::Error::InvalidPackageSpec(_) | cvtree::Error::UnknownEcosystem(_) => {
                StatusCode::BAD_REQUEST
            }
            cvtree::Error::VersionResolution { .. } => StatusCode::NOT_FOUND,
            _ => StatusCode::BAD_GATEWAY,
        };
        ApiError {
            error: error.to_string(),
            status,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(serde_json::json!({ "error": self.error }))).into_response()
    }
}
