pub mod cargo;
pub mod npm;
pub mod python;

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::model::{DependencyTree, Ecosystem};

pub trait DependencyParser: Send + Sync {
    fn ecosystem(&self) -> Ecosystem;

    fn lockfiles(&self) -> &'static [&'static str];

    fn lockfile(&self) -> &'static str {
        self.lockfiles()[0]
    }

    fn detected_lockfile(&self, root: &Path) -> Option<PathBuf> {
        self.lockfiles()
            .iter()
            .map(|name| root.join(name))
            .find(|path| path.is_file())
    }

    fn detect(&self, root: &Path) -> bool {
        self.detected_lockfile(root).is_some()
    }

    fn parse(&self, root: &Path) -> Result<DependencyTree>;
}

pub fn all() -> Vec<Box<dyn DependencyParser>> {
    vec![
        Box::new(npm::NpmParser),
        Box::new(cargo::CargoParser),
        Box::new(python::PythonParser),
    ]
}

pub fn supported_lockfiles() -> Vec<&'static str> {
    all()
        .iter()
        .flat_map(|parser| parser.lockfiles().iter().copied())
        .collect()
}

pub fn detect(root: &Path) -> Option<Box<dyn DependencyParser>> {
    all().into_iter().find(|parser| parser.detect(root))
}

pub struct Project {
    pub root: PathBuf,
    pub parser: Box<dyn DependencyParser>,
}

impl std::fmt::Debug for Project {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Project")
            .field("root", &self.root)
            .field("lockfile", &self.parser.detected_lockfile(&self.root))
            .finish()
    }
}

pub fn discover(start: &Path) -> Result<Project> {
    let mut current = Some(start);

    while let Some(directory) = current {
        if let Some(parser) = detect(directory) {
            return Ok(Project {
                root: directory.to_path_buf(),
                parser,
            });
        }
        current = directory.parent();
    }

    Err(Error::NoLockfile(start.to_path_buf()))
}
