use cosmwasm_std::{
    DepsMut, Env, MessageInfo, Response, StdError, StdResult,
};
use crate::msg::{Auth, BatchMsg, ExecuteMsg, PropertyMetadata};
use crate::security::prevent_replay;
use crate::state::{METADATA};

pub fn validate_metadata(metadata: &PropertyMetadata) -> StdResult<()> {
    if metadata.name.is_empty() {
        return Err(StdError::generic_err("Name cannot be empty"));
    }
    Ok(())
}

pub fn execute_set_metadata(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    token_id: String,
    metadata: PropertyMetadata,
    auth: Auth,
) -> StdResult<Response> {
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at)?;

    validate_metadata(&metadata)?;

    // Gas Optimization: only write if needed? (No, set should always write)
    METADATA.save(deps.storage, &token_id, &metadata)?;

    // Indexing Optimization (#106): Add indexed attributes
    Ok(Response::new()
        .add_attribute("action", "set_metadata")
        .add_attribute("token_id", token_id)
        .add_attribute("owner", info.sender.to_string()))
}

pub fn execute_update_metadata(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    token_id: String,
    metadata: PropertyMetadata,
    auth: Auth,
) -> StdResult<Response> {
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at)?;
    
    // Gas Optimization (#109): verify exists before update
    if !METADATA.has(deps.storage, &token_id) {
        return Err(StdError::generic_err("Metadata not found"));
    }

    validate_metadata(&metadata)?;
    METADATA.save(deps.storage, &token_id, &metadata)?;

    Ok(Response::new()
        .add_attribute("action", "update_metadata")
        .add_attribute("token_id", token_id)
        .add_attribute("owner", info.sender.to_string()))
}

pub fn execute_batch(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msgs: Vec<BatchMsg>,
    auth: Auth,
) -> StdResult<Response> {
    // Single replay protection for the entire batch (Issue #109 optimization)
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at)?;

    let mut response = Response::new().add_attribute("action", "batch");
    
    for msg in msgs {
        match msg {
            BatchMsg::SetMetadata { token_id, metadata } => {
                validate_metadata(&metadata)?;
                METADATA.save(deps.storage, &token_id, &metadata)?;
                response = response.add_attribute("action", "set_metadata");
                response = response.add_attribute("token_id", token_id);
            }
            BatchMsg::UpdateMetadata { token_id, metadata } => {
                if !METADATA.has(deps.storage, &token_id) {
                    return Err(StdError::generic_err("Metadata not found in batch"));
                }
                validate_metadata(&metadata)?;
                METADATA.save(deps.storage, &token_id, &metadata)?;
                response = response.add_attribute("action", "update_metadata");
                response = response.add_attribute("token_id", token_id);
            }
        }
    }

    Ok(response)
}

pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> StdResult<Response> {
    match msg {
        ExecuteMsg::SetMetadata { token_id, metadata, auth } => {
            execute_set_metadata(deps, env, info, token_id, metadata, auth)
        }
        ExecuteMsg::UpdateMetadata { token_id, metadata, auth } => {
            execute_update_metadata(deps, env, info, token_id, metadata, auth)
        }
        ExecuteMsg::Batch { msgs, auth } => execute_batch(deps, env, info, msgs, auth),
    }
}