//! Contract timestamps: UTC, whole seconds, `Z`.

pub fn now() -> String {
    format(jiff::Timestamp::now())
}

pub fn format(at: jiff::Timestamp) -> String {
    at.strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}
