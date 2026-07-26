mod direct;
mod execution;
mod lifecycle;

pub use direct::{DirectCommand, DirectExecutionContext};
pub use execution::{LamportPayment, TokenPayment, TypedProposalExecution};
pub use lifecycle::{TypedExecutionContext, TypedProposalLifecycle};

const MAX_VALUES: usize = 256;
const MAX_ARG_BYTES: usize = 16 * 1024;

fn validate_values(label: &str, values: Vec<&str>) -> Result<(), String> {
    if values.len() > MAX_VALUES {
        return Err(format!("{label} has too many values: {}", values.len()));
    }
    for value in values {
        if value.len() > MAX_ARG_BYTES {
            return Err(format!("{label} value exceeds the size limit"));
        }
        if value
            .chars()
            .any(|character| matches!(character, '\0' | '\n' | '\r'))
        {
            return Err(format!("{label} values cannot contain control separators"));
        }
    }
    Ok(())
}
