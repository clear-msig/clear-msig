//! Versioned, chain-neutral ClearSig intent schemas and template registry.

mod canonical;
mod error;
mod registry;
mod render;
mod schema;
mod validation;

pub use error::IntentSchemaError;
pub use registry::*;
pub use render::render_template;
pub use schema::*;

#[cfg(test)]
mod tests;
