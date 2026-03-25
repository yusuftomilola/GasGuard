use cosmwasm_std::{Env, MessageInfo, StdError, StdResult};
use crate::state::USED_NONCES;

pub fn prevent_replay(
    deps: &mut cosmwasm_std::DepsMut,
    env: &Env,
    info: &MessageInfo,
    nonce: u64,
    expires_at: Option<u64>,
) -> StdResult<()> {
    let sender = info.sender.as_str();

    // 1. Check expiry
    if let Some(expiry) = expires_at {
        if env.block.time.seconds() > expiry {
            return Err(StdError::generic_err("Message expired"));
        }
    }

    // 2. Check nonce already used
    if USED_NONCES.has(deps.storage, (sender, nonce)) {
        return Err(StdError::generic_err("Replay detected"));
    }

    // 3. Mark nonce as used
    USED_NONCES.save(deps.storage, (sender, nonce), &true)?;

    Ok(())
}