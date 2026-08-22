use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Ecosystem {
    #[serde(rename = "npm")]
    Npm,
    #[serde(rename = "crates.io")]
    CratesIo,
    #[serde(rename = "PyPI")]
    PyPi,
}

impl Ecosystem {
    pub const ALL: [Ecosystem; 3] = [Ecosystem::Npm, Ecosystem::CratesIo, Ecosystem::PyPi];

    pub fn osv_name(&self) -> &'static str {
        match self {
            Ecosystem::Npm => "npm",
            Ecosystem::CratesIo => "crates.io",
            Ecosystem::PyPi => "PyPI",
        }
    }

    pub fn lockfile(&self) -> Option<&'static str> {
        match self {
            Ecosystem::Npm => Some("package-lock.json"),
            Ecosystem::CratesIo => Some("Cargo.lock"),
            Ecosystem::PyPi => None, // TODO: add reuirements.txt
        }
    }
}

impl fmt::Display for Ecosystem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.osv_name())
    }
}

impl FromStr for Ecosystem {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "npm" | "node" | "javascript" => Ok(Ecosystem::Npm),
            "crates.io" | "crates" | "cargo" | "rust" => Ok(Ecosystem::CratesIo),
            "pypi" | "pip" | "python" => Ok(Ecosystem::PyPi),
            other => Err(Error::UnknownEcosystem(other.to_string())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Dependency {
    pub name: String,
    pub version: String,
    pub ecosystem: Ecosystem,
}

impl Dependency {
    pub fn new(name: impl Into<String>, version: impl Into<String>, ecosystem: Ecosystem) -> Self {
        Dependency {
            name: name.into(),
            version: version.into(),
            ecosystem,
        }
    }
}

impl fmt::Display for Dependency {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}@{}", self.name, self.version)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub const ALL: [Severity; 4] = [
        Severity::Critical,
        Severity::High,
        Severity::Medium,
        Severity::Low,
    ];

    pub fn label(&self) -> &'static str {
        match self {
            Severity::Low => "LOW",
            Severity::Medium => "MEDIUM",
            Severity::High => "HIGH",
            Severity::Critical => "CRITICAL",
        }
    }
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

impl FromStr for Severity {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "low" => Ok(Severity::Low),
            "medium" | "moderate" => Ok(Severity::Medium),
            "high" => Ok(Severity::High),
            "critical" => Ok(Severity::Critical),
            other => Err(Error::InvalidPackageSpec(format!(
                "unknown severity '{other}' (expected low, medium, high or critical)"
            ))),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AffectedRange {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub introduced: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_affected: Option<String>,
}

impl fmt::Display for AffectedRange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut parts = Vec::new();
        match self.introduced.as_deref() {
            Some("0") | Some("0.0.0") | Some("0.0.0-0") | None => {}
            Some(v) => parts.push(format!(">= {v}")),
        }
        if let Some(v) = &self.fixed {
            parts.push(format!("< {v}"));
        } else if let Some(v) = &self.last_affected {
            parts.push(format!("<= {v}"));
        }
        if parts.is_empty() {
            f.write_str("all versions")
        } else {
            f.write_str(&parts.join(", "))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reference {
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Vulnerability {
    pub id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    pub package: Dependency,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<Severity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cvss_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cvss_vector: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub affected: Vec<AffectedRange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fixed_versions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<Reference>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub withdrawn: Option<String>,
}

impl Vulnerability {
    pub fn cve(&self) -> Option<&str> {
        self.aliases
            .iter()
            .map(String::as_str)
            .find(|alias| alias.starts_with("CVE-"))
    }

    pub fn primary_reference(&self) -> Option<&Reference> {
        self.references
            .iter()
            .find(|r| r.kind == "ADVISORY")
            .or_else(|| self.references.first())
    }

    pub fn title(&self) -> &str {
        match self.summary.as_deref() {
            Some(summary) if !summary.is_empty() => summary,
            _ => "No summary provided",
        }
    }
}

pub type NodeId = usize;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub dependency: Dependency,
    pub children: Vec<NodeId>,
    pub direct: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyTree {
    pub project: String,
    pub ecosystem: Ecosystem,
    pub roots: Vec<NodeId>,
    nodes: Vec<Node>,
}

impl DependencyTree {
    pub fn new(project: impl Into<String>, ecosystem: Ecosystem) -> Self {
        DependencyTree {
            project: project.into(),
            ecosystem,
            roots: Vec::new(),
            nodes: Vec::new(),
        }
    }

    pub fn add(&mut self, dependency: Dependency, direct: bool) -> NodeId {
        let id = self.nodes.len();
        self.nodes.push(Node {
            dependency,
            children: Vec::new(),
            direct,
        });
        if direct {
            self.roots.push(id);
        }
        id
    }

    pub fn link(&mut self, parent: NodeId, child: NodeId) {
        if parent == child {
            return;
        }
        let children = &mut self.nodes[parent].children;
        if !children.contains(&child) {
            children.push(child);
        }
    }

    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id]
    }

    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    pub fn dependencies(&self) -> Vec<Dependency> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for node in &self.nodes {
            if seen.insert(node.dependency.clone()) {
                out.push(node.dependency.clone());
            }
        }
        out
    }

    pub fn find(&self, dependency: &Dependency) -> Option<NodeId> {
        self.nodes.iter().position(|n| &n.dependency == dependency)
    }

    pub fn path_to(&self, target: NodeId) -> Vec<&Dependency> {
        let mut parents: HashMap<NodeId, NodeId> = HashMap::new();
        let mut queue: VecDeque<NodeId> = self.roots.iter().copied().collect();
        let mut seen: HashSet<NodeId> = self.roots.iter().copied().collect();

        while let Some(current) = queue.pop_front() {
            if current == target {
                let mut path = vec![current];
                let mut cursor = current;
                while let Some(&parent) = parents.get(&cursor) {
                    path.push(parent);
                    cursor = parent;
                }
                path.reverse();
                return path
                    .into_iter()
                    .map(|id| &self.nodes[id].dependency)
                    .collect();
            }
            for &child in &self.nodes[current].children {
                if seen.insert(child) {
                    parents.insert(child, current);
                    queue.push_back(child);
                }
            }
        }

        if target < self.nodes.len() {
            vec![&self.nodes[target].dependency]
        } else {
            Vec::new()
        }
    }
}
