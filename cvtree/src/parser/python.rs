use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::model::{Dependency, DependencyTree, Ecosystem, NodeId};
use crate::parser::DependencyParser;

pub struct PythonParser;

const LOCKFILES: &[&str] = &[
    "poetry.lock",
    "pdm.lock",
    "uv.lock",
    "requirements.txt",
    "pyproject.toml",
];

#[derive(Debug, Clone)]
struct Package {
    name: String,
    version: String,
    dependencies: Vec<String>,
}

impl DependencyParser for PythonParser {
    fn ecosystem(&self) -> Ecosystem {
        Ecosystem::PyPi
    }

    fn lockfiles(&self) -> &'static [&'static str] {
        LOCKFILES
    }

    fn parse(&self, root: &Path) -> Result<DependencyTree> {
        let path = self
            .detected_lockfile(root)
            .ok_or_else(|| Error::NoLockfile(root.to_path_buf()))?;

        let packages = match path.file_name().and_then(|name| name.to_str()) {
            Some("requirements.txt") => requirements_packages(&path)?,
            Some("pyproject.toml") => pyproject_packages(&path)?,
            _ => lock_packages(&path)?,
        };

        let project = project_name(root).unwrap_or_else(|| "project".to_string());
        let declared = declared_requirements(root);
        let mut tree = DependencyTree::new(project, Ecosystem::PyPi);

        let mut ids: HashMap<String, NodeId> = HashMap::new();
        for package in &packages {
            let key = normalize(&package.name);
            let direct = declared.is_empty() || declared.contains(&key);
            let id = tree.add(
                Dependency::new(&package.name, &package.version, Ecosystem::PyPi),
                direct,
            );
            ids.insert(key, id);
        }

        for package in &packages {
            let Some(&parent) = ids.get(&normalize(&package.name)) else {
                continue;
            };
            for child in &package.dependencies {
                if let Some(&child) = ids.get(&normalize(child)) {
                    tree.link(parent, child);
                }
            }
        }

        Ok(tree)
    }
}

pub fn normalize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut separator = false;
    for character in name.chars() {
        if matches!(character, '-' | '_' | '.') {
            separator = true;
            continue;
        }
        if separator && !out.is_empty() {
            out.push('-');
        }
        separator = false;
        out.push(character.to_ascii_lowercase());
    }
    out
}

pub fn requirement_name(specifier: &str) -> Option<&str> {
    let specifier = specifier.split('#').next().unwrap_or(specifier).trim();
    if specifier.is_empty() || specifier.starts_with('-') {
        return None;
    }
    let end = specifier
        .find(|character: char| !character.is_ascii_alphanumeric() && !matches!(character, '-' | '_' | '.'))
        .unwrap_or(specifier.len());
    let name = &specifier[..end];
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn pinned_version(specifier: &str) -> Option<&str> {
    let specifier = specifier.split('#').next().unwrap_or(specifier);
    let specifier = specifier.split(';').next().unwrap_or(specifier).trim();
    let (_, rest) = specifier.split_once("==")?;
    let version = rest
        .split(',')
        .next()
        .unwrap_or(rest)
        .trim()
        .trim_matches(|character| character == '"' || character == '\'');
    if version.is_empty() || version.contains('*') {
        None
    } else {
        Some(version)
    }
}

fn requirements_packages(path: &Path) -> Result<Vec<Package>> {
    let contents = std::fs::read_to_string(path).map_err(|err| Error::io(path, err))?;
    let mut joined = String::new();
    for line in contents.lines() {
        let line = line.trim_end();
        if let Some(stripped) = line.strip_suffix('\\') {
            joined.push_str(stripped);
            continue;
        }
        joined.push_str(line);
        joined.push('\n');
    }

    let mut packages = Vec::new();
    for line in joined.lines() {
        let Some(name) = requirement_name(line) else {
            continue;
        };
        let Some(version) = pinned_version(line) else {
            continue;
        };
        packages.push(Package {
            name: name.to_string(),
            version: version.to_string(),
            dependencies: Vec::new(),
        });
    }
    Ok(packages)
}

fn pyproject_packages(path: &Path) -> Result<Vec<Package>> {
    let contents = std::fs::read_to_string(path).map_err(|err| Error::io(path, err))?;
    let document: toml::Value =
        toml::from_str(&contents).map_err(|err| Error::lockfile(path, err.message()))?;

    let mut packages = Vec::new();

    for specifier in project_dependency_specifiers(&document) {
        let Some(name) = requirement_name(&specifier) else {
            continue;
        };
        let Some(version) = pinned_version(&specifier) else {
            continue;
        };
        packages.push(Package {
            name: name.to_string(),
            version: version.to_string(),
            dependencies: Vec::new(),
        });
    }

    for (name, requirement) in poetry_dependency_entries(&document) {
        if normalize(&name) == "python" {
            continue;
        }
        let Some(version) = poetry_exact_version(&requirement) else {
            continue;
        };
        packages.push(Package {
            name,
            version,
            dependencies: Vec::new(),
        });
    }

    Ok(packages)
}

fn lock_packages(path: &Path) -> Result<Vec<Package>> {
    let contents = std::fs::read_to_string(path).map_err(|err| Error::io(path, err))?;
    let document: toml::Value =
        toml::from_str(&contents).map_err(|err| Error::lockfile(path, err.message()))?;

    let entries = document
        .get("package")
        .and_then(toml::Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut packages = Vec::new();
    for entry in entries {
        let Some(name) = entry.get("name").and_then(toml::Value::as_str) else {
            continue;
        };
        let Some(version) = entry.get("version").and_then(toml::Value::as_str) else {
            continue;
        };
        if entry.get("source").is_some_and(is_local_source) {
            continue;
        }
        packages.push(Package {
            name: name.to_string(),
            version: version.to_string(),
            dependencies: entry.get("dependencies").map(dependency_names).unwrap_or_default(),
        });
    }
    Ok(packages)
}

fn is_local_source(source: &toml::Value) -> bool {
    let Some(table) = source.as_table() else {
        return false;
    };
    table
        .keys()
        .any(|key| matches!(key.as_str(), "editable" | "virtual" | "directory" | "path"))
}

fn dependency_names(value: &toml::Value) -> Vec<String> {
    match value {
        toml::Value::Table(table) => table.keys().cloned().collect(),
        toml::Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                toml::Value::String(specifier) => {
                    requirement_name(specifier).map(str::to_string)
                }
                toml::Value::Table(table) => table
                    .get("name")
                    .and_then(toml::Value::as_str)
                    .map(str::to_string),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn declared_requirements(root: &Path) -> HashSet<String> {
    let Ok(contents) = std::fs::read_to_string(root.join("pyproject.toml")) else {
        return HashSet::new();
    };
    let Ok(document) = toml::from_str::<toml::Value>(&contents) else {
        return HashSet::new();
    };

    let mut names: HashSet<String> = project_dependency_specifiers(&document)
        .iter()
        .filter_map(|specifier| requirement_name(specifier))
        .map(normalize)
        .collect();

    for (name, _) in poetry_dependency_entries(&document) {
        let name = normalize(&name);
        if name != "python" {
            names.insert(name);
        }
    }

    names
}

fn project_dependency_specifiers(document: &toml::Value) -> Vec<String> {
    let mut specifiers = Vec::new();
    let Some(project) = document.get("project") else {
        return specifiers;
    };

    if let Some(items) = project.get("dependencies").and_then(toml::Value::as_array) {
        specifiers.extend(
            items
                .iter()
                .filter_map(toml::Value::as_str)
                .map(str::to_string),
        );
    }

    if let Some(groups) = project
        .get("optional-dependencies")
        .and_then(toml::Value::as_table)
    {
        for group in groups.values() {
            if let Some(items) = group.as_array() {
                specifiers.extend(
                    items
                        .iter()
                        .filter_map(toml::Value::as_str)
                        .map(str::to_string),
                );
            }
        }
    }

    specifiers
}

fn poetry_dependency_entries(document: &toml::Value) -> Vec<(String, toml::Value)> {
    let Some(poetry) = document.get("tool").and_then(|tool| tool.get("poetry")) else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    for key in ["dependencies", "dev-dependencies"] {
        if let Some(table) = poetry.get(key).and_then(toml::Value::as_table) {
            entries.extend(table.iter().map(|(name, value)| (name.clone(), value.clone())));
        }
    }

    if let Some(groups) = poetry.get("group").and_then(toml::Value::as_table) {
        for group in groups.values() {
            if let Some(table) = group.get("dependencies").and_then(toml::Value::as_table) {
                entries.extend(table.iter().map(|(name, value)| (name.clone(), value.clone())));
            }
        }
    }

    entries
}

fn poetry_exact_version(requirement: &toml::Value) -> Option<String> {
    let raw = match requirement {
        toml::Value::String(value) => value.as_str(),
        toml::Value::Table(table) => table.get("version").and_then(toml::Value::as_str)?,
        _ => return None,
    };
    let trimmed = raw.trim().trim_start_matches("==").trim();
    if trimmed.is_empty()
        || trimmed.starts_with(['^', '~', '>', '<', '!', '*'])
        || trimmed.contains('*')
        || trimmed.contains(',')
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn project_name(root: &Path) -> Option<String> {
    if let Ok(contents) = std::fs::read_to_string(root.join("pyproject.toml")) {
        if let Ok(document) = toml::from_str::<toml::Value>(&contents) {
            let declared = document
                .get("project")
                .and_then(|project| project.get("name"))
                .or_else(|| {
                    document
                        .get("tool")
                        .and_then(|tool| tool.get("poetry"))
                        .and_then(|poetry| poetry.get("name"))
                })
                .and_then(toml::Value::as_str);
            if let Some(name) = declared {
                return Some(name.to_string());
            }
        }
    }
    directory_name(root)
}

fn directory_name(root: &Path) -> Option<String> {
    let canonical: PathBuf = root.canonicalize().ok()?;
    canonical
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
}
