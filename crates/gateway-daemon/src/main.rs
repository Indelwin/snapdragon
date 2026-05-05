use snapdragon_gateway_daemon::{GatewayDaemon, ipc::serve_unix_socket};

#[tokio::main]
async fn main() {
    let daemon = GatewayDaemon::new();
    let args = std::env::args().collect::<Vec<_>>();
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
