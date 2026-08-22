mod render;
mod style;

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::{ Path, PathBuf };
use std::process::{ Command as ProcessCommand, ExitCode, Stdio };
use std::io::IsTerminal;

use clap::{ Parser, Subcommand };
use cvtree::audit::{AuditReport, PackageReport};
use cvtree::registry::RegistryClient;
use cvtree::{ Dependency, Ecosystem, OsvClient, PackageSpec, Severity, VulnerabilitySource };

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
    #[command(about = "Look up vulnerabilities for a single package version")] Search {
        #[arg(value_name = "PACKAGE", help = "lodash, lodash@4.17.15 or npm:lodash@4.17.15")]
        package: String,

        #[arg(long, help = "Print the result as JSON")]
        json: bool,

        #[arg(short, long, value_name = "ECOSYSTEM", help = "npm, crates.io or PyPI")]
        ecosystem: Option<Ecosystem>,
    },

    #[command(about = "Audit the dependencies of a project from its lockfile")] Audit {
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

        #[arg(long, help = "Run leak detection (search for leaked keys and .env exposure)")]
        leak: bool,
    },

    #[command(about = "Recursively find project roots that contain supported lockfiles")] Crawl {
        #[arg(default_value = ".", value_name = "PATH", help = "Directory to scan recursively")]
        path: PathBuf,

        #[arg(long, value_name = "N", help = "Stop after scanning this many directories")]
        stop: Option<usize>,

        #[arg(long, help = "Print the result as JSON")]
        json: bool,
    },

    #[command(about = "Attempt to fix discovered vulnerabilities in a project")] Fix {
        #[arg(default_value = ".", value_name = "PATH", help = "Project directory")]
        path: PathBuf,

        #[arg(long, help = "Print the planned fixes without running them")]
        dry_run: bool,

        #[arg(long, help = "Print the result as JSON")]
        json: bool,

        #[arg(short = 'y', long, help = "Apply the fixes without asking for confirmation")]
        yes: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    style::init(cli.no_color);

    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
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
        Command::Search { package, json, ecosystem } => search(&package, json, ecosystem).await,
        Command::Audit { path, json, fail_on, tree, leak } =>
            audit(&path, json, fail_on, tree, leak).await,
        Command::Crawl { path, stop, json } => crawl(&path, stop, json),
        Command::Fix { path, dry_run, json, yes } => fix(&path, json, dry_run, yes).await,
    }
}

async fn search(input: &str, json: bool, flag: Option<Ecosystem>) -> anyhow::Result<u8> {
    let spec = PackageSpec::parse(input)?;
    let ecosystem = spec.ecosystem.or(flag).unwrap_or(Ecosystem::Npm);

    let version = match spec.version {
        Some(version) => version,
        None => {
            let resolved = RegistryClient::new()?.latest_version(&spec.name, ecosystem).await?;
            if !json {
                eprintln!(
                    "{}",
                    style::dim(
                        &format!("No version given, using the latest published version {resolved}.")
                    )
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
    leak: bool
) -> anyhow::Result<u8> {
    let project = cvtree::parser::discover(path).map_err(describe_missing_lockfile)?;
    let dependencies = project.parser.parse(&project.root)?;

    if !json {
        eprintln!(
            "{}",
            style::dim(
                &format!(
                    "Auditing {} {} dependencies from {}",
                    dependencies.dependencies().len(),
                    dependencies.ecosystem,
                    project
                        .parser
                        .detected_lockfile(&project.root)
                        .unwrap_or_else(|| project.root.join(project.parser.lockfile()))
                        .display()
                )
            )
        );
    }

    let leaks = if leak {
        if !json {
            eprintln!("{}", style::dim("Running leak-detection checks..."));
        }
        let leaks = detect_leaks(&project.root)?;
        if !json {
            let visible_findings: Vec<_> = leaks
                .findings
                .iter()
                .filter(|f| matches!(f.kind.as_str(), "known_prefix" | "private_key" | "base64"))
                .collect();
            if !visible_findings.is_empty() {
                eprintln!("{}", style::dim("Potential leak findings:"));
                for f in visible_findings {
                    let marker = match f.kind.as_str() {
                        "known_prefix" => "[ALERT]",
                        "private_key" => "[ALERT]",
                        "base64" => "[WARN]",
                        _ => continue,
                    };
                    let color = match f.kind.as_str() {
                        "known_prefix" | "private_key" => style::red,
                        "base64" => style::yellow,
                        _ => style::cyan,
                    };
                let reason = match f.kind.as_str() {
                    "known_prefix" => "known secret prefix",
                    "private_key" => "private key header",
                    "base64" => "base64-like secret",
                    _ => "suspicious token",
                };
                eprintln!(
                    "  {} {} {}",
                    color(marker),
                    style::bold(&f.file.display().to_string()),
                    style::dim(&format!("({reason})"))
                );
            }
            if leaks.env_present && !leaks.env_ignored {
                eprintln!(
                    "{}",
                    style::yellow("[WARN] .env present but not listed in .gitignore — potential leak")
                );
            }
            } else {
            eprintln!("{}", style::dim("No likely leaks detected."));
            }
        }
        Some(leaks)
    } else {
        None
    };

    let report = cvtree::audit_tree(&dependencies, &OsvClient::new()?).await?;
    let exit_code = match fail_on {
        Some(threshold) if report.fails(threshold) => EXIT_VULNERABLE,
        _ => EXIT_OK,
    };

    if json {
        if let Some(leaks) = leaks {
            #[derive(serde::Serialize)]
            struct AuditJson {
                leaks: LeakReport,
                report: cvtree::audit::AuditReport,
            }
            let payload = AuditJson { leaks, report };
            println!("{}", serde_json::to_string_pretty(&payload)?);
        } else {
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
    } else {
        print!("{}", render::audit(&report));
        if tree && !report.vulnerabilities.is_empty() {
            print!("{}", render::tree(&report));
        }
    }

    Ok(exit_code)
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
struct FixTarget {
    package: String,
    current: String,
    version: String,
    direct: bool,
    breaking: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
struct Unfixable {
    package: String,
    version: String,
    advisories: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverrideStyle {
    Requirements,
    Pins,
}

#[derive(Debug, Default, serde::Serialize)]
struct FixOutcome {
    workflow: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    updated_files: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    applied: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    failed: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    notes: Vec<String>,
}

async fn fix(path: &Path, json: bool, dry_run: bool, assume_yes: bool) -> anyhow::Result<u8> {
    let project = cvtree::parser::discover(path).map_err(describe_missing_lockfile)?;
    let dependencies = project.parser.parse(&project.root)?;
    let report = cvtree::audit_tree(&dependencies, &OsvClient::new()?).await?;
    let fixes = select_fix_targets(&report);
    let unfixable = select_unfixable(&report);
    let ecosystem = project.parser.ecosystem();

    if fixes.is_empty() {
        if json {
            let payload = serde_json::json!({
                "project": report.project,
                "ecosystem": ecosystem.to_string(),
                "vulnerabilities": report.vulnerabilities.len(),
                "fixes": fixes,
                "unfixable": unfixable,
                "dry_run": dry_run,
                "status": "nothing-to-fix",
            });
            println!("{}", serde_json::to_string_pretty(&payload)?);
        } else if report.vulnerabilities.is_empty() {
            println!(
                "{}",
                style::green("No vulnerabilities were found, so there is nothing to fix.")
            );
        } else {
            println!(
                "{}",
                style::yellow(&format!(
                    "{} vulnerability(s) found, but none of them have a published fixed version yet.",
                    report.vulnerabilities.len()
                ))
            );
            print_unfixable(&unfixable, false);
        }
        return Ok(EXIT_OK);
    }

    if !json {
        let emit = |line: String| {
            if dry_run {
                println!("{line}");
            } else {
                eprintln!("{line}");
            }
        };
        emit(
            style::dim(&format!(
                "Found {} vulnerable package(s) with a fix available.",
                fixes.len()
            ))
        );
        for target in &fixes {
            emit(format!(
                "  {} {} {} {} {}",
                style::bold(&target.package),
                style::dim(&target.current),
                style::dim("->"),
                style::green(&target.version),
                style::dim(&format!(
                    "({}{})",
                    if target.direct { "direct" } else { "transitive" },
                    if target.breaking { ", breaking" } else { "" }
                ))
            ));
        }

        let breaking: Vec<&str> = fixes
            .iter()
            .filter(|target| target.breaking)
            .map(|target| target.package.as_str())
            .collect();
        if !breaking.is_empty() {
            emit(style::yellow(&format!(
                "{} of these cross a compatibility boundary and can break the build: {}",
                breaking.len(),
                breaking.join(", ")
            )));
        }

        print_unfixable(&unfixable, dry_run);
    }

    if dry_run {
        if json {
            let payload = serde_json::json!({
                "project": report.project,
                "ecosystem": ecosystem.to_string(),
                "vulnerabilities": report.vulnerabilities.len(),
                "fixes": fixes,
                "unfixable": unfixable,
                "dry_run": true,
                "status": "planned",
            });
            println!("{}", serde_json::to_string_pretty(&payload)?);
        }
        return Ok(EXIT_OK);
    }

    if !assume_yes && !json && !confirm(&format!(
        "Apply {} fix(es) to {}?",
        fixes.len(),
        project.root.display()
    ))? {
        if json {
            let payload = serde_json::json!({
                "project": report.project,
                "ecosystem": ecosystem.to_string(),
                "fixes": fixes,
                "status": "cancelled",
            });
            println!("{}", serde_json::to_string_pretty(&payload)?);
        } else {
            eprintln!("{}", style::dim("Cancelled, nothing was changed."));
        }
        return Ok(EXIT_OK);
    }

    let outcome = match ecosystem {
        Ecosystem::Npm => fix_npm(&project.root, &fixes, json)?,
        Ecosystem::CratesIo => fix_cargo(&project.root, &fixes, json)?,
        Ecosystem::PyPi => fix_python(&project.root, &fixes, json)?,
    };

    let incomplete = !outcome.failed.is_empty();

    if json {
        let payload = serde_json::json!({
            "project": report.project,
            "ecosystem": ecosystem.to_string(),
            "vulnerabilities": report.vulnerabilities.len(),
            "fixes": fixes,
            "unfixable": unfixable,
            "dry_run": false,
            "outcome": outcome,
            "status": if incomplete { "partial" } else { "fixed" },
        });
        println!("{}", serde_json::to_string_pretty(&payload)?);
    } else {
        for file in &outcome.updated_files {
            println!("{} {}", style::green("updated"), file);
        }
        for note in &outcome.notes {
            println!("{}", style::dim(note));
        }
        for failure in &outcome.failed {
            eprintln!("{} {}", style::red("failed"), failure);
        }
        if incomplete {
            println!(
                "{}",
                style::yellow(&format!(
                    "Applied {} of {} fix(es) in {}.",
                    outcome.applied.len(),
                    fixes.len(),
                    report.project
                ))
            );
        } else {
            println!(
                "{}",
                style::green(&format!(
                    "Applied fixes for {} package(s) in {}. Re-run cvtree audit to confirm.",
                    fixes.len(),
                    report.project
                ))
            );
        }
    }

    Ok(if incomplete { EXIT_VULNERABLE } else { EXIT_OK })
}

fn print_unfixable(unfixable: &[Unfixable], to_stdout: bool) {
    if unfixable.is_empty() {
        return;
    }
    let mut lines = vec![style::dim("No fixed version has been published for:")];
    for entry in unfixable {
        lines.push(format!(
            "  {} {} {}",
            style::bold(&entry.package),
            style::dim(&entry.version),
            style::dim(&format!("({})", entry.advisories.join(", ")))
        ));
    }
    for line in lines {
        if to_stdout {
            println!("{line}");
        } else {
            eprintln!("{line}");
        }
    }
}

fn select_fix_targets(report: &AuditReport) -> Vec<FixTarget> {
    let mut best: BTreeMap<String, FixTarget> = BTreeMap::new();

    for finding in &report.vulnerabilities {
        let Some(version) = best_fix_version(&finding.fixed_versions) else {
            continue;
        };
        let candidate = FixTarget {
            package: finding.package.clone(),
            current: finding.version.clone(),
            version,
            direct: !finding.is_transitive(),
            breaking: false,
        };
        match best.get_mut(&finding.package) {
            Some(existing) => {
                if compare_versions(&candidate.version, &existing.version) == Ordering::Greater {
                    existing.version = candidate.version;
                }
                existing.direct |= candidate.direct;
            }
            None => {
                best.insert(finding.package.clone(), candidate);
            }
        }
    }

    best.into_values()
        .filter(|target| compare_versions(&target.version, &target.current) == Ordering::Greater)
        .map(|target| FixTarget {
            breaking: crosses_compatibility_boundary(&target.current, &target.version),
            ..target
        })
        .collect()
}

fn select_unfixable(report: &AuditReport) -> Vec<Unfixable> {
    let mut grouped: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for finding in &report.vulnerabilities {
        if best_fix_version(&finding.fixed_versions).is_some() {
            continue;
        }
        grouped
            .entry((finding.package.clone(), finding.version.clone()))
            .or_default()
            .push(finding.identifier().to_string());
    }
    grouped
        .into_iter()
        .map(|((package, version), advisories)| Unfixable {
            package,
            version,
            advisories,
        })
        .collect()
}

fn crosses_compatibility_boundary(current: &str, fixed: &str) -> bool {
    if let (Ok(current), Ok(fixed)) = (
        semver::Version::parse(current),
        semver::Version::parse(fixed),
    ) {
        if current.major != fixed.major {
            return true;
        }
        return current.major == 0 && current.minor != fixed.minor;
    }

    let current = numeric_key(current);
    let fixed = numeric_key(fixed);
    match (current.first(), fixed.first()) {
        (Some(current), Some(fixed)) => current != fixed,
        _ => false,
    }
}

fn best_fix_version(versions: &[String]) -> Option<String> {
    versions
        .iter()
        .max_by(|left, right| compare_versions(left, right))
        .cloned()
}

fn compare_versions(left: &str, right: &str) -> Ordering {
    if let (Ok(left), Ok(right)) = (
        semver::Version::parse(left),
        semver::Version::parse(right),
    ) {
        return left.cmp(&right);
    }
    numeric_key(left)
        .cmp(&numeric_key(right))
        .then_with(|| left.cmp(right))
}

fn numeric_key(version: &str) -> Vec<u64> {
    version
        .split(|character: char| !character.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .filter_map(|segment| segment.parse().ok())
        .collect()
}

fn confirm(question: &str) -> anyhow::Result<bool> {
    use std::io::{self, Write};

    if !io::stdin().is_terminal() {
        return Ok(true);
    }

    eprint!("{} [y/N] ", question);
    io::stderr().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let answer = input.trim().to_ascii_lowercase();
    Ok(answer == "y" || answer == "yes")
}

fn run_tool(program: &str, args: &[&str], root: &Path, json: bool) -> anyhow::Result<()> {
    run_tool_inner(program, args, root, json, false)
}

fn run_tool_quietly(program: &str, args: &[&str], root: &Path) -> anyhow::Result<()> {
    run_tool_inner(program, args, root, true, true)
}

fn run_tool_inner(
    program: &str,
    args: &[&str],
    root: &Path,
    json: bool,
    quiet: bool,
) -> anyhow::Result<()> {
    let mut command = ProcessCommand::new(program);
    command.args(args).current_dir(root);
    command.stdout(if json { Stdio::null() } else { Stdio::inherit() });
    command.stderr(if quiet { Stdio::null() } else { Stdio::inherit() });

    let status = command.status().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            anyhow::anyhow!("{program} is not installed or is not on PATH")
        } else {
            anyhow::Error::new(err).context(format!("could not run {program}"))
        }
    })?;

    if !status.success() {
        anyhow::bail!(
            "{} {} exited with status {}",
            program,
            args.join(" "),
            status.code().unwrap_or(-1)
        );
    }
    Ok(())
}

fn announce(json: bool, message: &str) {
    if !json {
        eprintln!("{}", style::dim(message));
    }
}

fn read_document(path: &Path) -> anyhow::Result<toml_edit::DocumentMut> {
    let contents = std::fs::read_to_string(path)?;
    contents
        .parse::<toml_edit::DocumentMut>()
        .map_err(|err| anyhow::anyhow!("could not parse {}: {err}", path.display()))
}

fn relative_name(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

fn fix_npm(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    let mut outcome = FixOutcome {
        workflow: "npm",
        ..FixOutcome::default()
    };

    let (changed, overridden) = update_npm_manifest(root, fixes)?;
    if changed {
        outcome.updated_files.push("package.json".to_string());
    }
    if !overridden.is_empty() {
        outcome.notes.push(format!(
            "Pinned these transitive dependencies through the package.json overrides field: {}.",
            overridden.join(", ")
        ));
    }

    announce(json, "Running npm install --package-lock-only...");
    run_tool("npm", &["install", "--package-lock-only"], root, json)?;
    outcome.updated_files.push("package-lock.json".to_string());
    outcome
        .applied
        .extend(fixes.iter().map(|target| target.package.clone()));

    Ok(outcome)
}

fn update_npm_manifest(
    root: &Path,
    fixes: &[FixTarget],
) -> anyhow::Result<(bool, Vec<String>)> {
    let manifest_path = root.join("package.json");
    let contents = std::fs::read_to_string(&manifest_path)?;
    let mut manifest: serde_json::Value = serde_json::from_str(&contents)?;
    let mut changed = false;
    let mut overridden = Vec::new();

    const SECTIONS: [&str; 4] = [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    ];

    for target in fixes {
        let mut declared = false;

        for section in SECTIONS {
            let Some(entries) = manifest.get_mut(section).and_then(|value| value.as_object_mut())
            else {
                continue;
            };
            let Some(existing) = entries.get(&target.package).and_then(|value| value.as_str())
            else {
                continue;
            };
            let Some(updated) = npm_range_for(existing, &target.version) else {
                continue;
            };
            declared = true;
            if updated != existing {
                entries.insert(
                    target.package.clone(),
                    serde_json::Value::String(updated),
                );
                changed = true;
            }
        }

        if declared {
            continue;
        }

        let overrides = manifest
            .as_object_mut()
            .expect("package.json is an object")
            .entry("overrides")
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        let Some(entries) = overrides.as_object_mut() else {
            continue;
        };
        let updated = serde_json::Value::String(target.version.clone());
        if entries.get(&target.package) != Some(&updated) {
            entries.insert(target.package.clone(), updated);
            changed = true;
        }
        overridden.push(target.package.clone());
    }

    if changed {
        let mut serialized = serde_json::to_string_pretty(&manifest)?;
        serialized.push('\n');
        std::fs::write(&manifest_path, serialized)?;
    }

    Ok((changed, overridden))
}

fn npm_range_for(existing: &str, version: &str) -> Option<String> {
    let existing = existing.trim();
    if existing.contains(':') || existing.contains('/') || existing.contains(' ') {
        return None;
    }
    let prefix: String = existing
        .chars()
        .take_while(|character| matches!(character, '^' | '~' | '>' | '=' | '<'))
        .collect();
    if prefix == "<" || prefix == "<=" {
        return Some(version.to_string());
    }
    Some(format!("{prefix}{version}"))
}

fn fix_cargo(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    let mut outcome = FixOutcome {
        workflow: "cargo",
        ..FixOutcome::default()
    };

    if update_cargo_manifest(root, fixes)? {
        outcome.updated_files.push("Cargo.toml".to_string());
    }

    for target in fixes {
        announce(
            json,
            &format!("Updating {} to {}...", target.package, target.version),
        );
        let spec = format!("{}@{}", target.package, target.current);
        let result = run_tool_quietly(
            "cargo",
            &["update", "-p", &spec, "--precise", &target.version],
            root,
        )
        .or_else(|_| {
            run_tool(
                "cargo",
                &["update", "-p", &target.package, "--precise", &target.version],
                root,
                json,
            )
        });
        match result {
            Ok(()) => outcome.applied.push(target.package.clone()),
            Err(err) => outcome.failed.push(format!(
                "{} -> {}: {}",
                target.package, target.version, err
            )),
        }
    }

    if !outcome.applied.is_empty() {
        outcome.updated_files.push("Cargo.lock".to_string());
    }

    Ok(outcome)
}

fn update_cargo_manifest(root: &Path, fixes: &[FixTarget]) -> anyhow::Result<bool> {
    let manifest_path = root.join("Cargo.toml");
    if !manifest_path.is_file() {
        return Ok(false);
    }

    let mut document = read_document(&manifest_path)?;
    let mut changed = false;

    const SECTIONS: [&str; 3] = ["dependencies", "dev-dependencies", "build-dependencies"];

    for target in fixes {
        for section in SECTIONS {
            let Some(table) = document
                .get_mut(section)
                .and_then(|item| item.as_table_like_mut())
            else {
                continue;
            };
            let Some(entry) = table.get_mut(&target.package) else {
                continue;
            };

            if let Some(value) = entry.as_str() {
                if value != target.version {
                    *entry = toml_edit::value(target.version.clone());
                    changed = true;
                }
                continue;
            }

            if let Some(inline) = entry.as_table_like_mut() {
                let declared = inline.get("version").and_then(|item| item.as_str());
                if declared.is_some_and(|value| value != target.version) {
                    inline.insert("version", toml_edit::value(target.version.clone()));
                    changed = true;
                }
            }
        }
    }

    if changed {
        std::fs::write(&manifest_path, document.to_string())?;
    }
    Ok(changed)
}

fn fix_python(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    if root.join("poetry.lock").is_file() {
        return fix_poetry(root, fixes, json);
    }
    if root.join("pdm.lock").is_file() {
        return fix_pdm(root, fixes, json);
    }
    if root.join("uv.lock").is_file() {
        return fix_uv(root, fixes, json);
    }
    if root.join("requirements.in").is_file() || root.join("requirements-dev.in").is_file() {
        return fix_pip_tools(root, fixes, json);
    }
    if root.join("requirements.txt").is_file() {
        return fix_requirements(root, fixes, json);
    }
    if root.join("pyproject.toml").is_file() {
        return fix_pyproject(root, fixes, json);
    }
    anyhow::bail!(
        "found no Python manifest in {} that cvtree knows how to update",
        root.display()
    )
}

fn fix_poetry(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    let mut outcome = FixOutcome {
        workflow: "poetry",
        ..FixOutcome::default()
    };

    announce(json, "Detected a Poetry project.");
    let promoted = update_pyproject(
        root,
        fixes,
        &["tool", "poetry", "dependencies"],
        OverrideStyle::Pins,
        &mut outcome,
    )?;

    if !promoted.is_empty() {
        outcome.notes.push(format!(
            "Poetry has no override mechanism, so these were added to tool.poetry.dependencies as direct constraints: {}.",
            promoted.join(", ")
        ));
    }

    announce(json, "Running poetry lock...");
    match run_tool("poetry", &["lock"], root, json) {
        Ok(()) => {
            outcome.updated_files.push("poetry.lock".to_string());
            outcome
                .applied
                .extend(fixes.iter().map(|target| target.package.clone()));
        }
        Err(err) => outcome.failed.push(format!("poetry lock: {err}")),
    }

    Ok(outcome)
}

fn fix_pdm(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    let mut outcome = FixOutcome {
        workflow: "pdm",
        ..FixOutcome::default()
    };

    announce(json, "Detected a PDM project.");
    let overrides = update_pyproject(
        root,
        fixes,
        &["tool", "pdm", "resolution", "overrides"],
        OverrideStyle::Pins,
        &mut outcome,
    )?;

    if !overrides.is_empty() {
        outcome.notes.push(format!(
            "Pinned these transitive dependencies through tool.pdm.resolution.overrides: {}.",
            overrides.join(", ")
        ));
    }

    announce(json, "Running pdm lock...");
    match run_tool("pdm", &["lock"], root, json) {
        Ok(()) => {
            outcome.updated_files.push("pdm.lock".to_string());
            outcome
                .applied
                .extend(fixes.iter().map(|target| target.package.clone()));
        }
        Err(err) => outcome.failed.push(format!("pdm lock: {err}")),
    }

    Ok(outcome)
}

fn fix_uv(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    let mut outcome = FixOutcome {
        workflow: "uv",
        ..FixOutcome::default()
    };

    announce(json, "Detected a uv project.");
    let overrides = update_pyproject(
        root,
        fixes,
        &["tool", "uv", "override-dependencies"],
        OverrideStyle::Requirements,
        &mut outcome,
    )?;

    if !overrides.is_empty() {
        outcome.notes.push(format!(
            "Pinned these transitive dependencies through tool.uv.override-dependencies: {}.",
            overrides.join(", ")
        ));
    }

    announce(json, "Running uv lock...");
    match run_tool("uv", &["lock"], root, json) {
        Ok(()) => {
            outcome.updated_files.push("uv.lock".to_string());
            outcome
                .applied
                .extend(fixes.iter().map(|target| target.package.clone()));
        }
        Err(err) => outcome.failed.push(format!("uv lock: {err}")),
    }

    Ok(outcome)
}

fn update_pyproject(
    root: &Path,
    fixes: &[FixTarget],
    override_path: &[&str],
    style: OverrideStyle,
    outcome: &mut FixOutcome,
) -> anyhow::Result<Vec<String>> {
    let manifest_path = root.join("pyproject.toml");
    if !manifest_path.is_file() {
        anyhow::bail!("expected a pyproject.toml in {}", root.display());
    }

    let mut document = read_document(&manifest_path)?;
    let mut changed = false;
    let mut overrides = Vec::new();

    for target in fixes {
        if pin_project_dependency(&mut document, target) {
            changed = true;
            continue;
        }
        if pin_poetry_dependency(&mut document, target) {
            changed = true;
            continue;
        }
        if write_override(&mut document, override_path, style, target) {
            changed = true;
        }
        overrides.push(target.package.clone());
    }

    if changed {
        std::fs::write(&manifest_path, document.to_string())?;
        outcome.updated_files.push("pyproject.toml".to_string());
    }

    Ok(overrides)
}

fn pin_project_dependency(document: &mut toml_edit::DocumentMut, target: &FixTarget) -> bool {
    let groups: Vec<String> = document
        .get("project")
        .and_then(|item| item.as_table_like())
        .and_then(|project| project.get("optional-dependencies"))
        .and_then(|item| item.as_table_like())
        .map(|groups| groups.iter().map(|(key, _)| key.to_string()).collect())
        .unwrap_or_default();

    let mut updated = false;

    if let Some(array) = document
        .get_mut("project")
        .and_then(|item| item.as_table_like_mut())
        .and_then(|project| project.get_mut("dependencies"))
        .and_then(|item| item.as_array_mut())
    {
        updated |= pin_specifier(array, target);
    }

    for group in groups {
        if let Some(array) = document
            .get_mut("project")
            .and_then(|item| item.as_table_like_mut())
            .and_then(|project| project.get_mut("optional-dependencies"))
            .and_then(|item| item.as_table_like_mut())
            .and_then(|groups| groups.get_mut(&group))
            .and_then(|item| item.as_array_mut())
        {
            updated |= pin_specifier(array, target);
        }
    }

    updated
}

fn set_specifier(entry: &mut toml_edit::Value, replacement: String) {
    let decor = entry.decor().clone();
    let mut value = toml_edit::Value::from(replacement);
    *value.decor_mut() = decor;
    *entry = value;
}

fn push_specifier(array: &mut toml_edit::Array, requirement: String) {
    let prefix = array
        .iter()
        .last()
        .and_then(|entry| entry.decor().prefix())
        .and_then(|prefix| prefix.as_str())
        .map(str::to_string);
    array.push(requirement);
    if let (Some(prefix), Some(entry)) = (prefix, array.iter_mut().last()) {
        entry.decor_mut().set_prefix(prefix);
    }
}

fn pin_specifier(array: &mut toml_edit::Array, target: &FixTarget) -> bool {
    let mut updated = false;
    let replacement = format!("{}=={}", target.package, target.version);

    for entry in array.iter_mut() {
        let Some(specifier) = entry.as_str() else {
            continue;
        };
        if !requirement_matches(specifier, &target.package) {
            continue;
        }
        if specifier != replacement {
            set_specifier(entry, replacement.clone());
        }
        updated = true;
    }

    updated
}

fn pin_poetry_dependency(document: &mut toml_edit::DocumentMut, target: &FixTarget) -> bool {
    let sections = ["dependencies", "dev-dependencies"];
    let Some(poetry) = document
        .get_mut("tool")
        .and_then(|item| item.as_table_like_mut())
        .and_then(|tool| tool.get_mut("poetry"))
        .and_then(|item| item.as_table_like_mut())
    else {
        return false;
    };

    for section in sections {
        let Some(table) = poetry
            .get_mut(section)
            .and_then(|item| item.as_table_like_mut())
        else {
            continue;
        };
        let Some(key) = table
            .iter()
            .map(|(key, _)| key.to_string())
            .find(|key| python_names_match(key, &target.package))
        else {
            continue;
        };
        let Some(entry) = table.get_mut(&key) else {
            continue;
        };
        if entry.as_str().is_some() {
            *entry = toml_edit::value(target.version.clone());
            return true;
        }
        if let Some(inline) = entry.as_table_like_mut() {
            inline.insert("version", toml_edit::value(target.version.clone()));
            return true;
        }
    }

    false
}

fn write_override(
    document: &mut toml_edit::DocumentMut,
    path: &[&str],
    style: OverrideStyle,
    target: &FixTarget,
) -> bool {
    let (container, leaf) = path.split_at(path.len() - 1);
    let mut cursor = document.as_table_mut() as &mut dyn toml_edit::TableLike;

    for segment in container {
        let entry = cursor.entry(segment).or_insert_with(|| {
            let mut table = toml_edit::Table::new();
            table.set_implicit(true);
            toml_edit::Item::Table(table)
        });
        match entry.as_table_like_mut() {
            Some(table) => cursor = table,
            None => return false,
        }
    }

    let leaf = leaf[0];
    let requirement = format!("{}=={}", target.package, target.version);

    if style == OverrideStyle::Requirements {
        let entry = cursor
            .entry(leaf)
            .or_insert_with(|| toml_edit::value(toml_edit::Array::new()));
        let Some(array) = entry.as_array_mut() else {
            return false;
        };
        let existing = array
            .iter()
            .position(|item| {
                item.as_str()
                    .is_some_and(|value| requirement_matches(value, &target.package))
            });
        match existing.and_then(|index| array.get_mut(index)) {
            Some(entry) => set_specifier(entry, requirement),
            None => push_specifier(array, requirement),
        }
        return true;
    }

    let entry = cursor
        .entry(leaf)
        .or_insert_with(|| toml_edit::Item::Table(toml_edit::Table::new()));
    let Some(table) = entry.as_table_like_mut() else {
        return false;
    };
    table.insert(&target.package, toml_edit::value(target.version.clone()));
    true
}

fn fix_pip_tools(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    let mut outcome = FixOutcome {
        workflow: "pip-tools",
        ..FixOutcome::default()
    };

    announce(json, "Detected a pip-tools project.");

    let sources: Vec<PathBuf> = ["requirements.in", "requirements-dev.in"]
        .iter()
        .map(|name| root.join(name))
        .filter(|path| path.is_file())
        .collect();

    for source in &sources {
        if pin_requirements_file(source, fixes, false)? {
            outcome.updated_files.push(relative_name(root, source));
        }

        let mut args: Vec<String> = Vec::new();
        for target in fixes {
            args.push("--upgrade-package".to_string());
            args.push(format!("{}=={}", target.package, target.version));
        }
        args.push(
            source
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        );

        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        announce(
            json,
            &format!("Running pip-compile {}...", borrowed.join(" ")),
        );
        match run_tool("pip-compile", &borrowed, root, json) {
            Ok(()) => {
                outcome
                    .updated_files
                    .push(relative_name(root, &source.with_extension("txt")));
            }
            Err(err) => outcome.failed.push(format!("pip-compile: {err}")),
        }
    }

    if outcome.failed.is_empty() {
        outcome
            .applied
            .extend(fixes.iter().map(|target| target.package.clone()));
    }

    Ok(outcome)
}

fn fix_requirements(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    let mut outcome = FixOutcome {
        workflow: "requirements.txt",
        ..FixOutcome::default()
    };

    announce(json, "Detected a requirements.txt project.");

    let files: Vec<PathBuf> = ["requirements.txt", "requirements-dev.txt"]
        .iter()
        .map(|name| root.join(name))
        .filter(|path| path.is_file())
        .collect();

    let mut pinned = false;
    for file in &files {
        if pin_requirements_file(file, fixes, true)? {
            outcome.updated_files.push(relative_name(root, file));
            pinned = true;
        }
    }

    if pinned {
        outcome
            .applied
            .extend(fixes.iter().map(|target| target.package.clone()));
        outcome.notes.push(
            "Run pip install -r requirements.txt to install the pinned versions.".to_string(),
        );
    } else {
        outcome
            .failed
            .push("no requirement lines matched the vulnerable packages".to_string());
    }

    Ok(outcome)
}

fn fix_pyproject(root: &Path, fixes: &[FixTarget], json: bool) -> anyhow::Result<FixOutcome> {
    let mut outcome = FixOutcome {
        workflow: "pyproject.toml",
        ..FixOutcome::default()
    };

    announce(json, "Detected a pyproject.toml project.");
    let missing = update_pyproject(
        root,
        fixes,
        &["project", "dependencies"],
        OverrideStyle::Requirements,
        &mut outcome,
    )?;

    if !missing.is_empty() {
        outcome.notes.push(format!(
            "Added these to project.dependencies, which did not declare them: {}.",
            missing.join(", ")
        ));
    }
    outcome
        .applied
        .extend(fixes.iter().map(|target| target.package.clone()));
    outcome
        .notes
        .push("Reinstall the project to pick up the new versions.".to_string());

    Ok(outcome)
}

fn pin_requirements_file(
    path: &Path,
    fixes: &[FixTarget],
    append_missing: bool,
) -> anyhow::Result<bool> {
    let contents = std::fs::read_to_string(path)?;
    let trailing_newline = contents.ends_with('\n');
    let mut lines: Vec<String> = contents.lines().map(str::to_string).collect();
    let mut changed = false;

    for target in fixes {
        let replacement = format!("{}=={}", target.package, target.version);
        let mut found = false;

        for line in lines.iter_mut() {
            if !requirement_matches(line, &target.package) {
                continue;
            }
            found = true;
            let marker = line.split_once(';').map(|(_, rest)| rest.to_string());
            let updated = match marker {
                Some(marker) => format!("{replacement};{marker}"),
                None => replacement.clone(),
            };
            if *line != updated {
                *line = updated;
                changed = true;
            }
        }

        if !found && append_missing {
            lines.push(replacement);
            changed = true;
        }
    }

    if changed {
        let mut updated = lines.join("\n");
        if trailing_newline {
            updated.push('\n');
        }
        std::fs::write(path, updated)?;
    }

    Ok(changed)
}

fn requirement_matches(line: &str, package: &str) -> bool {
    cvtree::parser::python::requirement_name(line)
        .is_some_and(|name| python_names_match(name, package))
}

fn python_names_match(left: &str, right: &str) -> bool {
    cvtree::parser::python::normalize(left) == cvtree::parser::python::normalize(right)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_highest_semver_fix_version() {
        let versions = vec![
            "1.2.0".to_string(),
            "1.10.0".to_string(),
            "1.3.0".to_string(),
        ];
        assert_eq!(best_fix_version(&versions).unwrap(), "1.10.0");
    }

    #[test]
    fn orders_non_semver_versions_by_numeric_segments() {
        let versions = vec!["2021.10.8".to_string(), "2021.5.30".to_string()];
        assert_eq!(best_fix_version(&versions).unwrap(), "2021.10.8");
    }

    #[test]
    fn has_no_fix_version_when_none_are_published() {
        assert!(best_fix_version(&[]).is_none());
    }

    #[test]
    fn flags_upgrades_that_cross_a_compatibility_boundary() {
        assert!(crosses_compatibility_boundary("4.17.1", "5.0.0"));
        assert!(crosses_compatibility_boundary("0.1.44", "0.2.23"));
        assert!(crosses_compatibility_boundary("2.11.3", "3.1.6"));
        assert!(!crosses_compatibility_boundary("4.17.15", "4.18.0"));
        assert!(!crosses_compatibility_boundary("0.2.23", "0.2.27"));
        assert!(!crosses_compatibility_boundary("2021.5.30", "2021.10.8"));
    }

    #[test]
    fn keeps_the_npm_range_operator_when_pinning() {
        assert_eq!(npm_range_for("^4.17.0", "4.17.21").unwrap(), "^4.17.21");
        assert_eq!(npm_range_for("~1.2.0", "1.2.6").unwrap(), "~1.2.6");
        assert_eq!(npm_range_for("4.17.0", "4.17.21").unwrap(), "4.17.21");
        assert!(npm_range_for("github:me/pkg", "1.0.0").is_none());
    }

    #[test]
    fn matches_python_requirement_names_regardless_of_spelling() {
        assert!(requirement_matches("Jinja2==2.11.3", "jinja2"));
        assert!(requirement_matches("zope.interface >= 5.0", "zope-interface"));
        assert!(requirement_matches("jinja2[i18n]==2.11.3", "jinja2"));
        assert!(!requirement_matches("# jinja2==2.11.3", "jinja2"));
        assert!(!requirement_matches("-r other.txt", "jinja2"));
    }
}

#[derive(serde::Serialize)]
struct LeakFinding {
    file: PathBuf,
    snippet: String,
    kind: String,
}

#[derive(serde::Serialize)]
struct LeakReport {
    findings: Vec<LeakFinding>,
    env_present: bool,
    env_ignored: bool,
}

fn detect_leaks(root: &Path) -> anyhow::Result<LeakReport> {
    use regex::Regex;
    use std::io::Read;

    let prefixes = [
        "AKIA",
        "ASIA",
        "AIza",
        "sk_live_",
        "sk_test_",
        "RGAPI",
        "xoxb-",
        "xoxp-"
    ];

    let prefix_pattern = format!(r"(?:{})[A-Za-z0-9_\-]{{8,}}", prefixes.join("|"));
    let prefix_re = Regex::new(&prefix_pattern).unwrap();

    let privkey_re = Regex::new(r"-----BEGIN (?:RSA )?PRIVATE KEY-----").unwrap();

    let long_token_re = Regex::new(r"[A-Za-z0-9+/=_-]{32,}").unwrap();

    let mut findings: Vec<LeakFinding> = Vec::new();

    let env_path = root.join(".env");
    let env_present = env_path.is_file();
    let gitignore_path = root.join(".gitignore");
    let mut env_ignored = false;
    if gitignore_path.is_file() {
        if let Ok(contents) = std::fs::read_to_string(&gitignore_path) {
            for line in contents.lines() {
                let cleaned = line.trim();
                if
                    cleaned == ".env" ||
                    cleaned == "/.env" ||
                    cleaned == "*.env" ||
                    cleaned == ".env*"
                {
                    env_ignored = true;
                    break;
                }
            }
        }
    }

    let exclude_dirs = [".git", "node_modules", "target", "vendor", "dist", ".next", "build"];

    let mut scanned_dirs = std::collections::VecDeque::new();
    scanned_dirs.push_back(root.to_path_buf());

    while let Some(dir) = scanned_dirs.pop_front() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => {
                continue;
            }
        };

        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            {
                let path = entry.path();
                let file_type = match entry.file_type() {
                    Ok(t) => t,
                    Err(_) => {
                        continue;
                    }
                };

                if file_type.is_dir() {
                    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                        if exclude_dirs.iter().any(|d| d == &name) {
                            continue;
                        }
                    }
                    scanned_dirs.push_back(path);
                } else if file_type.is_file() {
                    if let Some(fname) = path.file_name().and_then(|s| s.to_str()) {
                        if
                            cvtree::parser::supported_lockfiles().contains(&fname)
                        {
                            continue;
                        }
                        let lower = fname.to_ascii_lowercase();
                        if
                            lower.contains("lock") ||
                            lower.ends_with(".lock") ||
                            lower.ends_with("-lock.json")
                        {
                            continue;
                        }
                    }

                    if let Ok(meta) = entry.metadata() {
                        if meta.len() > 200_000 {
                            continue;
                        }
                    }

                    let allowed_exts = [
                        "js",
                        "ts",
                        "jsx",
                        "tsx",
                        "py",
                        "go",
                        "rb",
                        "java",
                        "rs",
                        "yaml",
                        "yml",
                        "env",
                        "toml",
                        "ini",
                        "cfg",
                        "sh",
                        "bash",
                        "ps1",
                        "json",
                        "pem",
                        "key",
                        "txt",
                        "md",
                        "env.example",
                    ];
                    let filename = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    let ext = path
                        .extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s.to_ascii_lowercase());
                    let mut likely = false;
                    if let Some(e) = &ext {
                        likely = allowed_exts.iter().any(|a| a == e || a == &e.as_str());
                    }
                    if !likely {
                        let lowername = filename.to_ascii_lowercase();
                        if
                            lowername.contains("env") ||
                            lowername.ends_with("dockerfile") ||
                            lowername.ends_with("compose") ||
                            lowername.ends_with("config") ||
                            lowername.ends_with(".pem") ||
                            lowername.ends_with(".key")
                        {
                            likely = true;
                        }
                    }
                    if !likely {
                        continue;
                    }

                    let mut f = match std::fs::File::open(&path) {
                        Ok(f) => f,
                        Err(_) => {
                            continue;
                        }
                    };
                    let mut content = String::new();
                    if f.read_to_string(&mut content).is_err() {
                        continue;
                    }

                    if path.file_name().and_then(|s| s.to_str()) == Some(".env") {
                        continue;
                    }

                    if prefix_re.is_match(&content) {
                        if let Some(mat) = prefix_re.find(&content) {
                            findings.push(LeakFinding {
                                file: path.clone(),
                                snippet: content[mat.start()..mat.end()].to_string(),
                                kind: "known_prefix".to_string(),
                            });
                        }
                    }

                    if privkey_re.is_match(&content) {
                        findings.push(LeakFinding {
                            file: path.clone(),
                            snippet: "private-key-header".to_string(),
                            kind: "private_key".to_string(),
                        });
                    }

                    for mat in long_token_re.find_iter(&content) {
                        let tok = mat.as_str();
                        if tok.contains('/') { // likely a path or import
                            continue;
                        }
                        if tok.chars().all(|c| c == '-' || c == '_') {
                            continue;
                        }
                        if tok.chars().all(|c| c == '-' || c == '_' || c == '.' || c == '/') {
                            continue;
                        }
                        if tok.chars().all(|c| c.is_ascii_punctuation() || c.is_whitespace()) {
                            continue;
                        }

                        let ctx_start = if mat.start() >= 80 { mat.start() - 80 } else { 0 };
                        let ctx = &content[ctx_start..mat.start()];
                        if ctx.contains("import ") || ctx.contains("from ") {
                            continue;
                        }

                        let kind = if is_base64ish(tok) { "base64" } else { "long_token" };
                        findings.push(LeakFinding {
                            file: path.clone(),
                            snippet: tok.to_string(),
                            kind: kind.to_string(),
                        });
                    }
                }
            }
        }
    }

    let mut uniq = std::collections::HashSet::new();
    findings.retain(|f| uniq.insert((f.file.clone(), f.snippet.clone())));

    Ok(LeakReport {
        findings,
        env_present,
        env_ignored,
    })
}

fn is_base64ish(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.len() < 32 {
        return false;
    }
    if !trimmed.len().is_multiple_of(4) {
        return false;
    }
    if trimmed.contains('-') || trimmed.contains('_') || trimmed.contains('.') {
        return false;
    }

    let has_padding = trimmed.contains('=');
    let has_classic_symbols = trimmed.contains('+') || trimmed.contains('/');
    let alnum_count = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(*ch, '+' | '/' | '='))
        .count();

    if alnum_count != trimmed.chars().count() {
        return false;
    }

    if !has_padding && !has_classic_symbols && trimmed.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return false;
    }

    true
}

fn crawl(path: &Path, stop: Option<usize>, json: bool) -> anyhow::Result<u8> {
    let roots = crawl_projects(path, stop)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&roots)?);
    } else {
        for root in &roots {
            println!("{}", root.display());
        }
    }

    Ok(EXIT_OK)
}

fn crawl_projects(path: &Path, stop: Option<usize>) -> anyhow::Result<Vec<PathBuf>> {
    let mut roots = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut scanned = 0usize;
    let max = stop.unwrap_or(usize::MAX);

    fn visit(
        dir: &Path,
        roots: &mut Vec<PathBuf>,
        seen: &mut std::collections::HashSet<PathBuf>,
        max: usize,
        scanned: &mut usize
    ) -> anyhow::Result<()> {
        if *scanned >= max {
            return Ok(());
        }

        let canonical = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        if !seen.insert(canonical.clone()) {
            return Ok(());
        }

        *scanned += 1;
        if has_supported_lockfile(dir) {
            roots.push(dir.to_path_buf());
        }

        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let child = entry.path();
            if entry.file_type()?.is_dir() && *scanned < max {
                visit(&child, roots, seen, max, scanned)?;
            }
        }

        Ok(())
    }

    visit(path, &mut roots, &mut seen, max, &mut scanned)?;
    roots.sort();
    roots.dedup();
    Ok(roots)
}

fn has_supported_lockfile(path: &Path) -> bool {
    cvtree::parser
        ::supported_lockfiles()
        .iter()
        .any(|lockfile| path.join(lockfile).is_file())
}

fn describe_missing_lockfile(error: cvtree::Error) -> anyhow::Error {
    match error {
        cvtree::Error::NoLockfile(path) =>
            anyhow::anyhow!(
                "could not find a supported lockfile in {} or any parent directory.\n\nSupported lockfiles:\n{}",
                path.display(),
                cvtree::parser
                    ::supported_lockfiles()
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