use cosmwasm_schema::cw_serde;

#[cw_serde]
pub struct Auth {
    pub nonce: u64,
    pub expires_at: Option<u64>,
}

#[cw_serde]
pub enum ExecuteMsg {
    SetMetadata {
        token_id: String,
        metadata: PropertyMetadata,
        auth: Auth,
    },
    UpdateMetadata {
        token_id: String,
        metadata: PropertyMetadata,
        auth: Auth,
    },
    Batch {
        msgs: Vec<BatchMsg>,
        auth: Auth,
    },
}

#[cw_serde]
pub enum BatchMsg {
    SetMetadata {
        token_id: String,
        metadata: PropertyMetadata,
    },
    UpdateMetadata {
        token_id: String,
        metadata: PropertyMetadata,
    },
}

#[cw_serde]
pub struct PropertyMetadata {
    pub name: String,
    pub description: String,
    pub image_url: String,
    pub area_sqft: u32,
    pub beds: u8,
    pub baths: u8,
    pub year_built: u16,
    pub property_type: String,
    pub is_active: bool,
}