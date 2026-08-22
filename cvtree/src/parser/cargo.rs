use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::model::{Dependency, DependencyTree, Ecosystem, NodeId};
use crate::parser::DependencyParser;

pub struct CargoParser;

#[derive(Debug, Deserialize)]
struct Lockfile {
    #[serde(default)]
    package: Vec<LockedPackage>,
}

#[derive(Debug, Deserialize)]
struct LockedPackage {
    name: String,
    version: String,
    source: Option<String>,
    #[serde(default)]
    dependencies: Vec<String>,
}

impl LockedPackage {
    fn is_local(&self) -> bool {
        self.source.is_none()
    }
}

impl DependencyParser for CargoParser {
    fn ecosystem(&self) -> Ecosystem {
        Ecosystem::CratesIo
    }

    fn lockfiles(&self) -> &'static [&'static str] {
        &["Cargo.lock"]
    }

    fn parse(&self, root: &Path) -> Result<DependencyTree> {
        let path = root.join(self.lockfile());
        let contents = std::fs::read_to_string(&path).map_err(|err| Error::io(&path, err))?;
        let lockfile: Lockfile =
            toml::from_str(&contents).map_err(|err| Error::lockfile(&path, err.message()))?;

        let project = project_name_from_manifest(root)
            .or_else(|| {
                lockfile
                    .package
                    .iter()
                    .find(|package| package.is_local())
                    .map(|package| package.name.clone())
            })
            .or_else(|| directory_name(root))
            .unwrap_or_else(|| "project".to_string());

        let mut tree = DependencyTree::new(project, Ecosystem::CratesIo);
        let has_local = lockfile.package.iter().any(LockedPackage::is_local);

        let direct: Vec<&str> = if has_local {
            lockfile
                .package
                .iter()
                .filter(|package| package.is_local())
                .flat_map(|package| package.dependencies.iter())
                .map(String::as_str)
                .collect()
        } else {
            Vec::new()
        };

        let mut ids: HashMap<(&str, &str), NodeId> = HashMap::new();
        for package in &lockfile.package {
            if has_local && package.is_local() {
                continue;
            }
            let is_direct = !has_local
                || direct
                    .iter()
                    .any(|entry| dependency_matches(entry, &package.name, &package.version));
            let id = tree.add(
                Dependency::new(&package.name, &package.version, Ecosystem::CratesIo),
                is_direct,
            );
            ids.insert((package.name.as_str(), package.version.as_str()), id);
        }

        for package in &lockfile.package {
            let Some(&parent) = ids.get(&(package.name.as_str(), package.version.as_str())) else {
                continue;
            };
            for entry in &package.dependencies {
                if let Some(child) = resolve(entry, &ids) {
                    tree.link(parent, child);
                }
            }
        }

        Ok(tree)
    }
}

fn resolve(entry: &str, ids: &HashMap<(&str, &str), NodeId>) -> Option<NodeId> {
    let (name, version) = split_entry(entry);
    match version {
        Some(version) => ids.get(&(name, version)).copied(),
        None => ids
            .iter()
            .find(|((candidate, _), _)| *candidate == name)
            .map(|(_, &id)| id),
    }
}

fn dependency_matches(entry: &str, name: &str, version: &str) -> bool {
    let (entry_name, entry_version) = split_entry(entry);
    entry_name == name && entry_version.is_none_or(|value| value == version)
}

fn split_entry(entry: &str) -> (&str, Option<&str>) {
    let entry = entry.split(" (").next().unwrap_or(entry).trim();
    match entry.split_once(' ') {
        Some((name, version)) => (name, Some(version.trim())),
        None => (entry, None),
    }
}

fn project_name_from_manifest(root: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(root.join("Cargo.toml")).ok()?;
    let manifest: toml::Value = toml::from_str(&contents).ok()?;
    manifest
        .get("package")
        .and_then(|package| package.get("name"))
        .and_then(|name| name.as_str())
        .map(str::to_string)
}

fn directory_name(root: &Path) -> Option<String> {
    root.canonicalize()
        .ok()?
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
}
