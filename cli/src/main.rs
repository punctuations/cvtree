mod render;
mod style;

use std::path::{ Path, PathBuf };
use std::process::ExitCode;

use clap::{ Parser, Subcommand };
use cvtree::audit::PackageReport;
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
                    project.root.join(project.parser.lockfile()).display()
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
                    format!("{}", style::dim(&format!("({reason})")))
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

    let prefixes = vec![
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
            if let Ok(entry) = entry {
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
                            cvtree::parser
                                ::supported_lockfiles()
                                .iter()
                                .any(|&lf| lf == fname)
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
    if trimmed.len() % 4 != 0 {
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
