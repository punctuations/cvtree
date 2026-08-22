use std::path::{Path, PathBuf};

use cvtree::model::{Dependency, DependencyTree, Ecosystem};
use cvtree::parser;
use cvtree::DependencyParser;

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/lockfiles")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

fn project(files: &[(&str, &str)]) -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("temp dir");
    for (name, contents) in files {
        std::fs::write(directory.path().join(name), contents).expect("write fixture");
    }
    let root = directory.path().to_path_buf();
    (directory, root)
}

fn names(tree: &DependencyTree) -> Vec<String> {
    let mut names: Vec<String> = tree
        .dependencies()
        .iter()
        .map(Dependency::to_string)
        .collect();
    names.sort();
    names
}

fn path_to(tree: &DependencyTree, dependency: &Dependency) -> Vec<String> {
    let id = tree.find(dependency).expect("dependency in tree");
    tree.path_to(id).into_iter().map(Dependency::to_string).collect()
}

#[test]
fn parses_modern_npm_lockfile() {
    let (_dir, root) = project(&[("package-lock.json", &fixture("npm-v3-package-lock.json"))]);
    let tree = parser::npm::NpmParser.parse(&root).expect("parse");

    assert_eq!(tree.project, "demo-app");
    assert_eq!(tree.ecosystem, Ecosystem::Npm);
    assert_eq!(
        names(&tree),
        vec![
            "body-parser@1.20.2",
            "express@4.18.2",
            "lodash@4.17.15",
            "minimist@1.2.5",
            "qs@6.11.0",
            "qs@6.9.7",
        ]
    );
}

#[test]
fn npm_direct_dependencies_come_from_the_root_entry() {
    let (_dir, root) = project(&[("package-lock.json", &fixture("npm-v3-package-lock.json"))]);
    let tree = parser::npm::NpmParser.parse(&root).expect("parse");

    let mut direct: Vec<String> = tree
        .roots
        .iter()
        .map(|id| tree.node(*id).dependency.to_string())
        .collect();
    direct.sort();

    assert_eq!(
        direct,
        vec!["express@4.18.2", "lodash@4.17.15", "minimist@1.2.5"]
    );
}

#[test]
fn npm_resolves_nested_and_hoisted_copies() {
    let (_dir, root) = project(&[("package-lock.json", &fixture("npm-v3-package-lock.json"))]);
    let tree = parser::npm::NpmParser.parse(&root).expect("parse");

    let hoisted = Dependency::new("qs", "6.11.0", Ecosystem::Npm);
    assert_eq!(
        path_to(&tree, &hoisted),
        vec!["express@4.18.2", "body-parser@1.20.2", "qs@6.11.0"]
    );

    let nested = Dependency::new("qs", "6.9.7", Ecosystem::Npm);
    assert_eq!(path_to(&tree, &nested), vec!["express@4.18.2", "qs@6.9.7"]);
}

#[test]
fn npm_skips_linked_workspace_packages() {
    let (_dir, root) = project(&[("package-lock.json", &fixture("npm-v3-package-lock.json"))]);
    let tree = parser::npm::NpmParser.parse(&root).expect("parse");

    assert!(!names(&tree).iter().any(|name| name.starts_with("@demo/ui")));
}

#[test]
fn parses_legacy_npm_lockfile() {
    let (_dir, root) = project(&[("package-lock.json", &fixture("npm-v1-package-lock.json"))]);
    let tree = parser::npm::NpmParser.parse(&root).expect("parse");

    assert_eq!(tree.project, "legacy-app");
    assert_eq!(
        names(&tree),
        vec!["lodash@4.17.15", "minipass@2.9.0", "tar@4.4.13"]
    );
    assert_eq!(
        path_to(&tree, &Dependency::new("minipass", "2.9.0", Ecosystem::Npm)),
        vec!["tar@4.4.13", "minipass@2.9.0"]
    );
}

#[test]
fn parses_cargo_lockfile() {
    let (_dir, root) = project(&[("Cargo.lock", &fixture("Cargo.lock"))]);
    let tree = parser::cargo::CargoParser.parse(&root).expect("parse");

    assert_eq!(tree.project, "demo-crate");
    assert_eq!(tree.ecosystem, Ecosystem::CratesIo);
    assert_eq!(
        names(&tree),
        vec!["chrono@0.4.19", "libc@0.2.147", "smallvec@1.6.0", "time@0.1.44"]
    );
}

#[test]
fn cargo_excludes_the_local_crate_and_keeps_edges() {
    let (_dir, root) = project(&[("Cargo.lock", &fixture("Cargo.lock"))]);
    let tree = parser::cargo::CargoParser.parse(&root).expect("parse");

    let mut direct: Vec<String> = tree
        .roots
        .iter()
        .map(|id| tree.node(*id).dependency.to_string())
        .collect();
    direct.sort();
    assert_eq!(direct, vec!["chrono@0.4.19", "smallvec@1.6.0"]);

    assert_eq!(
        path_to(&tree, &Dependency::new("libc", "0.2.147", Ecosystem::CratesIo)),
        vec!["chrono@0.4.19", "time@0.1.44", "libc@0.2.147"]
    );
}

#[test]
fn cargo_prefers_the_manifest_name_for_the_project() {
    let manifest = "[package]\nname = \"renamed-crate\"\nversion = \"0.1.0\"\n";
    let (_dir, root) = project(&[
        ("Cargo.lock", &fixture("Cargo.lock")),
        ("Cargo.toml", manifest),
    ]);
    let tree = parser::cargo::CargoParser.parse(&root).expect("parse");

    assert_eq!(tree.project, "renamed-crate");
}

#[test]
fn detects_the_ecosystem_from_the_lockfile() {
    let (_npm, npm_root) = project(&[("package-lock.json", &fixture("npm-v3-package-lock.json"))]);
    let (_cargo, cargo_root) = project(&[("Cargo.lock", &fixture("Cargo.lock"))]);

    assert_eq!(
        parser::detect(&npm_root).map(|parser| parser.ecosystem()),
        Some(Ecosystem::Npm)
    );
    assert_eq!(
        parser::detect(&cargo_root).map(|parser| parser.ecosystem()),
        Some(Ecosystem::CratesIo)
    );
}

#[test]
fn discovery_walks_up_to_the_project_root() {
    let (_dir, root) = project(&[("Cargo.lock", &fixture("Cargo.lock"))]);
    let nested = root.join("src/deeply/nested");
    std::fs::create_dir_all(&nested).expect("create nested directories");

    let project = parser::discover(&nested).expect("discover");
    assert_eq!(
        project.root.canonicalize().unwrap(),
        root.canonicalize().unwrap()
    );
    assert_eq!(project.parser.lockfile(), "Cargo.lock");
}

#[test]
fn discovery_reports_missing_lockfiles() {
    let (_dir, root) = project(&[("README.md", "nothing to audit here")]);

    let error = parser::discover(&root).expect_err("no lockfile");
    assert!(matches!(error, cvtree::Error::NoLockfile(_)));
    assert_eq!(
        parser::supported_lockfiles(),
        vec!["package-lock.json", "Cargo.lock"]
    );
}

#[test]
fn reports_broken_lockfiles_with_the_path() {
    let (_dir, root) = project(&[("package-lock.json", "{ not json")]);

    let error = parser::npm::NpmParser.parse(&root).expect_err("invalid json");
    let message = error.to_string();
    assert!(message.contains("package-lock.json"), "{message}");
}
