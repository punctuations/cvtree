use std::fmt;
use std::path::PathBuf;

use crate::model::Ecosystem;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no supported lockfile found under {0}")]
    NoLockfile(PathBuf),

    #[error("failed to read {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to parse {path}: {message}")]
    Lockfile { path: PathBuf, message: String },

    #[error("{0}")]
    InvalidPackageSpec(String),

    #[error("unknown ecosystem '{0}' (supported: npm, crates.io, PyPI)")]
    UnknownEcosystem(String),

    #[error("failed to query {source_name}: {message}")]
    Source {
        source_name: &'static str,
        message: String,
    },

    #[error("could not resolve the latest version of {name} on {ecosystem}: {message}")]
    VersionResolution {
        name: String,
        ecosystem: Ecosystem,
        message: String,
    },
}

impl Error {
    pub fn lockfile(path: impl Into<PathBuf>, message: impl fmt::Display) -> Self {
        Error::Lockfile {
            path: path.into(),
            message: message.to_string(),
        }
    }

    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Error::Io {
            path: path.into(),
            source,
        }
    }

    pub fn source(source_name: &'static str, message: impl fmt::Display) -> Self {
        Error::Source {
            source_name,
            message: message.to_string(),
        }
    }
}
