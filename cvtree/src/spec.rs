use crate::error::{Error, Result};
use crate::model::Ecosystem;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageSpec {
    pub name: String,
    pub version: Option<String>,
    pub ecosystem: Option<Ecosystem>,
}

impl PackageSpec {
    pub fn parse(input: &str) -> Result<Self> {
        let input = input.trim();
        if input.is_empty() {
            return Err(Error::InvalidPackageSpec(
                "expected a package such as lodash@4.17.15".to_string(),
            ));
        }

        let (ecosystem, rest) = match input.split_once(':') {
            Some((prefix, rest)) if !prefix.is_empty() && !prefix.starts_with('@') => {
                (Some(prefix.parse::<Ecosystem>()?), rest)
            }
            _ => (None, input),
        };

        let (name, version) = match rest.rfind('@') {
            Some(0) | None => (rest, None),
            Some(index) => (&rest[..index], Some(&rest[index + 1..])),
        };

        if name.is_empty() {
            return Err(Error::InvalidPackageSpec(format!(
                "'{input}' is missing a package name"
            )));
        }
        if version.is_some_and(str::is_empty) {
            return Err(Error::InvalidPackageSpec(format!(
                "'{input}' is missing a version after '@'"
            )));
        }

        Ok(PackageSpec {
            name: name.to_string(),
            version: version.map(str::to_string),
            ecosystem,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(name: &str, version: Option<&str>, ecosystem: Option<Ecosystem>) -> PackageSpec {
        PackageSpec {
            name: name.to_string(),
            version: version.map(str::to_string),
            ecosystem,
        }
    }

    #[test]
    fn parses_bare_name() {
        assert_eq!(
            PackageSpec::parse("lodash").unwrap(),
            spec("lodash", None, None)
        );
    }

    #[test]
    fn parses_name_and_version() {
        assert_eq!(
            PackageSpec::parse("lodash@4.17.15").unwrap(),
            spec("lodash", Some("4.17.15"), None)
        );
    }

    #[test]
    fn parses_ecosystem_prefix() {
        assert_eq!(
            PackageSpec::parse("npm:lodash@4.17.15").unwrap(),
            spec("lodash", Some("4.17.15"), Some(Ecosystem::Npm))
        );
        assert_eq!(
            PackageSpec::parse("cargo:time@0.1.44").unwrap(),
            spec("time", Some("0.1.44"), Some(Ecosystem::CratesIo))
        );
        assert_eq!(
            PackageSpec::parse("crates.io:time").unwrap(),
            spec("time", None, Some(Ecosystem::CratesIo))
        );
    }

    #[test]
    fn parses_scoped_npm_packages() {
        assert_eq!(
            PackageSpec::parse("@babel/core").unwrap(),
            spec("@babel/core", None, None)
        );
        assert_eq!(
            PackageSpec::parse("@babel/core@7.0.0").unwrap(),
            spec("@babel/core", Some("7.0.0"), None)
        );
        assert_eq!(
            PackageSpec::parse("npm:@babel/core@7.0.0").unwrap(),
            spec("@babel/core", Some("7.0.0"), Some(Ecosystem::Npm))
        );
    }

    #[test]
    fn rejects_bad_input() {
        assert!(PackageSpec::parse("").is_err());
        assert!(PackageSpec::parse("lodash@").is_err());
        assert!(PackageSpec::parse("pypi:flask").is_err());
    }
}
