pub mod audit;
pub mod error;
pub mod model;
pub mod parser;
pub mod registry;
pub mod severity;
pub mod source;
pub mod spec;

pub use audit::{audit_project, audit_tree, AuditReport, Finding, PackageReport, SeverityCounts};
pub use error::{Error, Result};
pub use model::{
    AffectedRange, Dependency, DependencyTree, Ecosystem, Node, NodeId, Reference, Severity,
    Vulnerability,
};
pub use parser::DependencyParser;
pub use source::{osv::OsvClient, VulnerabilitySource};
pub use spec::PackageSpec;
