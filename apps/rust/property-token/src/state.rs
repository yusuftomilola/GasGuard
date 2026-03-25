use cw_storage_plus::Map;

// (sender, nonce) -> used
pub const USED_NONCES: Map<(&str, u64), bool> = Map::new("used_nonces");