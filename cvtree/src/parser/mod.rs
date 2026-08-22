pub mod cargo;
pub mod npm;

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::model::{DependencyTree, Ecosystem};

pub trait DependencyParser: Send + Sync {
    fn ecosystem(&self) -> Ecosystem;

    fn lockfile(&self) -> &'static str;

    fn detect(&self, root: &Path) -> bool {
        root.join(self.lockfile()).is_file()
    }

    fn parse(&self, root: &Path) -> Result<DependencyTree>;
}

pub fn all() -> Vec<Box<dyn DependencyParser>> {
    vec![
        Box::new(npm::NpmParser),
        Box::new(cargo::CargoParser),
    ]
}

pub fn supported_lockfiles() -> Vec<&'static str> {
    all().iter().map(|parser| parser.lockfile()).collect()
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
            .field("lockfile", &self.parser.lockfile())
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
