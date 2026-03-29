use cw_storage_plus::Map;
use crate::msg::PropertyMetadata;

// (sender, nonce) -> used
pub const USED_NONCES: Map<(&str, u64), bool> = Map::new("used_nonces");

// token_id -> metadata
pub const METADATA: Map<&str, PropertyMetadata> = Map::new("metadata");

// snapshot_id -> metadata_list (Issue #110 optimization: batch storage)
pub const SNAPSHOTS: Map<u64, Vec<PropertyMetadata>> = Map::new("snapshots");