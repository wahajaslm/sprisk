use std::path::PathBuf;
use std::time::Duration;

use clap::{Parser, Subcommand};
use sprisk_cli::{Client, ServeConfig, pipeline_from_yaml, serve_on};
use sprisk_contracts::RunStatus;

const DEFAULT_SERVER: &str = "http://127.0.0.1:7420";

#[derive(Parser)]
#[command(name = "sprisk", about = "Local-first scientific data investigation")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Host the API and run pipelines locally.
    Serve {
        #[arg(long, default_value = "127.0.0.1:7420")]
        addr: String,
        #[arg(long, default_value = ".sprisk")]
        data_dir: PathBuf,
        /// Source checkout with plugins/, methodology/ and .venv/.
        #[arg(long, default_value = ".")]
        repo: PathBuf,
        /// Directory pipelines may read data files from. Repeat for more than one.
        #[arg(long = "data-root", default_value = ".")]
        data_roots: Vec<PathBuf>,
    },
    /// Submit a pipeline file, run it, and print the result.
    Run {
        pipeline: PathBuf,
        #[arg(long, default_value = DEFAULT_SERVER)]
        server: String,
        #[arg(long, default_value_t = 600)]
        timeout_seconds: u64,
    },
    /// Inspect runs.
    Runs {
        #[command(subcommand)]
        command: RunsCommand,
    },
}

#[derive(Subcommand)]
enum RunsCommand {
    /// Print a run's attempts and JSON outputs.
    Show {
        id: String,
        #[arg(long, default_value = DEFAULT_SERVER)]
        server: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();
    match Cli::parse().command {
        Command::Serve {
            addr,
            data_dir,
            repo,
            data_roots,
        } => {
            let listener = tokio::net::TcpListener::bind(sprisk_cli::loopback_addr(&addr)?).await?;
            eprintln!("sprisk API on http://{addr}");
            let config = ServeConfig {
                data_roots,
                ..ServeConfig::for_repo(&repo, &data_dir, &repo)
            };
            serve_on(listener, config).await
        }
        Command::Run {
            pipeline,
            server,
            timeout_seconds,
        } => {
            let text = std::fs::read_to_string(&pipeline)?;
            let now = sprisk_core::time::now();
            let client = Client::new(&server);
            let run = client
                .submit_and_start(&pipeline_from_yaml(&text, &now)?)
                .await?;
            let run = client
                .wait(&run.id, Duration::from_secs(timeout_seconds))
                .await?;
            print!("{}", client.report(&run.id).await?);
            if run.status != RunStatus::Succeeded {
                std::process::exit(1);
            }
            Ok(())
        }
        Command::Runs {
            command: RunsCommand::Show { id, server },
        } => {
            let id = id
                .parse()
                .map_err(|_| anyhow::anyhow!("{id} is not a run id"))?;
            print!("{}", Client::new(&server).report(&id).await?);
            Ok(())
        }
    }
}
