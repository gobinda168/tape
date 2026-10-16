//! The error type every handler returns. Always rendered as `{"error": "..."}`.

use axum::Json;
use axum::extract::multipart::MultipartError;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("missing or invalid owner token")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    PayloadTooLarge(String),
    #[error("{0}")]
    Unprocessable(String),
    #[error("{0}")]
    BadGateway(String),
    #[error("{message}")]
    Status { status: StatusCode, message: String },
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    fn status(&self) -> StatusCode {
        match self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::PayloadTooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::Unprocessable(_) => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::BadGateway(_) => StatusCode::BAD_GATEWAY,
            AppError::Status { status, .. } => *status,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let message = match &self {
            AppError::Internal(err) => {
                tracing::error!(error = ?err, "internal error");
                "internal server error".to_owned()
            }
            other => other.to_string(),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Internal(err.into())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Internal(err.into())
    }
}

impl From<MultipartError> for AppError {
    fn from(err: MultipartError) -> Self {
        AppError::Status {
            status: err.status(),
            message: err.body_text(),
        }
    }
}

impl From<JsonRejection> for AppError {
    fn from(err: JsonRejection) -> Self {
        AppError::Status {
            status: err.status(),
            message: err.body_text(),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
