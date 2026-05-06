use snapdragon_gateway_daemon::{GatewayDaemon, GatewayStore, ipc::serve_unix_socket};

#[tokio::main]
async fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let daemon = match store_arg(&args) {
        Some(path) => match open_daemon_store(path).await {
            Ok(daemon) => daemon,
            Err(error) => {
                eprintln!("gateway store failed: {error}");
                std::process::exit(1);
            }
        },
        None => GatewayDaemon::new(),
    };
    if let Some(socket) = socket_arg(&args) {
        if let Err(error) = serve_unix_socket(daemon, socket).await {
            eprintln!("gateway daemon failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    let status = daemon.status().await;
    println!(
        "{}",
        serde_json::to_string(&status).unwrap_or_else(|_| "{\"services\":[]}".into())
    );
}

fn socket_arg(args: &[String]) -> Option<&str> {
    args.windows(2)
        .find_map(|pair| (pair[0] == "--socket").then_some(pair[1].as_str()))
}

fn store_arg(args: &[String]) -> Option<&str> {
    args.windows(2)
        .find_map(|pair| (pair[0] == "--store").then_some(pair[1].as_str()))
}

async fn open_daemon_store(path: &str) -> Result<GatewayDaemon, String> {
    GatewayDaemon::with_store(GatewayStore::open(path)?).await
}
