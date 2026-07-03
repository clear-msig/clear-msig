use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{ApiError, AppState};

#[derive(Clone)]
pub(crate) struct ProStore {
    path: PathBuf,
    lock: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct ProStoreDocument {
    schedules: Vec<ProScheduleRecord>,
    #[serde(default)]
    escrows: Vec<ProEscrowRecord>,
    audit_events: Vec<ProAuditEvent>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProScheduleRecord {
    id: String,
    wallet_name: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    address: Option<String>,
    category: String,
    amount: String,
    asset: String,
    cadence: String,
    next_run: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProScheduleInput {
    id: String,
    name: String,
    #[serde(default)]
    address: Option<String>,
    category: String,
    amount: String,
    asset: String,
    cadence: String,
    next_run: String,
    #[serde(default)]
    note: Option<String>,
    created_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProSchedulesResponse {
    wallet_name: String,
    schedules: Vec<ProScheduleRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProScheduleDeleteRequest {
    id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProEscrowFunder {
    id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    entity: Option<String>,
    address: String,
    asset: String,
    amount: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProEscrowMilestone {
    id: String,
    title: String,
    recipient: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recipient_entity: Option<String>,
    asset: String,
    amount: String,
    status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProEscrowPolicy {
    version: u8,
    mode: String,
    release_requires: String,
    unwind_requires: String,
    return_basis: String,
    asset_mode: String,
    enforcement: String,
    commitment: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProEscrowRecord {
    id: String,
    wallet_name: String,
    title: String,
    counterparty: String,
    status: String,
    funders: Vec<ProEscrowFunder>,
    milestones: Vec<ProEscrowMilestone>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    policy: Option<ProEscrowPolicy>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProEscrowInput {
    id: String,
    title: String,
    counterparty: String,
    status: String,
    funders: Vec<ProEscrowFunder>,
    milestones: Vec<ProEscrowMilestone>,
    #[serde(default)]
    policy: Option<ProEscrowPolicy>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProEscrowsResponse {
    wallet_name: String,
    escrows: Vec<ProEscrowRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProEscrowDeleteRequest {
    id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProAuditEvent {
    id: String,
    wallet_name: String,
    event_type: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reference: Option<String>,
    #[serde(default)]
    metadata: Value,
    created_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProAuditEventInput {
    id: Option<String>,
    wallet_name: String,
    event_type: String,
    title: String,
    #[serde(default)]
    reference: Option<String>,
    #[serde(default)]
    metadata: Value,
    created_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ProAuditEventsResponse {
    wallet_name: String,
    events: Vec<ProAuditEvent>,
}

#[derive(Debug, Clone, Serialize)]
struct ProPersistResponse<T> {
    ok: bool,
    data: T,
}

impl ProStore {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    async fn list_schedules(&self, wallet_name: &str) -> Result<Vec<ProScheduleRecord>, ApiError> {
        let _guard = self.lock.lock().await;
        let doc = self.read_locked().await?;
        let mut rows: Vec<ProScheduleRecord> = doc
            .schedules
            .into_iter()
            .filter(|row| row.wallet_name == wallet_name)
            .collect();
        rows.sort_by(|a, b| {
            a.next_run
                .cmp(&b.next_run)
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(rows)
    }

    async fn upsert_schedule(
        &self,
        wallet_name: String,
        input: ProScheduleInput,
    ) -> Result<ProScheduleRecord, ApiError> {
        validate_pro_schedule(&input)?;
        let _guard = self.lock.lock().await;
        let mut doc = self.read_locked().await?;
        let now = current_unix_timestamp_ms()?;
        let created_at = input.created_at.unwrap_or(now);
        let record = ProScheduleRecord {
            id: input.id.trim().to_string(),
            wallet_name,
            name: input.name.trim().to_string(),
            address: trim_optional(input.address),
            category: input.category.trim().to_ascii_lowercase(),
            amount: input.amount.trim().to_string(),
            asset: input.asset.trim().to_ascii_uppercase(),
            cadence: normalize_cadence(&input.cadence)?,
            next_run: input.next_run.trim().to_string(),
            note: trim_optional(input.note),
            created_at,
            updated_at: now,
        };

        doc.schedules
            .retain(|row| !(row.wallet_name == record.wallet_name && row.id == record.id));
        doc.schedules.push(record.clone());
        self.write_locked(&doc).await?;
        Ok(record)
    }

    async fn delete_schedule(&self, wallet_name: String, id: String) -> Result<bool, ApiError> {
        ensure_non_empty(&id, "id")?;
        let _guard = self.lock.lock().await;
        let mut doc = self.read_locked().await?;
        let before = doc.schedules.len();
        doc.schedules
            .retain(|row| !(row.wallet_name == wallet_name && row.id == id));
        let removed = doc.schedules.len() != before;
        if removed {
            self.write_locked(&doc).await?;
        }
        Ok(removed)
    }

    async fn list_escrows(&self, wallet_name: &str) -> Result<Vec<ProEscrowRecord>, ApiError> {
        let _guard = self.lock.lock().await;
        let doc = self.read_locked().await?;
        let mut rows: Vec<ProEscrowRecord> = doc
            .escrows
            .into_iter()
            .filter(|row| row.wallet_name == wallet_name)
            .collect();
        rows.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.title.cmp(&b.title))
        });
        Ok(rows)
    }

    async fn upsert_escrow(
        &self,
        wallet_name: String,
        input: ProEscrowInput,
    ) -> Result<ProEscrowRecord, ApiError> {
        validate_pro_escrow(&input)?;
        let _guard = self.lock.lock().await;
        let mut doc = self.read_locked().await?;
        let now = current_unix_timestamp_ms()?;
        let created_at = input.created_at.unwrap_or(now);
        let record = ProEscrowRecord {
            id: input.id.trim().to_string(),
            wallet_name,
            title: input.title.trim().to_string(),
            counterparty: input.counterparty.trim().to_string(),
            status: normalize_escrow_status(&input.status)?,
            funders: normalize_escrow_funders(input.funders)?,
            milestones: normalize_escrow_milestones(input.milestones)?,
            policy: input.policy.map(normalize_escrow_policy).transpose()?,
            created_at,
            updated_at: input.updated_at.unwrap_or(now),
        };

        doc.escrows
            .retain(|row| !(row.wallet_name == record.wallet_name && row.id == record.id));
        doc.escrows.push(record.clone());
        self.write_locked(&doc).await?;
        Ok(record)
    }

    async fn delete_escrow(&self, wallet_name: String, id: String) -> Result<bool, ApiError> {
        ensure_non_empty(&id, "id")?;
        let _guard = self.lock.lock().await;
        let mut doc = self.read_locked().await?;
        let before = doc.escrows.len();
        doc.escrows
            .retain(|row| !(row.wallet_name == wallet_name && row.id == id));
        let removed = doc.escrows.len() != before;
        if removed {
            self.write_locked(&doc).await?;
        }
        Ok(removed)
    }

    async fn append_audit_event(
        &self,
        input: ProAuditEventInput,
    ) -> Result<ProAuditEvent, ApiError> {
        validate_pro_audit_event(&input)?;
        let _guard = self.lock.lock().await;
        let mut doc = self.read_locked().await?;
        let now = current_unix_timestamp_ms()?;
        let event = ProAuditEvent {
            id: input.id.unwrap_or_else(|| format!("evt-{now}")),
            wallet_name: input.wallet_name.trim().to_string(),
            event_type: input.event_type.trim().to_ascii_lowercase(),
            title: input.title.trim().to_string(),
            reference: trim_optional(input.reference),
            metadata: input.metadata,
            created_at: input.created_at.unwrap_or(now),
        };
        doc.audit_events.push(event.clone());
        doc.audit_events
            .sort_by(|a, b| b.created_at.cmp(&a.created_at));
        doc.audit_events.truncate(2_000);
        self.write_locked(&doc).await?;
        Ok(event)
    }

    async fn list_audit_events(&self, wallet_name: &str) -> Result<Vec<ProAuditEvent>, ApiError> {
        let _guard = self.lock.lock().await;
        let doc = self.read_locked().await?;
        let mut rows: Vec<ProAuditEvent> = doc
            .audit_events
            .into_iter()
            .filter(|row| row.wallet_name == wallet_name)
            .collect();
        rows.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(rows.into_iter().take(200).collect())
    }

    async fn read_locked(&self) -> Result<ProStoreDocument, ApiError> {
        match tokio::fs::read_to_string(&self.path).await {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|e| ApiError::InvalidOutput(format!("invalid Pro store JSON: {e}"))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ProStoreDocument::default())
            }
            Err(error) => Err(ApiError::Internal(format!(
                "failed to read Pro store: {error}"
            ))),
        }
    }

    async fn write_locked(&self, doc: &ProStoreDocument) -> Result<(), ApiError> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                ApiError::Internal(format!("failed to create Pro store directory: {e}"))
            })?;
        }
        let body = serde_json::to_vec_pretty(doc)
            .map_err(|e| ApiError::Internal(format!("failed to encode Pro store: {e}")))?;
        tokio::fs::write(&self.path, body)
            .await
            .map_err(|e| ApiError::Internal(format!("failed to write Pro store: {e}")))
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/wallets/{name}/schedules",
            get(list_schedules).post(upsert_schedule),
        )
        .route("/wallets/{name}/schedules/delete", post(delete_schedule))
        .route(
            "/wallets/{name}/escrows",
            get(list_escrows).post(upsert_escrow),
        )
        .route("/wallets/{name}/escrows/delete", post(delete_escrow))
        .route("/wallets/{name}/audit-events", get(list_audit_events))
        .route("/audit-events", post(append_audit_event))
}

async fn list_schedules(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<ProPersistResponse<ProSchedulesResponse>>, ApiError> {
    ensure_non_empty(&name, "walletName")?;
    let schedules = state.pro_store.list_schedules(&name).await?;
    Ok(Json(ProPersistResponse {
        ok: true,
        data: ProSchedulesResponse {
            wallet_name: name,
            schedules,
        },
    }))
}

async fn upsert_schedule(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(input): Json<ProScheduleInput>,
) -> Result<Json<ProPersistResponse<ProScheduleRecord>>, ApiError> {
    ensure_non_empty(&name, "walletName")?;
    let schedule = state.pro_store.upsert_schedule(name, input).await?;
    Ok(Json(ProPersistResponse {
        ok: true,
        data: schedule,
    }))
}

async fn delete_schedule(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(input): Json<ProScheduleDeleteRequest>,
) -> Result<Json<ProPersistResponse<Value>>, ApiError> {
    ensure_non_empty(&name, "walletName")?;
    let removed = state.pro_store.delete_schedule(name, input.id).await?;
    Ok(Json(ProPersistResponse {
        ok: true,
        data: serde_json::json!({ "removed": removed }),
    }))
}

async fn list_escrows(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<ProPersistResponse<ProEscrowsResponse>>, ApiError> {
    ensure_non_empty(&name, "walletName")?;
    let escrows = state.pro_store.list_escrows(&name).await?;
    Ok(Json(ProPersistResponse {
        ok: true,
        data: ProEscrowsResponse {
            wallet_name: name,
            escrows,
        },
    }))
}

async fn upsert_escrow(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(input): Json<ProEscrowInput>,
) -> Result<Json<ProPersistResponse<ProEscrowRecord>>, ApiError> {
    ensure_non_empty(&name, "walletName")?;
    let escrow = state.pro_store.upsert_escrow(name, input).await?;
    Ok(Json(ProPersistResponse {
        ok: true,
        data: escrow,
    }))
}

async fn delete_escrow(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(input): Json<ProEscrowDeleteRequest>,
) -> Result<Json<ProPersistResponse<Value>>, ApiError> {
    ensure_non_empty(&name, "walletName")?;
    let removed = state.pro_store.delete_escrow(name, input.id).await?;
    Ok(Json(ProPersistResponse {
        ok: true,
        data: serde_json::json!({ "removed": removed }),
    }))
}

async fn append_audit_event(
    State(state): State<AppState>,
    Json(input): Json<ProAuditEventInput>,
) -> Result<Json<ProPersistResponse<ProAuditEvent>>, ApiError> {
    let event = state.pro_store.append_audit_event(input).await?;
    Ok(Json(ProPersistResponse {
        ok: true,
        data: event,
    }))
}

async fn list_audit_events(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<ProPersistResponse<ProAuditEventsResponse>>, ApiError> {
    ensure_non_empty(&name, "walletName")?;
    let events = state.pro_store.list_audit_events(&name).await?;
    Ok(Json(ProPersistResponse {
        ok: true,
        data: ProAuditEventsResponse {
            wallet_name: name,
            events,
        },
    }))
}

pub(crate) fn default_store_path() -> PathBuf {
    if let Ok(path) = env::var("CLEAR_MSIG_PRO_STORE_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let render_path = PathBuf::from("/data/pro-store.json");
    if PathBuf::from("/data").exists() {
        return render_path;
    }
    PathBuf::from("backend-api-pro-store.json")
}

fn validate_pro_schedule(input: &ProScheduleInput) -> Result<(), ApiError> {
    ensure_non_empty(&input.id, "id")?;
    ensure_non_empty(&input.name, "name")?;
    ensure_non_empty(&input.category, "category")?;
    ensure_non_empty(&input.amount, "amount")?;
    ensure_non_empty(&input.asset, "asset")?;
    ensure_non_empty(&input.next_run, "nextRun")?;
    match input.category.trim().to_ascii_lowercase().as_str() {
        "vendor" | "payroll" => {}
        _ => {
            return Err(ApiError::BadRequest(
                "category must be vendor or payroll".to_string(),
            ))
        }
    }
    normalize_cadence(&input.cadence)?;
    Ok(())
}

fn validate_pro_escrow(input: &ProEscrowInput) -> Result<(), ApiError> {
    ensure_non_empty(&input.id, "id")?;
    ensure_non_empty(&input.title, "title")?;
    ensure_non_empty(&input.counterparty, "counterparty")?;
    normalize_escrow_status(&input.status)?;
    if input.funders.is_empty() {
        return Err(ApiError::BadRequest(
            "escrow must include at least one funder".to_string(),
        ));
    }
    if input.milestones.is_empty() {
        return Err(ApiError::BadRequest(
            "escrow must include at least one milestone".to_string(),
        ));
    }
    for funder in &input.funders {
        ensure_non_empty(&funder.id, "funder.id")?;
        ensure_non_empty(&funder.name, "funder.name")?;
        ensure_non_empty(&funder.address, "funder.address")?;
        ensure_non_empty(&funder.asset, "funder.asset")?;
        ensure_positive_amount(&funder.amount, "funder.amount")?;
    }
    for milestone in &input.milestones {
        ensure_non_empty(&milestone.id, "milestone.id")?;
        ensure_non_empty(&milestone.title, "milestone.title")?;
        ensure_non_empty(&milestone.recipient, "milestone.recipient")?;
        ensure_non_empty(&milestone.asset, "milestone.asset")?;
        ensure_positive_amount(&milestone.amount, "milestone.amount")?;
        normalize_milestone_status(&milestone.status)?;
    }
    if let Some(policy) = &input.policy {
        normalize_escrow_policy(policy.clone())?;
    }
    Ok(())
}

fn validate_pro_audit_event(input: &ProAuditEventInput) -> Result<(), ApiError> {
    ensure_non_empty(&input.wallet_name, "walletName")?;
    ensure_non_empty(&input.event_type, "eventType")?;
    ensure_non_empty(&input.title, "title")?;
    Ok(())
}

fn ensure_non_empty(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}

fn ensure_positive_amount(value: &str, field: &str) -> Result<(), ApiError> {
    ensure_non_empty(value, field)?;
    let parsed = value
        .trim()
        .parse::<f64>()
        .map_err(|_| ApiError::BadRequest(format!("{field} must be a positive number")))?;
    if !parsed.is_finite() || parsed <= 0.0 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be a positive number"
        )));
    }
    Ok(())
}

fn normalize_cadence(value: &str) -> Result<String, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "weekly" => Ok("Weekly".to_string()),
        "monthly" => Ok("Monthly".to_string()),
        _ => Err(ApiError::BadRequest(
            "cadence must be Weekly or Monthly".to_string(),
        )),
    }
}

fn normalize_escrow_status(value: &str) -> Result<String, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "active" => Ok("active".to_string()),
        "disputed" => Ok("disputed".to_string()),
        "returned" => Ok("returned".to_string()),
        "complete" => Ok("complete".to_string()),
        _ => Err(ApiError::BadRequest(
            "escrow status must be active, disputed, returned, or complete".to_string(),
        )),
    }
}

fn normalize_milestone_status(value: &str) -> Result<String, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "planned" => Ok("planned".to_string()),
        "released" => Ok("released".to_string()),
        _ => Err(ApiError::BadRequest(
            "milestone status must be planned or released".to_string(),
        )),
    }
}

fn normalize_escrow_funders(rows: Vec<ProEscrowFunder>) -> Result<Vec<ProEscrowFunder>, ApiError> {
    rows.into_iter()
        .map(|row| {
            Ok(ProEscrowFunder {
                id: row.id.trim().to_string(),
                name: row.name.trim().to_string(),
                entity: trim_optional(row.entity),
                address: row.address.trim().to_string(),
                asset: row.asset.trim().to_ascii_uppercase(),
                amount: row.amount.trim().to_string(),
            })
        })
        .collect()
}

fn normalize_escrow_milestones(
    rows: Vec<ProEscrowMilestone>,
) -> Result<Vec<ProEscrowMilestone>, ApiError> {
    rows.into_iter()
        .map(|row| {
            Ok(ProEscrowMilestone {
                id: row.id.trim().to_string(),
                title: row.title.trim().to_string(),
                recipient: row.recipient.trim().to_string(),
                recipient_entity: trim_optional(row.recipient_entity),
                asset: row.asset.trim().to_ascii_uppercase(),
                amount: row.amount.trim().to_string(),
                status: normalize_milestone_status(&row.status)?,
            })
        })
        .collect()
}

fn normalize_escrow_policy(policy: ProEscrowPolicy) -> Result<ProEscrowPolicy, ApiError> {
    if policy.version != 1 {
        return Err(ApiError::BadRequest(
            "escrow policy version must be 1".to_string(),
        ));
    }
    let mode = policy.mode.trim();
    let release_requires = policy.release_requires.trim();
    let unwind_requires = policy.unwind_requires.trim();
    let return_basis = policy.return_basis.trim();
    let asset_mode = policy.asset_mode.trim();
    let enforcement = policy.enforcement.trim();
    let commitment = policy.commitment.trim();
    if mode != "milestone_escrow"
        || release_requires != "wallet_approval"
        || unwind_requires != "wallet_approval"
        || return_basis != "recorded_funder_contribution"
        || asset_mode != "per_asset"
    {
        return Err(ApiError::BadRequest(
            "unsupported escrow policy".to_string(),
        ));
    }
    match enforcement {
        "approval_workflow" | "onchain_policy_pending" => {}
        _ => {
            return Err(ApiError::BadRequest(
                "unsupported escrow policy enforcement".to_string(),
            ))
        }
    }
    if commitment.len() < 16 || !commitment.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::BadRequest(
            "escrow policy commitment must be hex".to_string(),
        ));
    }
    Ok(ProEscrowPolicy {
        version: policy.version,
        mode: mode.to_string(),
        release_requires: release_requires.to_string(),
        unwind_requires: unwind_requires.to_string(),
        return_basis: return_basis.to_string(),
        asset_mode: asset_mode.to_string(),
        enforcement: enforcement.to_string(),
        commitment: commitment.to_string(),
    })
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn current_unix_timestamp_ms() -> Result<i64, ApiError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| ApiError::Internal(format!("system clock before unix epoch: {e}")))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| ApiError::Internal("system clock timestamp out of range".into()))
}
