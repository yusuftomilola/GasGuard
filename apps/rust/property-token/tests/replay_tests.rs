#[test]
fn test_replay_attack_prevented() {
    let mut deps = mock_dependencies();

    let auth = Auth {
        nonce: 1,
        expires_at: None,
    };

    let metadata = mock_metadata();

    // First call should succeed
    let res1 = execute_set_metadata(
        deps.as_mut(),
        mock_env(),
        mock_info("user", &[]),
        "token1".to_string(),
        metadata.clone(),
        auth.clone(),
    );

    assert!(res1.is_ok());

    // Replay same nonce should fail
    let res2 = execute_set_metadata(
        deps.as_mut(),
        mock_env(),
        mock_info("user", &[]),
        "token1".to_string(),
        metadata,
        auth,
    );

    assert!(res2.is_err());
}