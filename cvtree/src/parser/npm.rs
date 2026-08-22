use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::model::{Dependency, DependencyTree, Ecosystem, NodeId};
use crate::parser::DependencyParser;

pub struct NpmParser;

#[derive(Debug, Deserialize)]
struct Lockfile {
    name: Option<String>,
    #[serde(default)]
    packages: HashMap<String, LockedPackage>,
    #[serde(default)]
    dependencies: HashMap<String, LegacyPackage>,
}

#[derive(Debug, Deserialize)]
struct LockedPackage {
    name: Option<String>,
    version: Option<String>,
    #[serde(default)]
    link: bool,
    #[serde(default)]
    dependencies: HashMap<String, String>,
    #[serde(default, rename = "devDependencies")]
    dev_dependencies: HashMap<String, String>,
    #[serde(default, rename = "optionalDependencies")]
    optional_dependencies: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct LegacyPackage {
    version: Option<String>,
    #[serde(default)]
    dependencies: HashMap<String, LegacyPackage>,
}

impl DependencyParser for NpmParser {
    fn ecosystem(&self) -> Ecosystem {
        Ecosystem::Npm
    }

    fn lockfile(&self) -> &'static str {
        "package-lock.json"
    }

    fn parse(&self, root: &Path) -> Result<DependencyTree> {
        let path = root.join(self.lockfile());
        let contents = std::fs::read_to_string(&path).map_err(|err| Error::io(&path, err))?;
        let lockfile: Lockfile =
            serde_json::from_str(&contents).map_err(|err| Error::lockfile(&path, err))?;

        let project = lockfile
            .name
            .clone()
            .or_else(|| project_name_from_manifest(root))
            .or_else(|| directory_name(root))
            .unwrap_or_else(|| "project".to_string());

        let mut tree = DependencyTree::new(project, Ecosystem::Npm);
        if lockfile.packages.is_empty() {
            build_legacy(&mut tree, &lockfile.dependencies);
        } else {
            build_modern(&mut tree, &lockfile.packages);
        }
        Ok(tree)
    }
}

fn build_modern(tree: &mut DependencyTree, packages: &HashMap<String, LockedPackage>) {
    let direct: Vec<String> = packages
        .get("")
        .map(|root| {
            root.dependencies
                .keys()
                .chain(root.dev_dependencies.keys())
                .chain(root.optional_dependencies.keys())
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    let mut installed: Vec<(&String, &LockedPackage)> = packages
        .iter()
        .filter(|(path, package)| {
            !path.is_empty() && path.contains("node_modules/") && !package.link
        })
        .collect();
    installed.sort_by(|a, b| a.0.cmp(b.0));

    let mut ids: HashMap<&str, NodeId> = HashMap::new();
    for (path, package) in &installed {
        let (Some(version), Some(name)) = (package.version.as_ref(), package_name(path, package))
        else {
            continue;
        };
        let is_direct = path_depth(path) == 1 && direct.contains(&name);
        let id = tree.add(Dependency::new(name, version, Ecosystem::Npm), is_direct);
        ids.insert(path.as_str(), id);
    }

    for (path, package) in &installed {
        let Some(&parent) = ids.get(path.as_str()) else {
            continue;
        };
        for name in package
            .dependencies
            .keys()
            .chain(package.optional_dependencies.keys())
        {
            if let Some(child) = resolve(path, name, &ids) {
                tree.link(parent, child);
            }
        }
    }
}

fn resolve(from: &str, name: &str, ids: &HashMap<&str, NodeId>) -> Option<NodeId> {
    let mut scope = from;
    loop {
        let candidate = if scope.is_empty() {
            format!("node_modules/{name}")
        } else {
            format!("{scope}/node_modules/{name}")
        };
        if let Some(&id) = ids.get(candidate.as_str()) {
            return Some(id);
        }
        match scope.rfind("/node_modules/") {
            Some(index) => scope = &scope[..index],
            None if scope.is_empty() => return None,
            None => scope = "",
        }
    }
}

fn package_name(path: &str, package: &LockedPackage) -> Option<String> {
    package.name.clone().or_else(|| {
        path.rsplit_once("node_modules/")
            .map(|(_, name)| name.to_string())
    })
}

fn path_depth(path: &str) -> usize {
    path.matches("node_modules/").count()
}

fn build_legacy(tree: &mut DependencyTree, dependencies: &HashMap<String, LegacyPackage>) {
    let mut names: Vec<&String> = dependencies.keys().collect();
    names.sort();
    for name in names {
        let package = &dependencies[name];
        if let Some(id) = add_legacy(tree, name, package, true) {
            let _ = id;
        }
    }
}

fn add_legacy(
    tree: &mut DependencyTree,
    name: &str,
    package: &LegacyPackage,
    direct: bool,
) -> Option<NodeId> {
    let version = package.version.as_ref()?;
    let id = tree.add(Dependency::new(name, version, Ecosystem::Npm), direct);

    let mut children: Vec<&String> = package.dependencies.keys().collect();
    children.sort();
    for child_name in children {
        if let Some(child) = add_legacy(tree, child_name, &package.dependencies[child_name], false)
        {
            tree.link(id, child);
        }
    }
    Some(id)
}

fn project_name_from_manifest(root: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(root.join("package.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&contents).ok()?;
    manifest.get("name")?.as_str().map(str::to_string)
}

fn directory_name(root: &Path) -> Option<String> {
    root.canonicalize()
        .ok()?
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
}
