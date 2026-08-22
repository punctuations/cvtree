mod render;
mod style;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use cvtree::audit::PackageReport;
use cvtree::registry::RegistryClient;
use cvtree::{Dependency, Ecosystem, OsvClient, PackageSpec, Severity, VulnerabilitySource};

const EXIT_OK: u8 = 0;
const EXIT_VULNERABLE: u8 = 1;
const EXIT_ERROR: u8 = 2;

#[derive(Parser)]
#[command(
    name = "cvtree",
    version,
    about = "Dependency vulnerability auditing backed by the OSV database",
    after_help = "Exit codes:\n  0  no vulnerabilities at or above --fail-on\n  1  vulnerabilities at or above --fail-on were found\n  2  cvtree could not complete the request"
)]
struct Cli {
    #[arg(long, global = true, help = "Disable coloured output")]
    no_color: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    #[command(about = "Look up vulnerabilities for a single package version")]
    Search {
        #[arg(
            value_name = "PACKAGE",
            help = "lodash, lodash@4.17.15 or npm:lodash@4.17.15"
        )]
        package: String,

        #[arg(long, help = "Print the result as JSON")]
        json: bool,

        #[arg(short, long, value_name = "ECOSYSTEM", help = "npm, crates.io or PyPI")]
        ecosystem: Option<Ecosystem>,
    },

    #[command(about = "Audit the dependencies of a project from its lockfile")]
    Audit {
        #[arg(default_value = ".", value_name = "PATH", help = "Project directory")]
        path: PathBuf,

        #[arg(long, help = "Print the report as JSON")]
        json: bool,

        #[arg(
            long,
            value_name = "SEVERITY",
            help = "Exit with code 1 when a vulnerability at or above this severity is found"
        )]
        fail_on: Option<Severity>,

        #[arg(long, help = "Show how each vulnerable package entered the project")]
        tree: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    style::init(cli.no_color);

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("{}", render::error(&err.to_string()));
            return ExitCode::from(EXIT_ERROR);
        }
    };

    match runtime.block_on(run(cli.command)) {
        Ok(code) => ExitCode::from(code),
        Err(err) => {
            eprintln!("{}", render::error(&format_error(&err)));
            ExitCode::from(EXIT_ERROR)
        }
    }
}

async fn run(command: Command) -> anyhow::Result<u8> {
    match command {
        Command::Search {
            package,
            json,
            ecosystem,
        } => search(&package, json, ecosystem).await,
        Command::Audit {
            path,
            json,
            fail_on,
            tree,
        } => audit(&path, json, fail_on, tree).await,
    }
}

async fn search(input: &str, json: bool, flag: Option<Ecosystem>) -> anyhow::Result<u8> {
    let spec = PackageSpec::parse(input)?;
    let ecosystem = spec.ecosystem.or(flag).unwrap_or(Ecosystem::Npm);

    let version = match spec.version {
        Some(version) => version,
        None => {
            let resolved = RegistryClient::new()?
                .latest_version(&spec.name, ecosystem)
                .await?;
            if !json {
                eprintln!(
                    "{}",
                    style::dim(&format!(
                        "No version given, using the latest published version {resolved}."
                    ))
                );
            }
            resolved
        }
    };

    let package = Dependency::new(spec.name, version, ecosystem);
    let vulnerabilities = OsvClient::new()?.query(&package).await?;

    if json {
        let report = PackageReport::new(&package, vulnerabilities);
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        print!("{}", render::search(&package, &vulnerabilities));
    }

    Ok(EXIT_OK)
}

async fn audit(
    path: &Path,
    json: bool,
    fail_on: Option<Severity>,
    tree: bool,
) -> anyhow::Result<u8> {
    let project = cvtree::parser::discover(path).map_err(describe_missing_lockfile)?;
    let dependencies = project.parser.parse(&project.root)?;

    if !json {
        eprintln!(
            "{}",
            style::dim(&format!(
                "Auditing {} {} dependencies from {}",
                dependencies.dependencies().len(),
                dependencies.ecosystem,
                project.root.join(project.parser.lockfile()).display()
            ))
        );
    }

    let report = cvtree::audit_tree(&dependencies, &OsvClient::new()?).await?;

    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        print!("{}", render::audit(&report));
        if tree && !report.vulnerabilities.is_empty() {
            print!("{}", render::tree(&report));
        }
    }

    match fail_on {
        Some(threshold) if report.fails(threshold) => Ok(EXIT_VULNERABLE),
        _ => Ok(EXIT_OK),
    }
}

fn describe_missing_lockfile(error: cvtree::Error) -> anyhow::Error {
    match error {
        cvtree::Error::NoLockfile(path) => anyhow::anyhow!(
            "could not find a supported lockfile in {} or any parent directory.\n\nSupported lockfiles:\n{}",
            path.display(),
            cvtree::parser::supported_lockfiles()
                .iter()
                .map(|name| format!("  {name}"))
                .collect::<Vec<_>>()
                .join("\n")
        ),
        other => other.into(),
    }
}

fn format_error(error: &anyhow::Error) -> String {
    let mut message = error.to_string();
    for cause in error.chain().skip(1) {
        message.push_str(&format!("\n  caused by: {cause}"));
    }
    message
}
