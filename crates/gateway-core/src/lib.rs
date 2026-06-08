//! Rust-first gateway primitives for Snapdragon.
//!
//! This crate is intentionally small and embeddable. It models the BEAM-like
//! semantics Snapdragon needs before any distributed transport is attached:
//! mailboxes, selective receive, registry lookups, links, monitors,
//! supervision, ETS-like tables, and transport-neutral envelopes.

pub mod agent;
pub mod envelope;
pub mod jobs;
pub mod links;
pub mod mailbox;
pub mod mesh;
pub mod process;
pub mod registry;
pub mod sandboxes;
pub mod service;
pub mod supervisor;
pub mod tables;
pub mod transport;
pub mod workers;

pub use agent::*;
pub use envelope::*;
pub use jobs::*;
pub use links::*;
pub use mailbox::*;
pub use mesh::*;
pub use process::*;
pub use registry::*;
pub use sandboxes::*;
pub use service::*;
pub use supervisor::*;
pub use tables::*;
pub use transport::*;
pub use workers::*;
