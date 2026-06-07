use serde::{Deserialize, Serialize};

// Placeholder GitHub OAuth App client_id. MUST be replaced with the real
// client_id from the registered OAuth App before shipping. Device Flow
// must be enabled on the OAuth App in GitHub settings.
const GITHUB_CLIENT_ID: &str = "Ov23liPLACEHOLDER";

const KEYRING_SERVICE: &str = "animus-desktop";
const KEYRING_ACCOUNT: &str = "github-token";

const USER_AGENT: &str = "animus-desktop";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthStatus {
    pub logged_in: bool,
    pub login: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub default_branch: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Webhook {
    pub id: u64,
    pub url: String,
    pub events: Vec<String>,
    pub active: bool,
}

#[derive(Deserialize)]
struct DeviceCodeRaw {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct PollResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
}

#[derive(Deserialize)]
struct GhUser {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GhRepo {
    id: u64,
    name: String,
    full_name: String,
    private: bool,
    default_branch: Option<String>,
    description: Option<String>,
    language: Option<String>,
    updated_at: String,
}

#[derive(Deserialize)]
struct GhWebhook {
    id: u64,
    url: String,
    events: Vec<String>,
    active: bool,
}

#[derive(Deserialize)]
struct GhErrorBody {
    message: Option<String>,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

fn store_token(token: &str) -> Result<(), String> {
    let entry = keyring_entry()?;
    entry.set_password(token).map_err(|e| e.to_string())
}

fn load_token() -> Result<Option<String>, String> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn clear_token() -> Result<(), String> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

async fn require_token() -> Result<String, String> {
    load_token()?.ok_or_else(|| "not authenticated".to_string())
}

async fn gh_error_message(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if let Ok(parsed) = serde_json::from_str::<GhErrorBody>(&body) {
        if let Some(msg) = parsed.message {
            return format!("{}: {}", status, msg);
        }
    }
    if body.is_empty() {
        status.to_string()
    } else {
        format!("{}: {}", status, body)
    }
}

async fn fetch_user(client: &reqwest::Client, token: &str) -> Result<GhUser, String> {
    let resp = client
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let _ = clear_token();
        return Err("token unauthorized".to_string());
    }
    if !resp.status().is_success() {
        return Err(gh_error_message(resp).await);
    }
    resp.json::<GhUser>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn github_auth_start() -> Result<DeviceCodeResponse, String> {
    let client = http_client()?;
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "repo read:user")])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(gh_error_message(resp).await);
    }
    let raw: DeviceCodeRaw = resp.json().await.map_err(|e| e.to_string())?;
    Ok(DeviceCodeResponse {
        user_code: raw.user_code,
        verification_uri: raw.verification_uri,
        device_code: raw.device_code,
        interval: raw.interval,
        expires_in: raw.expires_in,
    })
}

#[tauri::command]
pub async fn github_auth_poll(device_code: String) -> Result<AuthStatus, String> {
    let client = http_client()?;
    let mut interval_secs: u64 = 5;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(900);

    loop {
        if std::time::Instant::now() >= deadline {
            return Err("device flow timed out".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;

        let resp = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", device_code.as_str()),
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:device_code",
                ),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(gh_error_message(resp).await);
        }
        let body: PollResponse = resp.json().await.map_err(|e| e.to_string())?;

        if let Some(token) = body.access_token {
            store_token(&token)?;
            let user = fetch_user(&client, &token).await?;
            return Ok(AuthStatus {
                logged_in: true,
                login: Some(user.login),
                avatar_url: user.avatar_url,
            });
        }

        match body.error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => {
                interval_secs = body.interval.unwrap_or(interval_secs + 5);
            }
            Some(err) => {
                let detail = body
                    .error_description
                    .unwrap_or_else(|| err.to_string());
                return Err(detail);
            }
            None => return Err("empty device flow response".to_string()),
        }
    }
}

#[tauri::command]
pub async fn github_auth_status() -> Result<AuthStatus, String> {
    let token = match load_token()? {
        Some(t) => t,
        None => {
            return Ok(AuthStatus {
                logged_in: false,
                login: None,
                avatar_url: None,
            });
        }
    };
    let client = http_client()?;
    match fetch_user(&client, &token).await {
        Ok(user) => Ok(AuthStatus {
            logged_in: true,
            login: Some(user.login),
            avatar_url: user.avatar_url,
        }),
        Err(_) => Ok(AuthStatus {
            logged_in: false,
            login: None,
            avatar_url: None,
        }),
    }
}

#[tauri::command]
pub async fn github_logout() -> Result<(), String> {
    clear_token()
}

#[tauri::command]
pub async fn github_list_repos() -> Result<Vec<Repo>, String> {
    let token = require_token().await?;
    let client = http_client()?;
    let mut out: Vec<Repo> = Vec::new();
    let mut page: u32 = 1;
    loop {
        let url = format!(
            "https://api.github.com/user/repos?per_page=100&page={}&sort=updated&affiliation=owner,collaborator,organization_member",
            page
        );
        let resp = client
            .get(&url)
            .bearer_auth(&token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            let _ = clear_token();
            return Err("token unauthorized".to_string());
        }
        if !resp.status().is_success() {
            return Err(gh_error_message(resp).await);
        }

        let link_header = resp
            .headers()
            .get(reqwest::header::LINK)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let batch: Vec<GhRepo> = resp.json().await.map_err(|e| e.to_string())?;
        let batch_len = batch.len();
        for r in batch {
            out.push(Repo {
                id: r.id,
                name: r.name,
                full_name: r.full_name,
                private: r.private,
                default_branch: r.default_branch.unwrap_or_else(|| "main".to_string()),
                description: r.description,
                language: r.language,
                updated_at: r.updated_at,
            });
        }

        let has_next = link_header
            .as_deref()
            .map(|h| h.contains("rel=\"next\""))
            .unwrap_or(false);
        if !has_next || batch_len == 0 {
            break;
        }
        page += 1;
    }
    Ok(out)
}

fn split_full_name(full_name: &str) -> Result<(&str, &str), String> {
    full_name
        .split_once('/')
        .ok_or_else(|| format!("invalid repo full_name: {}", full_name))
}

#[tauri::command]
pub async fn github_register_webhook(
    repo_full_name: String,
    payload_url: String,
    secret: String,
    events: Vec<String>,
) -> Result<Webhook, String> {
    let token = require_token().await?;
    let (owner, repo) = split_full_name(&repo_full_name)?;
    let client = http_client()?;
    let url = format!("https://api.github.com/repos/{}/{}/hooks", owner, repo);
    let body = serde_json::json!({
        "name": "web",
        "active": true,
        "events": events,
        "config": {
            "url": payload_url,
            "content_type": "json",
            "secret": secret,
            "insecure_ssl": "0",
        },
    });
    let resp = client
        .post(&url)
        .bearer_auth(&token)
        .header("Accept", "application/vnd.github+json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let _ = clear_token();
        return Err("token unauthorized".to_string());
    }
    if !resp.status().is_success() {
        return Err(gh_error_message(resp).await);
    }
    let h: GhWebhook = resp.json().await.map_err(|e| e.to_string())?;
    Ok(Webhook {
        id: h.id,
        url: h.url,
        events: h.events,
        active: h.active,
    })
}

#[tauri::command]
pub async fn github_list_webhooks(repo_full_name: String) -> Result<Vec<Webhook>, String> {
    let token = require_token().await?;
    let (owner, repo) = split_full_name(&repo_full_name)?;
    let client = http_client()?;
    let url = format!(
        "https://api.github.com/repos/{}/{}/hooks?per_page=100",
        owner, repo
    );
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let _ = clear_token();
        return Err("token unauthorized".to_string());
    }
    if !resp.status().is_success() {
        return Err(gh_error_message(resp).await);
    }
    let raw: Vec<GhWebhook> = resp.json().await.map_err(|e| e.to_string())?;
    Ok(raw
        .into_iter()
        .map(|h| Webhook {
            id: h.id,
            url: h.url,
            events: h.events,
            active: h.active,
        })
        .collect())
}

#[tauri::command]
pub async fn github_delete_webhook(repo_full_name: String, hook_id: u64) -> Result<(), String> {
    let token = require_token().await?;
    let (owner, repo) = split_full_name(&repo_full_name)?;
    let client = http_client()?;
    let url = format!(
        "https://api.github.com/repos/{}/{}/hooks/{}",
        owner, repo, hook_id
    );
    let resp = client
        .delete(&url)
        .bearer_auth(&token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let _ = clear_token();
        return Err("token unauthorized".to_string());
    }
    if !resp.status().is_success() {
        return Err(gh_error_message(resp).await);
    }
    Ok(())
}
