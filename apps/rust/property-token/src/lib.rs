use crate::security::prevent_replay;

pub fn execute_set_metadata(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    token_id: String,
    metadata: PropertyMetadata,
    auth: Auth,
) -> Result<Response, StdError> {
    prevent_replay(&mut deps, &env, &info, auth.nonce, auth.expires_at)?;

    validate_metadata(&metadata)?;

    METADATA.save(deps.storage, &token_id, &metadata)?;

    Ok(Response::new().add_attribute("action", "set_metadata"))
}