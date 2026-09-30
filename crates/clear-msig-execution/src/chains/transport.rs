use crate::error::*;
use std::{future::Future, time::Duration};

const MAX_HTTP_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

impl HttpResponse {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

pub trait DestinationTransport: Send + Sync {
    fn get(&self, url: &str) -> Result<HttpResponse>;
    fn post_json(&self, url: &str, body: &serde_json::Value) -> Result<HttpResponse>;
    fn post_text(&self, url: &str, body: &str) -> Result<HttpResponse>;
    fn post_form_hex(&self, url: &str, raw_hex: &str) -> Result<HttpResponse>;
}

pub struct CancellableHttpTransport {
    client: reqwest::Client,
    control: crate::ExecutionControl,
}

impl CancellableHttpTransport {
    pub fn new(control: crate::ExecutionControl) -> Result<Self> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .with_context(|| "build destination HTTP client")?,
            control,
        })
    }

    fn run<T>(&self, future: impl Future<Output = Result<T>> + Send) -> Result<T> {
        let control = self.control.clone();
        let controlled = async move {
            tokio::select! {
                result = future => result,
                _ = control.cancelled() => Err(anyhow!("destination HTTP request cancelled")),
            }
        };
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.block_on(controlled)
        } else {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .with_context(|| "tokio runtime build failed")?
                .block_on(controlled)
        }
    }

    fn execute(&self, request: reqwest::RequestBuilder) -> Result<HttpResponse> {
        self.run(async move {
            let response = request
                .send()
                .await
                .context("send destination HTTP request")?;
            let status = response.status().as_u16();
            let body = read_bounded_response(response)
                .await
                .context("read destination HTTP response")?;
            Ok(HttpResponse { status, body })
        })
    }
}

/// Bound decoded response bytes while streaming. Content-Length alone is
/// insufficient for chunked or compressed responses from an untrusted RPC.
pub(crate) async fn read_bounded_response(mut response: reqwest::Response) -> Result<String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_HTTP_RESPONSE_BYTES as u64)
    {
        return Err(anyhow!(
            "HTTP response exceeds {MAX_HTTP_RESPONSE_BYTES} bytes"
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.context("read HTTP response chunk")? {
        append_response_chunk(&mut body, &chunk)?;
    }
    String::from_utf8(body).context("HTTP response is not UTF-8")
}

fn append_response_chunk(body: &mut Vec<u8>, chunk: &[u8]) -> Result<()> {
    if chunk.len() > MAX_HTTP_RESPONSE_BYTES.saturating_sub(body.len()) {
        return Err(anyhow!(
            "HTTP response exceeds {MAX_HTTP_RESPONSE_BYTES} bytes"
        ));
    }
    body.extend_from_slice(chunk);
    Ok(())
}

impl DestinationTransport for CancellableHttpTransport {
    fn get(&self, url: &str) -> Result<HttpResponse> {
        self.execute(self.client.get(url))
    }

    fn post_json(&self, url: &str, body: &serde_json::Value) -> Result<HttpResponse> {
        self.execute(self.client.post(url).json(body))
    }

    fn post_text(&self, url: &str, body: &str) -> Result<HttpResponse> {
        self.execute(
            self.client
                .post(url)
                .header("Content-Type", "text/plain")
                .body(body.to_string()),
        )
    }

    fn post_form_hex(&self, url: &str, raw_hex: &str) -> Result<HttpResponse> {
        self.execute(
            self.client
                .post(url)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(format!("data={raw_hex}")),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{append_response_chunk, CancellableHttpTransport, MAX_HTTP_RESPONSE_BYTES};

    #[test]
    fn caps_response_bytes_across_chunks_before_appending() {
        let mut body = vec![0; MAX_HTTP_RESPONSE_BYTES - 2];
        append_response_chunk(&mut body, &[1, 2]).unwrap();
        assert!(append_response_chunk(&mut body, &[3]).is_err());
        assert_eq!(body.len(), MAX_HTTP_RESPONSE_BYTES);
        assert!(
            append_response_chunk(&mut Vec::new(), &vec![0; MAX_HTTP_RESPONSE_BYTES + 1]).is_err()
        );
    }

    #[test]
    fn cancellation_drops_pending_destination_io() {
        let control = crate::ExecutionControl::default();
        let transport = CancellableHttpTransport::new(control.clone()).unwrap();
        control.cancel();
        let result = transport.run(std::future::pending::<anyhow::Result<()>>());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }
}
