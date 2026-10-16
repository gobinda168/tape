use anyhow::Context;
use tape_server::{AppState, Config, TokenSource, app};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("tape_server=info,tower_http=info")),
        )
        .init();

    let (config, token_source) = Config::from_env()?;
    let state = AppState::new(config.clone())?;

    let listener = TcpListener::bind(config.addr)
        .await
        .with_context(|| format!("binding {}", config.addr))?;
    let local_addr = listener.local_addr()?;

    println!(
        "tape-server {} listening on http://{local_addr}",
        tape_server::VERSION
    );
    println!("Public URL:  {}", config.public_url);
    println!("Data dir:    {}", config.data_dir.display());
    println!("Web dir:     {}", config.web_dir.display());
    match token_source {
        TokenSource::Env => println!("Owner token: (set by TAPE_TOKEN)"),
        TokenSource::File => println!("Owner token: {}", config.token),
        TokenSource::Generated => println!(
            "Owner token: {}   (new, saved to {})",
            config.token,
            config.data_dir.join("token").display()
        ),
    }
    if config.google_api_key.is_none() {
        println!("Drive videos play through Google's embed (set GOOGLE_API_KEY to stream them)");
    }

    axum::serve(listener, app(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;
    tracing::info!("stopped");
    Ok(())
}

/// Resolves on Ctrl-C, or SIGTERM on Unix (e.g. `docker stop`).
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            tracing::error!(%err, "could not listen for ctrl-c");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(err) => {
                tracing::error!(%err, "could not listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}
