use crate::error::*;
use std::{future::Future, time::Duration};

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
            let body = response
                .text()
                .await
                .context("read destination HTTP response")?;
            Ok(HttpResponse { status, body })
        })
    }
}

impl DestinationTransport for CancellableHttpTransport {
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
    use super::CancellableHttpTransport;

    #[test]
    fn cancellation_drops_pending_destination_io() {
        let control = crate::ExecutionControl::default();
        let transport = CancellableHttpTransport::new(control.clone()).unwrap();
        control.cancel();
        let result = transport.run(std::future::pending::<anyhow::Result<()>>());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }
}
